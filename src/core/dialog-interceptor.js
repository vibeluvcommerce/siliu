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
        this._pollForDialogs();
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
  }

  /**
   * 轮询检测对话框
   */
  _pollForDialogs() {
    if (!this.pendingFile || !this.user32) return;

    try {
      // 获取当前前台窗口
      const fgWindow = this.user32.GetForegroundWindow();
      if (!fgWindow || fgWindow.isNull?.()) return;
      
      // 检查是否可见
      if (!this.user32.IsWindowVisible(fgWindow)) return;
      
      // 获取窗口类名
      const classBuffer = Buffer.alloc(512);
      const classLen = this.user32.GetClassNameW(fgWindow, classBuffer, 256);
      
      if (classLen === 0) return;
      
      const className = classBuffer.toString('utf16le', 0, classLen * 2).replace(/\0/g, '');
      
      // 只处理对话框类
      if (className !== '#32770') return;
      
      // 获取窗口标题
      const titleBuffer = Buffer.alloc(1024);
      const titleLen = this.user32.GetWindowTextW(fgWindow, titleBuffer, 512);
      const title = titleBuffer.toString('utf16le', 0, titleLen * 2).replace(/\0/g, '');
      
      console.log('[DialogInterceptor] Dialog detected:', { className, title, hwnd: fgWindow.toString() });
      
      // 检查是否是文件选择对话框（通过标题关键词）
      const isFileDialog = this._isFileDialog(title);
      
      if (isFileDialog) {
        console.log('[DialogInterceptor] File dialog confirmed, auto-filling...');
        this._autoFillDialog(fgWindow);
      }

    } catch (err) {
      console.error('[DialogInterceptor] Error in poll:', err.message);
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
    
    return keywords.some(kw => title.includes(kw));
  }

  /**
   * 自动填充对话框
   */
  _autoFillDialog(hwnd) {
    if (!this.pendingFile) return;

    try {
      console.log('[DialogInterceptor] Attempting to fill dialog with:', this.pendingFile);
      
      // 方法1: 尝试找到文件名输入框
      // 类名可能是 "Edit" 或 "ComboBoxEx32"
      const editBox = this._findFilenameEdit(hwnd);
      
      if (editBox && !editBox.isNull?.()) {
        console.log('[DialogInterceptor] Found filename edit box:', editBox.toString());
        
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
            hwnd: hwnd.toString(),
            title: this._getWindowTitle(hwnd)
          });
          
          // 清除待选文件
          this.pendingFile = null;
          return;
        }
      }
      
      // 如果找不到输入框，发出手动干预事件
      console.warn('[DialogInterceptor] Could not find filename input, manual intervention needed');
      this.emit('dialog:manual-required', {
        hwnd: hwnd.toString(),
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
        
        if (edit && !edit.isNull?.()) {
          return edit;
        }
        
        // 如果找不到，尝试遍历所有子窗口
        // 这里简化处理，实际可能需要递归查找
      }
      
      return null;
    } catch (err) {
      console.error('[DialogInterceptor] Error finding edit box:', err.message);
      return null;
    }
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
          
          if (child && !child.isNull?.()) {
            // 获取按钮文字
            const textBuffer = Buffer.alloc(256);
            const textLen = this.user32.GetWindowTextW(child, textBuffer, 128);
            const text = textBuffer.toString('utf16le', 0, textLen * 2).replace(/\0/g, '');
            
            // 检查是否是确认按钮
            const isConfirm = confirmTexts.some(ct => text.includes(ct) || text === ct);
            
            if (isConfirm) {
              console.log('[DialogInterceptor] Clicking confirm button:', text);
              
              // 发送点击消息
              const WM_COMMAND = 0x0111;
              const BN_CLICKED = 0;
              
              // 获取按钮 ID
              const buttonId = this.user32.GetWindowThreadProcessId(child, null);
              
              // 发送点击消息到父窗口
              this.user32.PostMessageW(hwnd, WM_COMMAND, (BN_CLICKED << 16) | 1, child);
              
              console.log('[DialogInterceptor] Confirm button clicked');
              return;
            }
          }
        } while (child && !child.isNull?.());
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
