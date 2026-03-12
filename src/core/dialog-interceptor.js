/**
 * Dialog Interceptor - 系统级文件选择对话框拦截器
 * 使用 Windows API 监听和自动化文件选择对话框
 */

const { EventEmitter } = require('events');

class DialogInterceptor extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
    this.pendingFile = null;  // 等待选择的文件路径
    this.hook = null;
    this.koffi = null;
    this.user32 = null;
    this.ole32 = null;
    
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
      
      // koffi 2.x 使用新的 API 定义方式
      // 定义回调函数类型
      this.WineventProc = this.koffi.proto('void WineventProc(void *hook, uint32 event, void *hwnd, int32 idObject, int32 idChild, uint32 eventThread, uint32 eventTime)');
      
      // 定义 Windows API 函数（koffi 2.x 语法）
      this.user32.SetWinEventHook = this.user32.func('SetWinEventHook@28', 
        this.koffi.pointer(this.koffi.types.void),
        [this.koffi.types.uint32, this.koffi.types.uint32, this.koffi.pointer(this.koffi.types.void), 
         this.koffi.pointer(this.WineventProc), this.koffi.types.uint32, this.koffi.types.uint32, this.koffi.types.uint32]);
      
      this.user32.UnhookWinEvent = this.user32.func('UnhookWinEvent@4',
        this.koffi.types.bool,
        [this.koffi.pointer(this.koffi.types.void)]);
      
      this.user32.GetClassNameW = this.user32.func('GetClassNameW@12',
        this.koffi.types.int32,
        [this.koffi.pointer(this.koffi.types.void), this.koffi.pointer(this.koffi.types.char), this.koffi.types.int32]);
      
      this.user32.FindWindowExW = this.user32.func('FindWindowExW@16',
        this.koffi.pointer(this.koffi.types.void),
        [this.koffi.pointer(this.koffi.types.void), this.koffi.pointer(this.koffi.types.void), 
         this.koffi.pointer(this.koffi.types.char), this.koffi.pointer(this.koffi.types.char)]);
      
      this.user32.SetWindowTextW = this.user32.func('SetWindowTextW@8',
        this.koffi.types.bool,
        [this.koffi.pointer(this.koffi.types.void), this.koffi.pointer(this.koffi.types.char)]);
      
      this.user32.PostMessageW = this.user32.func('PostMessageW@16',
        this.koffi.types.bool,
        [this.koffi.pointer(this.koffi.types.void), this.koffi.types.uint32, 
         this.koffi.types.uint64, this.koffi.types.int64]);
      
      this.user32.SendMessageW = this.user32.func('SendMessageW@16',
        this.koffi.types.int64,
        [this.koffi.pointer(this.koffi.types.void), this.koffi.types.uint32, 
         this.koffi.types.uint64, this.koffi.types.int64]);
      
      // 加载 ole32.dll（用于 COM）
      this.ole32 = this.koffi.load('ole32.dll');
      this.ole32.CoInitialize = this.ole32.func('CoInitialize@4', 
        this.koffi.types.int32,
        [this.koffi.pointer(this.koffi.types.void)]);
      
      // 初始化 COM
      this.ole32.CoInitialize(null);
      
      console.log('[DialogInterceptor] Win32 API initialized');
    } catch (err) {
      console.error('[DialogInterceptor] Failed to init Win32 API:', err.message);
      this.koffi = null;
      this.user32 = null;
      this.ole32 = null;
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
      // Windows 事件常量
      const EVENT_OBJECT_CREATE = 0x8000;  // 0x8000 = OBJID_WINDOW
      const EVENT_OBJECT_SHOW = 0x8002;
      const EVENT_SYSTEM_DIALOGSTART = 0x0010;
      
      // WINEVENT 标志
      const WINEVENT_OUTOFCONTEXT = 0x0000;
      const WINEVENT_SKIPOWNPROCESS = 0x0002;

      // 创建回调函数
      this.callback = this.koffi.register((hook, event, hwnd, idObject, idChild, 
                                           eventThread, eventTime) => {
        this._onWindowEvent(event, hwnd);
      }, 'void __stdcall(void *, uint32, void *, int32, int32, uint32, uint32)');

      // 设置全局钩子
      this.hook = this.user32.SetWinEventHook(
        EVENT_OBJECT_CREATE,
        EVENT_OBJECT_SHOW,
        null,                    // 不注入 DLL
        this.callback,           // 回调函数
        0,                       // 所有进程
        0,                       // 所有线程
        WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS
      );

      if (!this.hook) {
        throw new Error('SetWinEventHook failed');
      }

      this.isRunning = true;
      console.log('[DialogInterceptor] Started, hook:', this.hook);
      return true;

    } catch (err) {
      console.error('[DialogInterceptor] Failed to start:', err.message);
      return false;
    }
  }

  /**
   * 停止拦截
   */
  stop() {
    if (!this.isRunning || !this.hook) return;

    try {
      this.user32.UnhookWinEvent(this.hook);
      this.hook = null;
      this.isRunning = false;
      console.log('[DialogInterceptor] Stopped');
    } catch (err) {
      console.error('[DialogInterceptor] Error stopping:', err.message);
    }
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
   * 窗口事件回调
   */
  _onWindowEvent(event, hwnd) {
    if (!this.pendingFile || !hwnd) return;

    try {
      // 获取窗口类名
      const buffer = Buffer.alloc(512);
      const len = this.user32.GetClassNameW(hwnd, buffer, 256);
      
      if (len === 0) return;
      
      const className = buffer.toString('ucs2', 0, len * 2).replace(/\0/g, '');
      
      // 检测是否是对话框
      if (className !== '#32770') return;

      console.log('[DialogInterceptor] Dialog detected, hwnd:', hwnd.toString());

      // 异步处理，避免阻塞钩子
      setImmediate(() => {
        this._handleFileDialog(hwnd);
      });

    } catch (err) {
      console.error('[DialogInterceptor] Error in event handler:', err.message);
    }
  }

  /**
   * 处理文件对话框
   */
  _handleFileDialog(hwnd) {
    if (!this.pendingFile) return;

    try {
      console.log('[DialogInterceptor] Handling file dialog for:', this.pendingFile);

      // 方法1：尝试找到文件名输入框（Edit 控件）
      // 类名可能是 "Edit" 或 "Chrome_WidgetWin_1"（Chrome 系）
      let editBox = this.user32.FindWindowExW(hwnd, null, 'Edit', null);
      
      if (!editBox) {
        // 尝试其他可能的类名
        editBox = this.user32.FindWindowExW(hwnd, null, 'Chrome_WidgetWin_1', null);
      }

      if (editBox) {
        // 设置文件路径
        this.user32.SetWindowTextW(editBox, this.pendingFile);
        console.log('[DialogInterceptor] File path set to edit box');
        
        // 模拟按下回车键（IDOK = 1）
        const WM_COMMAND = 0x0111;
        const IDOK = 1;
        
        setTimeout(() => {
          this.user32.PostMessageW(hwnd, WM_COMMAND, IDOK, 0);
          console.log('[DialogInterceptor] Dialog confirmed');
          
          // 触发事件
          this.emit('file:selected', {
            filePath: this.pendingFile,
            hwnd: hwnd.toString()
          });
          
          // 清除待选文件（一次性使用）
          this.pendingFile = null;
        }, 100); // 稍微延迟确保路径已设置
        
        return;
      }

      // 方法2：如果找不到 Edit，尝试使用 UI Automation（更现代的方法）
      this._handleWithUIAutomation(hwnd);

    } catch (err) {
      console.error('[DialogInterceptor] Error handling dialog:', err.message);
    }
  }

  /**
   * 使用 UI Automation 处理（备用方法）
   */
  _handleWithUIAutomation(hwnd) {
    // UI Automation 需要更复杂的 COM 接口
    // 这里简化处理，实际可以使用 @ Nut.js 或 windows-automation 包
    console.log('[DialogInterceptor] Edit box not found, UI Automation not implemented yet');
    
    // 发出事件让上层知道需要手动处理
    this.emit('dialog:manual-required', {
      hwnd: hwnd.toString(),
      filePath: this.pendingFile
    });
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
