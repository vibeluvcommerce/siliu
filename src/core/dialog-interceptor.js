/**
 * Dialog Interceptor - 系统级文件选择对话框拦截器
 * 使用轮询检测 + Windows API 自动化文件选择对话框
 */

const { EventEmitter } = require('events');

class DialogInterceptor extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
    this.pendingFile = null;
    this.pollInterval = null;
    this.koffi = null;
    this.user32 = null;
    this.kernel32 = null;
    
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
      
      // 定义函数原型（不使用 @decorated 格式，koffi 会自动处理）
      // FindWindow 系列 - 使用函数原型定义
      this.user32.FindWindowW = this.user32.func('void *FindWindowW(const char16 *, const char16 *)');
      this.user32.FindWindowExW = this.user32.func('void *FindWindowExW(void *, void *, const char16 *, const char16 *)');
      
      // 窗口操作
      this.user32.GetClassNameW = this.user32.func('int GetClassNameW(void *, void *, int)');
      this.user32.SetWindowTextW = this.user32.func('bool SetWindowTextW(void *, const char16 *)');
      this.user32.GetWindowTextW = this.user32.func('int GetWindowTextW(void *, void *, int)');
      this.user32.IsWindow = this.user32.func('bool IsWindow(void *)');
      this.user32.IsWindowVisible = this.user32.func('bool IsWindowVisible(void *)');
      this.user32.GetForegroundWindow = this.user32.func('void *GetForegroundWindow(void)');
      this.user32.EnumWindows = this.user32.func('bool EnumWindows(void *, int64)');
      this.user32.GetWindowThreadProcessId = this.user32.func('uint32 GetWindowThreadProcessId(void *, void *)');
      
      // 消息发送
      this.user32.PostMessageW = this.user32.func('bool PostMessageW(void *, uint32, uint64, int64)');
      this.user32.SendMessageW = this.user32.func('int64 SendMessageW(void *, uint32, uint64, int64)');
      
      // 进程相关
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
   * 开始拦截（轮询模式）
   */
  start() {
    if (this.isRunning || !this.user32) {
      console.warn('[DialogInterceptor] Already running or Win32 not available, user32:', !!this.user32);
      return false;
    }

    try {
      this.isRunning = true;
      
      // 启动轮询检测（每 100ms 检查一次）
      this.pollInterval = setInterval(() => {
        this._pollForDialogs().catch(err => {
          console.error('[DialogInterceptor] Poll error:', err.message);
        });
      }, 100);
      
      console.log('[DialogInterceptor] Started in polling mode');
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
  }

  /**
   * 轮询检测对话框
   */
  async _pollForDialogs() {
    if (!this.pendingFile || !this.user32) {
      if (this.pendingFile) {
        console.log('[DialogInterceptor] Polling skipped: user32 not available');
      }
      return;
    }

    try {
      // 策略1: 先检查前台窗口（最常见情况）
      const fgWindow = this.user32.GetForegroundWindow();
      if (fgWindow && await this._checkAndHandleDialog(fgWindow)) {
        return;
      }
      
      // 策略2: 遍历所有顶级窗口查找对话框（不依赖前台窗口，不影响用户工作）
      // 检查所有支持的对话框类
      const dialogClasses = [
        '#32770',  // 标准 Windows 对话框
        'Chrome_WidgetWin_0', 'Chrome_WidgetWin_1', 'Chrome_WidgetWin_2',
        'Chrome_WidgetWin_3', 'Chrome_WidgetWin_4', 'Chrome_WidgetWin_5'
      ];
      
      for (const className of dialogClasses) {
        const classNameUtf16 = Buffer.from(className + '\0', 'utf16le');
        let hwnd = null;
        
        // 遍历所有该类的窗口
        do {
          hwnd = this.user32.FindWindowExW(null, hwnd, classNameUtf16, null);
          if (hwnd && await this._checkAndHandleDialog(hwnd)) {
            console.log('[DialogInterceptor] Found dialog via window enumeration:', className);
            return;
          }
        } while (hwnd);
      }
      
      // 调试日志：每5秒打印一次前台窗口信息
      if (this.pendingFile) {
        const now = Date.now();
        if (!this._lastDebugLog || now - this._lastDebugLog > 5000) {
          this._lastDebugLog = now;
          if (fgWindow) {
            const classBuffer = Buffer.alloc(512);
            const classLen = this.user32.GetClassNameW(fgWindow, classBuffer, 256);
            if (classLen > 0) {
              const className = classBuffer.toString('utf16le', 0, classLen * 2).replace(/\0/g, '');
              const titleBuffer = Buffer.alloc(1024);
              const titleLen = this.user32.GetWindowTextW(fgWindow, titleBuffer, 512);
              const title = titleBuffer.toString('utf16le', 0, titleLen * 2).replace(/\0/g, '');
              console.log('[DialogInterceptor] Poll - Foreground window:', { className, title });
            }
          }
        }
      }
    } catch (err) {
      console.error('[DialogInterceptor] Error in poll:', err.message);
    }
  }

  /**
   * 检查并处理单个窗口
   */
  async _checkAndHandleDialog(hwnd) {
    try {
      // 获取窗口类名（同时验证窗口是否有效）
      const classBuffer = Buffer.alloc(512);
      const classLen = this.user32.GetClassNameW(hwnd, classBuffer, 256);
      
      if (classLen === 0) return false;
      
      const className = classBuffer.toString('utf16le', 0, classLen * 2).replace(/\0/g, '');
      
      // 获取窗口标题
      const titleBuffer = Buffer.alloc(1024);
      const titleLen = this.user32.GetWindowTextW(hwnd, titleBuffer, 512);
      const title = titleBuffer.toString('utf16le', 0, titleLen * 2).replace(/\0/g, '');
      
      // 支持的对话框类名
      // #32770 - 标准 Windows 对话框
      // Chrome_WidgetWin_* - Chromium/Electron 对话框（可能有多个实例）
      const dialogClasses = [
        '#32770', 
        'Chrome_WidgetWin_0', 'Chrome_WidgetWin_1', 'Chrome_WidgetWin_2', 
        'Chrome_WidgetWin_3', 'Chrome_WidgetWin_4', 'Chrome_WidgetWin_5'
      ];
      
      // 检查是否是支持的对话框类
      if (!dialogClasses.includes(className)) return false;
      
      console.log('[DialogInterceptor] Checking window:', { className, title });
      
      // 检查是否是文件选择对话框（通过标题关键词）
      const isFileDialog = this._isFileDialog(title);
      
      if (isFileDialog) {
        console.log('[DialogInterceptor] File dialog confirmed, auto-filling...');
        await this._autoFillDialog(hwnd);
        return true;
      }
      
      return false;
    } catch (err) {
      console.error('[DialogInterceptor] Error checking window:', err.message);
      return false;
    }
  }

  /**
   * 通过遍历查找对话框
   */
  async _findDialogsByTraversal() {
    try {
      const classNameUtf16 = Buffer.from('#32770\0', 'utf16le');
      let hwnd = null;
      
      // 遍历所有 #32770 类的窗口
      do {
        hwnd = this.user32.FindWindowExW(null, hwnd, classNameUtf16, null);
        if (hwnd && await this._checkAndHandleDialog(hwnd)) {
          return;
        }
      } while (hwnd);
    } catch (err) {
      console.error('[DialogInterceptor] Error finding dialogs:', err.message);
    }
  }

  /**
   * 判断是否是文件选择对话框
   */
  _isFileDialog(title) {
    const keywords = [
      '打开', '保存', '另存为',       // 中文
      'Open', 'Save', 'Save As',     // 英文
      '选择文件', 'File',            // 通用
      '上传', 'Upload',              // 上传
    ];
    
    // 检查是否包含关键词
    if (keywords.some(kw => title.includes(kw))) {
      return true;
    }
    
    // 对于 Chrome 下载对话框，标题可能是文件名或 URL
    // 例如："some-file.txt" 或 "https://example.com/file.txt"
    // 我们通过检查是否包含常见的文件扩展名来判断
    const fileExtensions = [
      '.txt', '.pdf', '.doc', '.docx', '.xls', '.xlsx', 
      '.ppt', '.pptx', '.zip', '.rar', '.7z', '.tar', '.gz',
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp',
      '.mp4', '.mp3', '.avi', '.mov', '.wmv', '.flv', '.webm',
      '.exe', '.msi', '.dmg', '.pkg', '.deb', '.rpm',
      '.js', '.css', '.html', '.htm', '.json', '.xml', '.csv'
    ];
    
    const lowerTitle = title.toLowerCase();
    if (fileExtensions.some(ext => lowerTitle.includes(ext))) {
      console.log('[DialogInterceptor] Detected file dialog by extension:', title);
      return true;
    }
    
    // 检查是否是 URL 格式（可能是下载链接）
    if (title.startsWith('http://') || title.startsWith('https://')) {
      console.log('[DialogInterceptor] Detected file dialog by URL:', title);
      return true;
    }
    
    return false;
  }

  /**
   * 自动填充对话框
   */
  async _autoFillDialog(hwnd) {
    if (!this.pendingFile) return;

    try {
      console.log('[DialogInterceptor] Attempting to fill dialog with:', this.pendingFile);
      
      // 方法1: 尝试找到文件名输入框
      // 类名可能是 "Edit" 或 "ComboBoxEx32"
      const editBox = this._findFilenameEdit(hwnd);
      
      if (editBox) {
        console.log('[DialogInterceptor] Found filename edit box');
        
        // 设置文件路径
        const filePathUtf16 = Buffer.from(this.pendingFile + '\0', 'utf16le');
        const result = this.user32.SetWindowTextW(editBox, filePathUtf16);
        
        console.log('[DialogInterceptor] SetWindowText result:', result);
        
        if (result) {
          // 延迟后点击确认按钮
          setTimeout(() => {
            this._clickConfirmButton(hwnd);
          }, 200);
          
          // 触发事件
          this.emit('file:selected', {
            filePath: this.pendingFile,
            hwnd: hwnd,
            title: this._getWindowTitle(hwnd)
          });
          
          // 清除待选文件
          this.pendingFile = null;
          return;
        }
      }
      
      // 方法2: 对于 Chrome 保存对话框，尝试键盘模拟输入
      console.log('[DialogInterceptor] Trying keyboard simulation for Chrome dialog...');
      const keyboardSuccess = await this._fillByKeyboard(hwnd, this.pendingFile);
      
      if (keyboardSuccess) {
        console.log('[DialogInterceptor] Keyboard simulation successful');
        // 触发事件
        this.emit('file:selected', {
          filePath: this.pendingFile,
          hwnd: hwnd,
          title: this._getWindowTitle(hwnd)
        });
        // 清除待选文件
        this.pendingFile = null;
        return;
      }
      
      // 如果键盘模拟也失败，发出手动干预事件
      console.warn('[DialogInterceptor] Could not find filename input, manual intervention needed');
      this.emit('dialog:manual-required', {
        hwnd: hwnd,
        filePath: this.pendingFile,
        title: this._getWindowTitle(hwnd)
      });

    } catch (err) {
      console.error('[DialogInterceptor] Error auto-filling dialog:', err.message);
    }
  }

  /**
   * 查找文件名输入框
   */
  _findFilenameEdit(parentHwnd) {
    try {
      // 常见的文件名输入框类名
      const editClasses = ['Edit', 'ComboBoxEx32', 'ComboBox'];
      
      for (const className of editClasses) {
        const classNameUtf16 = Buffer.from(className + '\0', 'utf16le');
        
        // 尝试直接查找
        let edit = this.user32.FindWindowExW(parentHwnd, null, classNameUtf16, null);
        
        // koffi returns a pointer - check if it's not null
        if (edit) {
          console.log(`[DialogInterceptor] Found ${className} control`);
          return edit;
        }
      }
      
      // 如果直接找不到，尝试遍历所有子窗口
      console.log('[DialogInterceptor] Trying to enumerate child windows...');
      const found = this._enumerateAllChildWindows(parentHwnd);
      if (found) {
        return found;
      }
      
      return null;
    } catch (err) {
      console.error('[DialogInterceptor] Error finding edit box:', err.message);
      return null;
    }
  }

  /**
   * 枚举所有子窗口（深度遍历）
   */
  _enumerateAllChildWindows(parentHwnd) {
    try {
      // 获取所有子窗口，不限于 Edit 类
      let child = null;
      const nullClass = Buffer.from('\0', 'utf16le');
      
      console.log('[DialogInterceptor] Enumerating all child windows of dialog...');
      
      do {
        child = this.user32.FindWindowExW(parentHwnd, child, null, null);
        if (child) {
          const classBuffer = Buffer.alloc(512);
          const classLen = this.user32.GetClassNameW(child, classBuffer, 256);
          const className = classBuffer.toString('utf16le', 0, classLen * 2).replace(/\0/g, '');
          
          const titleBuffer = Buffer.alloc(1024);
          const titleLen = this.user32.GetWindowTextW(child, titleBuffer, 512);
          const title = titleBuffer.toString('utf16le', 0, titleLen * 2).replace(/\0/g, '');
          
          console.log('[DialogInterceptor] Child window:', { className, title });
          
          // 检查是否是可编辑的控件
          if (['Edit', 'ComboBoxEx32', 'ComboBox', 'Chrome_WidgetWin_0', 'Chrome_WidgetWin_1'].includes(className)) {
            // 对于 Chrome 控件，尝试更深层的查找
            if (className.startsWith('Chrome_WidgetWin_')) {
              const deepChild = this._findEditInChromeWidget(child);
              if (deepChild) return deepChild;
            } else {
              console.log(`[DialogInterceptor] Found editable control: ${className}`);
              return child;
            }
          }
        }
      } while (child);
      
      return null;
    } catch (err) {
      console.error('[DialogInterceptor] Error enumerating children:', err.message);
      return null;
    }
  }

  /**
   * 在 Chrome Widget 中查找编辑框
   */
  _findEditInChromeWidget(parentHwnd) {
    try {
      let child = null;
      const nullClass = Buffer.from('\0', 'utf16le');
      
      do {
        child = this.user32.FindWindowExW(parentHwnd, child, null, null);
        if (child) {
          const classBuffer = Buffer.alloc(512);
          const classLen = this.user32.GetClassNameW(child, classBuffer, 256);
          const className = classBuffer.toString('utf16le', 0, classLen * 2).replace(/\0/g, '');
          
          console.log('[DialogInterceptor] Chrome widget child:', { className });
          
          if (['Edit', 'ComboBoxEx32', 'ComboBox'].includes(className)) {
            console.log(`[DialogInterceptor] Found edit in Chrome widget: ${className}`);
            return child;
          }
          
          // 递归查找更深层的控件
          if (className.startsWith('Chrome_WidgetWin_')) {
            const deep = this._findEditInChromeWidget(child);
            if (deep) return deep;
          }
        }
      } while (child);
      
      return null;
    } catch (err) {
      console.error('[DialogInterceptor] Error finding edit in Chrome widget:', err.message);
      return null;
    }
  }

  /**
   * 枚举子窗口（用于调试）
   */
  _enumerateChildWindows(parentHwnd) {
    try {
      const childBuffer = Buffer.alloc(512);
      let child = null;
      const classNameUtf16 = Buffer.from('Edit\0', 'utf16le');
      
      do {
        child = this.user32.FindWindowExW(parentHwnd, child, classNameUtf16, null);
        if (child) {
          const classBuffer = Buffer.alloc(512);
          const classLen = this.user32.GetClassNameW(child, classBuffer, 256);
          const className = classBuffer.toString('utf16le', 0, classLen * 2).replace(/\0/g, '');
          
          const titleBuffer = Buffer.alloc(1024);
          const titleLen = this.user32.GetWindowTextW(child, titleBuffer, 512);
          const title = titleBuffer.toString('utf16le', 0, titleLen * 2).replace(/\0/g, '');
          
          console.log('[DialogInterceptor] Child window:', { className, title });
        }
      } while (child);
    } catch (err) {
      console.error('[DialogInterceptor] Error enumerating children:', err.message);
    }
  }

  /**
   * 使用键盘模拟填充文件路径（用于 Chrome 保存对话框）
   */
  async _fillByKeyboard(hwnd, filePath) {
    try {
      console.log('[DialogInterceptor] Using keyboard simulation to fill path:', filePath);
      
      // 确保窗口在前台
      this.user32.SetForegroundWindow(hwnd);
      await this._sleep(100);
      
      // Ctrl+A 全选当前内容（如果有）
      this._sendKeyCombo(hwnd, 0x11, 0x41); // Ctrl+A
      await this._sleep(50);
      
      // 直接输入文件路径
      for (const char of filePath) {
        const vk = this._charToVk(char);
        if (vk) {
          this._sendKey(hwnd, vk);
          await this._sleep(10);
        }
      }
      
      await this._sleep(200);
      
      // 按回车确认
      this._sendKey(hwnd, 0x0D); // Enter
      
      console.log('[DialogInterceptor] Keyboard input completed');
      return true;
    } catch (err) {
      console.error('[DialogInterceptor] Keyboard simulation failed:', err.message);
      return false;
    }
  }

  /**
   * 发送单个按键
   */
  _sendKey(hwnd, vkCode) {
    const WM_KEYDOWN = 0x0100;
    const WM_KEYUP = 0x0101;
    
    // 发送按键按下
    this.user32.PostMessageW(hwnd, WM_KEYDOWN, vkCode, 0);
    // 发送按键释放
    this.user32.PostMessageW(hwnd, WM_KEYUP, vkCode, 0);
  }

  /**
   * 发送组合键
   */
  _sendKeyCombo(hwnd, vkModifier, vkKey) {
    const WM_KEYDOWN = 0x0100;
    const WM_KEYUP = 0x0101;
    
    // 按下修饰键
    this.user32.PostMessageW(hwnd, WM_KEYDOWN, vkModifier, 0);
    // 按下主键
    this.user32.PostMessageW(hwnd, WM_KEYDOWN, vkKey, 0);
    // 释放主键
    this.user32.PostMessageW(hwnd, WM_KEYUP, vkKey, 0);
    // 释放修饰键
    this.user32.PostMessageW(hwnd, WM_KEYUP, vkModifier, 0);
  }

  /**
   * 字符转虚拟键码
   */
  _charToVk(char) {
    // 简单映射常用字符
    const map = {
      'a': 0x41, 'b': 0x42, 'c': 0x43, 'd': 0x44, 'e': 0x45, 'f': 0x46,
      'g': 0x47, 'h': 0x48, 'i': 0x49, 'j': 0x4A, 'k': 0x4B, 'l': 0x4C,
      'm': 0x4D, 'n': 0x4E, 'o': 0x4F, 'p': 0x50, 'q': 0x51, 'r': 0x52,
      's': 0x53, 't': 0x54, 'u': 0x55, 'v': 0x56, 'w': 0x57, 'x': 0x58,
      'y': 0x59, 'z': 0x5A,
      '0': 0x30, '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34,
      '5': 0x35, '6': 0x36, '7': 0x37, '8': 0x38, '9': 0x39,
      ':': 0xBA, '\\': 0xDC, '/': 0xBF, '.': 0xBE, '-': 0xBD, '_': 0xBD,
      ' ': 0x20
    };
    
    const upper = char.toUpperCase();
    return map[upper] || map[char.toLowerCase()] || null;
  }

  /**
   * 睡眠辅助
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 点击确认按钮
   */
  _clickConfirmButton(hwnd) {
    try {
      // 尝试找到确认按钮（类名为 Button，标题为 "打开" 或 "保存" 或 "&Open" 等）
      const buttonClasses = ['Button'];
      const confirmTexts = ['打开', '保存', '确定', 'Open', 'Save', 'OK', '&Open', '&Save'];
      
      for (const btnClass of buttonClasses) {
        let child = null;
        const classNameUtf16 = Buffer.from(btnClass + '\0', 'utf16le');
        
        do {
          child = this.user32.FindWindowExW(hwnd, child, classNameUtf16, null);
          
          if (child) {
            // 获取按钮文字
            const textBuffer = Buffer.alloc(256);
            const textLen = this.user32.GetWindowTextW(child, textBuffer, 128);
            const text = textBuffer.toString('utf16le', 0, textLen * 2).replace(/\0/g, '');
            
            console.log('[DialogInterceptor] Found button:', text);
            
            // 检查是否是确认按钮
            const isConfirm = confirmTexts.some(ct => text.includes(ct) || text === ct);
            
            if (isConfirm) {
              console.log('[DialogInterceptor] Clicking confirm button:', text);
              
              // 发送点击消息
              const WM_COMMAND = 0x0111;
              const BN_CLICKED = 0;
              
              // 发送点击消息到父窗口
              // wParam = (notificationCode << 16) | controlID, lParam = controlHandle
              // 需要将指针转换为整数地址
              const childAddr = this.koffi.address(child);
              this.user32.PostMessageW(hwnd, WM_COMMAND, (BN_CLICKED << 16) | 1, childAddr);
              
              console.log('[DialogInterceptor] Confirm button clicked');
              return;
            }
          }
        } while (child);
      }
      
      // 如果没找到特定按钮，尝试直接发送 IDOK
      console.log('[DialogInterceptor] Sending IDOK command');
      const WM_COMMAND = 0x0111;
      const IDOK = 1;
      this.user32.PostMessageW(hwnd, WM_COMMAND, IDOK, 0);
      
    } catch (err) {
      console.error('[DialogInterceptor] Error clicking confirm:', err.message);
    }
  }

  /**
   * 获取窗口标题
   */
  _getWindowTitle(hwnd) {
    try {
      const buffer = Buffer.alloc(1024);
      const len = this.user32.GetWindowTextW(hwnd, buffer, 512);
      return buffer.toString('utf16le', 0, len * 2).replace(/\0/g, '');
    } catch (err) {
      return '';
    }
  }

  /**
   * 检查是否可用
   */
  isAvailable() {
    return this.koffi !== null && this.user32 !== null;
  }
}

// 导出单例
module.exports = new DialogInterceptor();
