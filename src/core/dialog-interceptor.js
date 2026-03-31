/**
 * Dialog Interceptor - 系统级文件选择对话框拦截器
 * 使用轮询检测 + Windows API 自动化文件选择对话框
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

class DialogInterceptor extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
    this.pendingFile = null;
    this.pollInterval = null;
    this.koffi = null;
    this.user32 = null;
    this.kernel32 = null;
    this._activeDownloads = new Map(); // 跟踪正在下载的文件
    
    // 尝试加载 koffi
    try {
      this.koffi = require('koffi');
      this._initWin32();
    } catch (err) {
      console.warn('[DialogInterceptor] koffi not available:', err.message);
    }
  }

  /**
   * 初始化 Win32 API
   */
  _initWin32() {
    if (!this.koffi) return;

    try {
      // 加载 user32.dll
      this.user32 = this.koffi.load('user32.dll');
      
      // 加载 kernel32.dll
      this.kernel32 = this.koffi.load('kernel32.dll');
      
      // 定义函数原型
      this.user32.FindWindowW = this.user32.func('void *FindWindowW(const char16 *, const char16 *)');
      this.user32.FindWindowExW = this.user32.func('void *FindWindowExW(void *, void *, const char16 *, const char16 *)');
      this.user32.GetClassNameW = this.user32.func('int GetClassNameW(void *, void *, int)');
      this.user32.SetWindowTextW = this.user32.func('bool SetWindowTextW(void *, const char16 *)');
      this.user32.GetWindowTextW = this.user32.func('int GetWindowTextW(void *, void *, int)');
      this.user32.IsWindow = this.user32.func('bool IsWindow(void *)');
      this.user32.IsWindowVisible = this.user32.func('bool IsWindowVisible(void *)');
      this.user32.GetForegroundWindow = this.user32.func('void *GetForegroundWindow(void)');
      this.user32.SetForegroundWindow = this.user32.func('bool SetForegroundWindow(void *)');
      this.user32.GetWindowThreadProcessId = this.user32.func('uint32 GetWindowThreadProcessId(void *, void *)');
      this.user32.PostMessageW = this.user32.func('bool PostMessageW(void *, uint32, uint64, int64)');
      this.user32.SendMessageW = this.user32.func('int64 SendMessageW(void *, uint32, uint64, int64)');
      
      this.kernel32.GetCurrentProcessId = this.kernel32.func('uint32 GetCurrentProcessId(void)');
      
      console.log('[DialogInterceptor] Win32 API initialized');
    } catch (err) {
      console.error('[DialogInterceptor] Failed to init Win32 API:', err.message);
      this.koffi = null;
      this.user32 = null;
      this.kernel32 = null;
    }
  }

  /**
   * 开始拦截
   */
  start() {
    if (this.isRunning || !this.user32) {
      console.warn('[DialogInterceptor] Already running or Win32 not available');
      return false;
    }

    try {
      this.isRunning = true;
      this.pollInterval = setInterval(() => {
        this._pollForDialogs().catch(err => {
          console.error('[DialogInterceptor] Poll error:', err.message);
        });
      }, 100);
      
      console.log('[DialogInterceptor] Started');
      return true;
    } catch (err) {
      console.error('[DialogInterceptor] Failed to start:', err.message);
      this.isRunning = false;
      return false;
    }
  }

  /**
   * 停止拦截
   */
  stop() {
    if (!this.isRunning) return;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    
    this.isRunning = false;
    console.log('[DialogInterceptor] Stopped');
  }

  /**
   * 设置下一个要自动选择的文件
   */
  setNextFile(filePath) {
    this.pendingFile = filePath;
    console.log('[DialogInterceptor] Next file set:', filePath);
  }

  /**
   * 清除待选文件
   */
  clearNextFile() {
    this.pendingFile = null;
    console.log('[DialogInterceptor] Next file cleared');
    
    // 启动确认弹窗监听器
    this._startConfirmDialogWatcher();
  }
  
  /**
   * 启动确认弹窗监听器
   */
  _startConfirmDialogWatcher() {
    if (this._confirmWatcher) return;
    
    console.log('[DialogInterceptor] Starting confirm dialog watcher for 10 seconds');
    let checkCount = 0;
    const maxChecks = 100;
    
    this._confirmWatcher = setInterval(async () => {
      checkCount++;
      
      if (checkCount > maxChecks) {
        console.log('[DialogInterceptor] Confirm dialog watcher timeout');
        this._stopConfirmDialogWatcher();
        return;
      }
      
      try {
        // 检查前台窗口
        const fgWindow = this.user32.GetForegroundWindow();
        if (fgWindow) {
          const titleBuffer = Buffer.alloc(1024);
          const titleLen = this.user32.GetWindowTextW(fgWindow, titleBuffer, 512);
          const title = titleBuffer.toString('utf16le', 0, titleLen * 2).replace(/\0/g, '');
          
          if (this._isConfirmDialog(title)) {
            console.log('[DialogInterceptor] ⭐ Confirm dialog detected (watcher):', title);
            await this._clickYesButton(fgWindow);
            this._stopConfirmDialogWatcher();
            return;
          }
        }
        
        // 扫描 #32770 窗口
        const classNameUtf16 = Buffer.from('#32770\0', 'utf16le');
        let hwnd = null;
        
        do {
          hwnd = this.user32.FindWindowExW(null, hwnd, classNameUtf16, null);
          if (hwnd && this.user32.IsWindowVisible(hwnd)) {
            const titleBuffer = Buffer.alloc(1024);
            const titleLen = this.user32.GetWindowTextW(hwnd, titleBuffer, 512);
            const title = titleBuffer.toString('utf16le', 0, titleLen * 2).replace(/\0/g, '');
            
            if (this._isConfirmDialog(title)) {
              console.log('[DialogInterceptor] ⭐ Confirm dialog found via enumeration:', title);
              await this._clickYesButton(hwnd);
              this._stopConfirmDialogWatcher();
              return;
            }
          }
        } while (hwnd);
      } catch (err) {
        // 静默处理错误，避免日志刷屏
      }
    }, 100);
  }
  
  /**
   * 停止确认弹窗监听器
   */
  _stopConfirmDialogWatcher() {
    if (this._confirmWatcher) {
      clearInterval(this._confirmWatcher);
      this._confirmWatcher = null;
      console.log('[DialogInterceptor] Confirm dialog watcher stopped');
    }
  }

  /**
   * 轮询检测对话框
   */
  async _pollForDialogs() {
    if (!this.pendingFile || !this.user32) return;

    try {
      // 策略1: 先检查前台窗口
      const fgWindow = this.user32.GetForegroundWindow();
      if (fgWindow && await this._checkAndHandleDialog(fgWindow)) {
        return;
      }
      
      // 策略2: 遍历所有支持的对话框类
      const dialogClasses = [
        '#32770',
        'Chrome_WidgetWin_0', 'Chrome_WidgetWin_1', 'Chrome_WidgetWin_2',
        'Chrome_WidgetWin_3', 'Chrome_WidgetWin_4', 'Chrome_WidgetWin_5'
      ];
      
      for (const className of dialogClasses) {
        const classNameUtf16 = Buffer.from(className + '\0', 'utf16le');
        let hwnd = null;
        
        do {
          hwnd = this.user32.FindWindowExW(null, hwnd, classNameUtf16, null);
          if (hwnd && await this._checkAndHandleDialog(hwnd)) {
            console.log('[DialogInterceptor] Found dialog via enumeration:', className);
            return;
          }
        } while (hwnd);
      }
    } catch (err) {
      // 静默处理错误
    }
  }

  /**
   * 检查并处理单个窗口
   */
  async _checkAndHandleDialog(hwnd) {
    try {
      const classBuffer = Buffer.alloc(512);
      const classLen = this.user32.GetClassNameW(hwnd, classBuffer, 256);
      if (classLen === 0) return false;
      
      const className = classBuffer.toString('utf16le', 0, classLen * 2).replace(/\0/g, '');
      
      const titleBuffer = Buffer.alloc(1024);
      const titleLen = this.user32.GetWindowTextW(hwnd, titleBuffer, 512);
      const title = titleBuffer.toString('utf16le', 0, titleLen * 2).replace(/\0/g, '');
      
      const dialogClasses = [
        '#32770',
        'Chrome_WidgetWin_0', 'Chrome_WidgetWin_1', 'Chrome_WidgetWin_2',
        'Chrome_WidgetWin_3', 'Chrome_WidgetWin_4', 'Chrome_WidgetWin_5'
      ];
      
      // 【优先级1】检测确认弹窗
      if (this._isConfirmDialog(title)) {
        console.log('[DialogInterceptor] ⭐ CONFIRM DIALOG DETECTED:', { className, title });
        await this._clickYesButton(hwnd);
        return true;
      }
      
      // 【优先级2】检测文件对话框
      if (!this._isFileDialog(title)) return false;
      if (!dialogClasses.includes(className)) return false;
      
      console.log('[DialogInterceptor] File dialog confirmed:', { className, title });
      await this._autoFillDialog(hwnd);
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * 判断是否是确认弹窗
   */
  _isConfirmDialog(title) {
    if (!title) return false;
    
    const confirmKeywords = [
      '确认', '确认另存为', '确认保存', '确认替换', '确认覆盖',
      '替换', '覆盖', '文件已存在', '已存在',
      '确认要替换', '想要替换', '是否替换', '是否覆盖', '是否保存',
      '文件已经存在', '同名文件', '替换文件', '覆盖文件',
      'Confirm', 'Confirm Save', 'Confirm Replace', 'Confirm Overwrite',
      'Replace', 'Overwrite', 'exists', 'already exists',
      'already exist', 'file exists', 'Do you want to replace',
      'A file named', 'already exists in', 'Would you like to',
    ];
    
    return confirmKeywords.some(kw => title.includes(kw));
  }

  /**
   * 判断是否是文件选择对话框
   */
  _isFileDialog(title) {
    const keywords = [
      '打开', '保存', '另存为',
      'Open', 'Save', 'Save As',
      '选择文件', 'File',
      '上传', 'Upload',
    ];
    
    if (keywords.some(kw => title.includes(kw))) return true;
    
    const fileExtensions = ['.txt', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.jpg', '.png', '.mp4'];
    const lowerTitle = title.toLowerCase();
    if (fileExtensions.some(ext => lowerTitle.includes(ext))) return true;
    
    if (title.startsWith('http://') || title.startsWith('https://')) return true;
    
    return false;
  }

  /**
   * 自动填充对话框
   */
  async _autoFillDialog(hwnd) {
    // 防止重复处理同一个对话框
    if (this._processingDialog) {
      console.log('[DialogInterceptor] Already processing a dialog, skipping');
      return;
    }
    
    if (!this.pendingFile) return;

    try {
      this._processingDialog = true;
      const currentFile = this.pendingFile; // 保存当前文件路径
      
      console.log('[DialogInterceptor] Auto-filling dialog with:', currentFile);
      
      const editBox = this._findFilenameEdit(hwnd);
      
      if (editBox) {
        const filePathUtf16 = Buffer.from(currentFile + '\0', 'utf16le');
        this.user32.SetWindowTextW(editBox, filePathUtf16);
        
        setTimeout(() => {
          this._clickConfirmButton(hwnd);
        }, 200);
        
        // 先清除 pendingFile 防止重复处理
        this.clearNextFile();
        
        // 触发 file:selected 事件（对话框已处理）
        const fileName = path.basename(currentFile);
        this.emit('file:selected', {
          filePath: currentFile,
          fileName: fileName,
          hwnd: hwnd
        });
        
        // 启动文件下载完成检测（使用保存的 currentFile）
        this._monitorDownloadComplete(currentFile);
      }
    } catch (err) {
      console.error('[DialogInterceptor] Error auto-filling:', err.message);
    } finally {
      this._processingDialog = false;
    }
  }
  
  /**
   * 监控文件下载是否完成
   * 通过轮询检测文件大小是否稳定来判断
   */
  _monitorDownloadComplete(filePath) {
    // 检查 filePath 是否有效
    if (!filePath) {
      console.error('[DialogInterceptor] Cannot monitor download: filePath is null/undefined');
      return;
    }
    
    const downloadId = Date.now();
    const checkInterval = 500; // 每500ms检查一次
    const stableThreshold = 3; // 连续3次大小不变认为下载完成
    const maxWaitTime = 60000; // 最多等待60秒
    
    let lastSize = -1;
    let stableCount = 0;
    let elapsedTime = 0;
    
    console.log(`[DialogInterceptor] Started monitoring download: ${filePath}`);
    
    const monitor = setInterval(() => {
      elapsedTime += checkInterval;
      
      // 超时处理
      if (elapsedTime > maxWaitTime) {
        clearInterval(monitor);
        this._activeDownloads.delete(downloadId);
        console.log(`[DialogInterceptor] Download monitoring timeout: ${filePath}`);
        this.emit('download:timeout', { filePath, downloadId });
        return;
      }
      
      try {
        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
          // 文件可能还没创建，继续等待
          return;
        }
        
        const stats = fs.statSync(filePath);
        const currentSize = stats.size;
        
        // 文件存在但大小为0，可能是空文件或下载尚未开始
        if (currentSize === 0) {
          // 记录空文件状态，但继续等待（给下载一些时间）
          if (elapsedTime % 5000 === 0) { // 每5秒记录一次
            console.log(`[DialogInterceptor] File exists but size is 0, waiting for download to start...`);
          }
          return;
        }
        
        // 文件大小稳定检测（大小 > 0）
        if (currentSize === lastSize) {
          stableCount++;
          
          if (stableCount >= stableThreshold) {
            clearInterval(monitor);
            this._activeDownloads.delete(downloadId);
            
            const fileName = path.basename(filePath);
            console.log(`[DialogInterceptor] ✅ Download complete: ${fileName} (${this._formatFileSize(currentSize)})`);
            
            // 触发下载完成事件
            this.emit('download:complete', {
              filePath: filePath,
              fileName: fileName,
              fileSize: currentSize,
              downloadId: downloadId,
              message: `文件 "${fileName}" 已下载完成，保存路径: ${filePath}`
            });
          }
        } else {
          // 文件大小变化，重置计数器
          stableCount = 0;
          lastSize = currentSize;
        }
      } catch (err) {
        // 文件可能暂时无法访问，继续等待
      }
    }, checkInterval);
    
    this._activeDownloads.set(downloadId, { filePath, monitor });
  }
  
  /**
   * 格式化文件大小
   */
  _formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 查找文件名输入框
   */
  _findFilenameEdit(hwnd) {
    try {
      // 标准对话框
      const editUtf16 = Buffer.from('Edit\0', 'utf16le');
      let edit = this.user32.FindWindowExW(hwnd, null, editUtf16, null);
      if (edit) return edit;
      
      // Chrome 现代对话框 (ComboBox)
      const comboUtf16 = Buffer.from('ComboBoxEx32\0', 'utf16le');
      edit = this.user32.FindWindowExW(hwnd, null, comboUtf16, null);
      if (edit) return edit;
      
      // DirectUI 对话框 - 递归查找
      return this._findEditRecursively(hwnd);
    } catch (err) {
      return null;
    }
  }

  /**
   * 递归查找 Edit 控件
   */
  _findEditRecursively(parentHwnd, depth = 0) {
    if (depth > 5) return null;
    
    let child = null;
    do {
      child = this.user32.FindWindowExW(parentHwnd, child, null, null);
      if (child) {
        const classBuffer = Buffer.alloc(256);
        const classLen = this.user32.GetClassNameW(child, classBuffer, 128);
        if (classLen > 0) {
          const className = classBuffer.toString('utf16le', 0, classLen * 2).replace(/\0/g, '');
          
          if (className === 'Edit' || className === 'ComboBoxEx32' || className === 'ComboBox') {
            return child;
          }
          
          const found = this._findEditRecursively(child, depth + 1);
          if (found) return found;
        }
      }
    } while (child);
    
    return null;
  }

  /**
   * 点击确认按钮
   */
  _clickConfirmButton(hwnd) {
    try {
      const confirmTexts = ['打开', '保存', '确定', 'Open', 'Save', 'OK', '&Open', '&Save'];
      
      let child = null;
      const classNameUtf16 = Buffer.from('Button\0', 'utf16le');
      
      do {
        child = this.user32.FindWindowExW(hwnd, child, classNameUtf16, null);
        if (child) {
          const textBuffer = Buffer.alloc(256);
          const textLen = this.user32.GetWindowTextW(child, textBuffer, 128);
          const text = textBuffer.toString('utf16le', 0, textLen * 2).replace(/\0/g, '');
          
          if (confirmTexts.some(ct => text.includes(ct))) {
            this.user32.PostMessageW(hwnd, 0x0111, 1, this.koffi.address(child));
            return;
          }
        }
      } while (child);
    } catch (err) {
      console.error('[DialogInterceptor] Error clicking confirm:', err.message);
    }
  }

  /**
   * 点击"是"按钮（用于确认覆盖弹窗）
   */
  _clickYesButton(hwnd) {
    try {
      console.log('[DialogInterceptor] Looking for Yes button...');
      
      const yesTexts = ['是', '是(Y)', '是(&Y)', '&是', 'Yes', '&Yes', '覆盖', '替换', '确定', 'OK'];
      
      // 获取所有子控件
      const allControls = this._getAllChildWindows(hwnd);
      
      // 查找匹配"是"的按钮
      for (const control of allControls) {
        const isYes = yesTexts.some(yt => control.text.toLowerCase().includes(yt.toLowerCase()));
        if (isYes) {
          console.log('[DialogInterceptor] Clicking Yes button:', control.text);
          this._clickButtonWithRetry(control.hwnd);
          return;
        }
      }
      
      // 没找到则点击第一个 Button
      const buttonControls = allControls.filter(c => c.className === 'Button');
      if (buttonControls.length > 0) {
        console.log('[DialogInterceptor] Clicking first button:', buttonControls[0].text);
        this._clickButtonWithRetry(buttonControls[0].hwnd);
        return;
      }
      
      // 最后尝试发送 IDYES 到对话框
      console.log('[DialogInterceptor] Sending IDYES to dialog');
      this.user32.PostMessageW(hwnd, 0x0111, 6, 0);
    } catch (err) {
      console.error('[DialogInterceptor] Error clicking Yes:', err.message);
    }
  }
  
  /**
   * 点击按钮（带重试机制）
   */
  _clickButtonWithRetry(buttonHwnd, retries = 3) {
    const tryClick = (attempt) => {
      try {
        // 方法1: BM_CLICK
        this.user32.SendMessageW(buttonHwnd, 0x00F5, 0, 0);
        
        // 方法2: 模拟鼠标点击
        setTimeout(() => {
          try {
            this.user32.PostMessageW(buttonHwnd, 0x0201, 0, 0); // WM_LBUTTONDOWN
            this.user32.PostMessageW(buttonHwnd, 0x0202, 0, 0); // WM_LBUTTONUP
          } catch (e) {}
        }, 50 * attempt);
        
        console.log(`[DialogInterceptor] Click attempt ${attempt} sent`);
      } catch (err) {
        console.error(`[DialogInterceptor] Click attempt ${attempt} failed:`, err.message);
        if (attempt < retries) {
          setTimeout(() => tryClick(attempt + 1), 100);
        }
      }
    };
    
    tryClick(1);
  }
  
  /**
   * 获取所有子窗口
   */
  _getAllChildWindows(parentHwnd) {
    const controls = [];
    
    try {
      let child = null;
      
      do {
        child = this.user32.FindWindowExW(parentHwnd, child, null, null);
        if (child) {
          const classBuffer = Buffer.alloc(256);
          const classLen = this.user32.GetClassNameW(child, classBuffer, 128);
          const className = classBuffer.toString('utf16le', 0, classLen * 2).replace(/\0/g, '');
          
          const textBuffer = Buffer.alloc(256);
          const textLen = this.user32.GetWindowTextW(child, textBuffer, 128);
          const text = textBuffer.toString('utf16le', 0, textLen * 2).replace(/\0/g, '');
          
          controls.push({ hwnd: child, className, text });
          
          // 递归获取子窗口
          const subControls = this._getAllChildWindows(child);
          controls.push(...subControls);
        }
      } while (child);
    } catch (err) {
      // 静默处理
    }
    
    return controls;
  }
  
  /**
   * 发送点击消息
   * 使用多种方式尝试点击，确保兼容性
   */
  _sendClick(buttonHwnd) {
    try {
      // 方法1: BM_CLICK 消息
      this.user32.SendMessageW(buttonHwnd, 0x00F5, 0, 0); // BM_CLICK
      
      // 方法2: 模拟鼠标点击 (WM_LBUTTONDOWN + WM_LBUTTONUP)
      setTimeout(() => {
        try {
          this.user32.PostMessageW(buttonHwnd, 0x0201, 0, 0); // WM_LBUTTONDOWN
          this.user32.PostMessageW(buttonHwnd, 0x0202, 0, 0); // WM_LBUTTONUP
        } catch (e) {}
      }, 50);
      
      console.log('[DialogInterceptor] Click sent to button');
    } catch (e) {
      console.error('[DialogInterceptor] Error sending click:', e.message);
    }
  }
}

module.exports = DialogInterceptor;
