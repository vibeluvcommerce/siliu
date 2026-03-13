const FingerprintManager = require('./fingerprint');

// 主滚动条 CSS - 只针对 html/body
const MAIN_SCROLLBAR_CSS = `
  html::-webkit-scrollbar,
  body::-webkit-scrollbar {
    width: 8px !important;
    height: 8px !important;
  }
  html::-webkit-scrollbar-track,
  body::-webkit-scrollbar-track {
    background: #f1f5f9 !important;
    border-radius: 4px !important;
  }
  html::-webkit-scrollbar-thumb,
  body::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, #94a3b8 0%, #64748b 100%) !important;
    border-radius: 4px !important;
  }
  html::-webkit-scrollbar-thumb:hover,
  body::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(180deg, #64748b 0%, #475569 100%) !important;
  }
  html::-webkit-scrollbar-corner,
  body::-webkit-scrollbar-corner {
    background: transparent !important;
  }
  html, body {
    scrollbar-width: thin !important;
    scrollbar-color: #94a3b8 #f1f5f9 !important;
  }
`;

const { BrowserView } = require('electron');
const path = require('path');
const EventEmitter = require('events');
const AutoFileManager = require('./auto-file-manager');

class TabManager extends EventEmitter {
  constructor(windowManager, options = {}) {
    super();
    this.windowManager = windowManager;
    this.config = {
      titlebarHeight: 40,
      toolbarHeight: 48,
      sidebarWidth: 360,
      agentPanelWidth: 64,  // Agent 栏宽度
      newTabUrl: path.join(__dirname, '../../public/newtab.html'),
      ...options
    };
    
    this.views = new Map();
    this.activeViewId = null;
    this.viewCounter = 0;
    this.closingViews = new Set();
    this.sidebarOpen = false; // 侧边栏状态
    
    // 初始化文件管理器（系统级对话框拦截）
    this.fileManager = new AutoFileManager(this);
    
    // 监听文件管理器事件
    this._setupFileManagerEvents();
    
    // 初始化指纹管理器（反检测）- 启用简化版
    this.fingerprintManager = new FingerprintManager({
      enabled: options.antiDetect !== false, // 默认启用简化版
      profile: options.profile || 'chrome',
      enableWebGL: options.enableWebGL === true,
      enableCanvas: options.enableCanvas === true,
      enablePlugins: options.enablePlugins === true
    });
    
    // 创建独立的 session（如果是子窗口）
    if (options.partition) {
      const { session } = require('electron');
      this.session = session.fromPartition(options.partition);
      
      // 【测试】应用 UA 修改
      this.fingerprintManager.applyToSession(this.session);
    }
  }
  
  /**
   * 设置文件管理器事件监听
   */
  _setupFileManagerEvents() {
    // 监听文件选择事件
    this.fileManager.on('file:selected', (data) => {
      console.log('[TabManager] File auto-selected:', data);
      this.emit('file:selected', data);
    });
    
    // 监听需要手动干预的事件
    this.fileManager.on('dialog:manual-required', (data) => {
      console.warn('[TabManager] Manual dialog intervention required:', data);
      this.emit('dialog:manual-required', data);
    });
    
    // 监听上传点击事件
    this.fileManager.on('upload:click', ({ selector, filePath }) => {
      console.log('[TabManager] Auto upload click:', selector, filePath);
      // 这里会通过 controller 触发点击
      this.emit('upload:click', { selector, filePath });
    });
  }

  /**
   * 配置 Session 以支持网站登录
   */
  _configureSessionForLogin(session) {
    if (!session) return;
    
    console.log('[TabManager] Configuring session for login support');
    
    // 允许第三方 cookie（解决抖音等网站的登录问题）
    session.webRequest.onBeforeSendHeaders((details, callback) => {
      // 确保 cookie 被正确发送
      if (details.requestHeaders) {
        delete details.requestHeaders['X-DevTools-Emulate-Network-Conditions-Client-Id'];
      }
      callback({ requestHeaders: details.requestHeaders });
    });
    
    // 移除可能影响登录的 Electron 特定 header
    session.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = details.responseHeaders || {};
      // 确保 CORS 和 cookie 相关 header 不被修改
      callback({ responseHeaders });
    });
    
    // 设置 cookie 权限
    session.cookies.set({
      url: 'https://www.douyin.com',
      name: 'siliu_session_test',
      value: '1',
      sameSite: 'no_restriction'
    }).catch(() => {});
  }

  /**
   * 创建标签页
   */
  createView(url, sidebarOpen = false) {
    const viewId = `view-${++this.viewCounter}`;
    const mainWindow = this.windowManager.getWindow();
    
    console.log('[TabManager] Creating view:', viewId);

    const viewOptions = {
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        webSecurity: false,  // 允许跨域，解决登录问题
        allowRunningInsecureContent: true,  // 允许混合内容
        plugins: true,
        experimentalFeatures: true,
        preload: path.join(__dirname, '../preload/view-preload.js'),
      },
    };
    
    // 如果有独立 session，使用它
    if (this.session) {
      viewOptions.webPreferences.session = this.session;
    }

    const view = new BrowserView(viewOptions);
    
    // 允许弹窗（登录需要）
    view.webContents.setWindowOpenHandler(({ url, frameName }) => {
      console.log('[TabManager] Window open request:', url);
      // 允许 OAuth 登录弹窗
      if (url.includes('oauth') || url.includes('login') || url.includes('auth') || 
          url.includes('douyin.com') || url.includes('bytedance.com')) {
        return { action: 'allow' };
      }
      // 其他弹窗在当前页打开
      view.webContents.loadURL(url);
      return { action: 'deny' };
    });

    // 设置自动调整大小（关键：确保 BrowserView 跟随窗口变化）
    view.setAutoResize({
      width: true,
      height: true,
      horizontal: false,
      vertical: false
    });

    if (!view.isDestroyed?.()) {
      this.resizeView(view, sidebarOpen);
    }
    mainWindow.setBrowserView(view);

    // 立即注入主滚动条样式（仅 html/body）
    view.webContents.insertCSS(MAIN_SCROLLBAR_CSS).catch(() => {});

    // 再次 resize 确保尺寸正确（窗口可能还未稳定）
    setTimeout(() => {
      if (!view.isDestroyed?.()) {
        this.resizeView(view, sidebarOpen);
      }
    }, 0);

    // 页面加载完成后再 resize 一次（确保视口正确）
    view.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (!view.isDestroyed?.()) {
          this.resizeView(view, sidebarOpen);
        }
      }, 100);
    });

    // 加载 URL
    if (url?.startsWith('http') || url?.startsWith('file://')) {
      view.webContents.loadURL(url);
    } else {
      view.webContents.loadFile(url || this.config.newTabUrl);
    }

    // 应用反检测指纹 - 启用简化版
    this.fingerprintManager.applyToWebContents(view.webContents);

    // 开发模式：打开 DevTools（需要调试时取消注释）
    // view.webContents.openDevTools({ mode: 'detach' });

    // 存储视图
    const viewData = {
      id: viewId,
      view,
      url: url || this.config.newTabUrl,
      title: '新标签页',
      favicon: null,
      isLoading: false,
    };
    
    this.views.set(viewId, viewData);
    this.sidebarOpen = sidebarOpen; // 保存侧边栏状态
    this.setActiveView(viewId, sidebarOpen);

    this.emit('view:created', { viewId, url: viewData.url });
    return viewId;
  }

  /**
   * 关闭标签页
   */
  closeView(viewId) {
    if (this.closingViews.has(viewId) || !this.views.has(viewId)) {
      return;
    }

    this.closingViews.add(viewId);
    console.log('[TabManager] Closing view:', viewId);

    const viewData = this.views.get(viewId);
    const wasActive = (this.activeViewId === viewId);
    const remaining = Array.from(this.views.keys()).filter(id => id !== viewId);

    try {
      viewData.view.webContents.destroy();
    } catch (err) {
      console.error('[TabManager] Failed to destroy view:', err.message);
    }

    this.views.delete(viewId);
    this.closingViews.delete(viewId);
    
    // 清除 activeViewId（如果关闭的是当前活动标签）
    if (wasActive) {
      this.activeViewId = null;
    }

    // 切换活动标签
    if (wasActive) {
      if (remaining.length > 0) {
        this.setActiveView(remaining[remaining.length - 1], this.sidebarOpen);
      } else {
        this.createView(null, this.sidebarOpen); // 创建新标签
      }
    }

    this.emit('view:closed', { viewId });
  }

  /**
   * 设置活动视图
   */
  setActiveView(viewId, sidebarOpen = false) {
    if (!this.views.has(viewId)) return;

    const viewData = this.views.get(viewId);
    
    // 检查 view 是否已被销毁
    if (viewData.view?.isDestroyed?.()) {
      console.warn('[TabManager] Cannot activate destroyed view:', viewId);
      return;
    }

    this.activeViewId = viewId;
    this.sidebarOpen = sidebarOpen; // 保存侧边栏状态
    const mainWindow = this.windowManager.getWindow();

    if (!viewData.view.isDestroyed?.()) {
      mainWindow.setBrowserView(viewData.view);
      this.resizeView(viewData.view, sidebarOpen);
    }

    this.emit('view:activated', { 
      viewId, 
      viewData,
      canGoBack: viewData.view.webContents.canGoBack(),
      canGoForward: viewData.view.webContents.canGoForward(),
    });

    return viewData;
  }

  /**
   * 调整视图大小
   */
  resizeView(view, sidebarOpen = false) {
    // 检查 view 是否有效
    if (!view || view.isDestroyed?.()) {
      return;
    }

    try {
      // 获取窗口状态
      const mainWindow = this.windowManager.getWindow();
      const isFullScreen = mainWindow?.isFullScreen() || false;
      const isMaximized = mainWindow?.isMaximized() || false;
      
      // 使用 getContentBounds 获取客户区尺寸（不包括边框和标题栏）
      const contentBounds = mainWindow.getContentBounds();
      const windowWidth = contentBounds.width;
      const windowHeight = contentBounds.height;
      
      const totalHeaderHeight = this.config.titlebarHeight + this.config.toolbarHeight;
      
      // 计算可用宽度（始终减去 Agent 栏，再根据 sidebar 减去侧边栏）
      let availableWidth = windowWidth - this.config.agentPanelWidth;
      if (sidebarOpen) {
        availableWidth -= this.config.sidebarWidth;
      }
      availableWidth = Math.max(availableWidth, 300);
      
      // 计算 view 的高度（减去标题栏和工具栏）
      const viewHeight = Math.max(windowHeight - totalHeaderHeight, 300);
      
      // 调试日志
      console.log('[TabManager] resizeView:', { 
        platform: process.platform,
        isFullScreen, 
        isMaximized, 
        sidebarOpen, 
        contentBounds,
        agentPanelWidth: this.config.agentPanelWidth,
        sidebarWidth: sidebarOpen ? this.config.sidebarWidth : 0,
        availableWidth,
        viewHeight
      });
      
      // 计算 BrowserView 位置（留出左侧 Agent 栏空间）
      view.setBounds({
        x: this.config.agentPanelWidth,  // 从 Agent 栏右侧开始
        y: totalHeaderHeight,
        width: availableWidth,
        height: viewHeight,
      });

      // 关键：通过修改 document.documentElement 的宽高来强制页面重排
      // 这样 window.innerWidth/Height 才会真正改变
      setImmediate(() => {
        if (!view.isDestroyed?.()) {
          view.webContents?.executeJavaScript(`
            (function() {
              // 方法1：临时修改 html 元素的尺寸来触发重排
              const html = document.documentElement;
              const originalWidth = html.style.width;
              const originalHeight = html.style.height;
              
              // 强制设置尺寸为 100%，这会基于新的 BrowserView 尺寸计算
              html.style.width = '100vw';
              html.style.height = '100vh';
              
              // 触发强制重排
              void html.offsetWidth;
              
              // 恢复原始样式（如果有）
              if (originalWidth) html.style.width = originalWidth;
              if (originalHeight) html.style.height = originalHeight;
              
              // 方法2：触发 resize 事件
              window.dispatchEvent(new Event('resize', { bubbles: true }));
              
              // 方法3：对于使用 ResizeObserver 的页面
              if (window.ResizeObserver) {
                // 创建临时的 resize observer 来触发观察器
                const ro = new ResizeObserver(() => {});
                ro.observe(document.body);
                setTimeout(() => ro.disconnect(), 0);
              }
              
              console.log('[Siliu] Viewport updated, innerWidth:', window.innerWidth);
            })()
          `).catch(() => {});
        }
      });
    } catch (err) {
      console.error('[TabManager] Failed to resize view:', err.message);
    }
  }

  /**
   * 调整活动视图
   */
  resizeActiveView(sidebarOpen = false) {
    if (!this.activeViewId) return;
    const viewData = this.views.get(this.activeViewId);
    if (viewData?.view && !viewData.view.isDestroyed?.()) {
      this.sidebarOpen = sidebarOpen; // 同步 sidebarOpen 状态
      this.resizeView(viewData.view, sidebarOpen);
    }
  }

  // ========== Getters ==========
  getView(viewId) {
    return this.views.get(viewId)?.view || null;
  }

  getViewData(viewId) {
    return this.views.get(viewId);
  }

  getActiveView() {
    return this.activeViewId ? this.views.get(this.activeViewId) : null;
  }

  getActiveViewId() {
    return this.activeViewId;
  }

  getAllViews() {
    return Array.from(this.views.entries()).map(([id, data]) => ({
      id,
      url: data.url,
      title: data.title,
      favicon: data.favicon,
    }));
  }

  hasView(viewId) {
    return this.views.has(viewId);
  }

  // ========== 导航方法 ==========
  goBack(viewId) {
    const viewData = this.views.get(viewId);
    if (viewData?.view?.webContents?.canGoBack()) {
      viewData.view.webContents.goBack();
      return true;
    }
    return false;
  }

  goForward(viewId) {
    const viewData = this.views.get(viewId);
    if (viewData?.view?.webContents?.canGoForward()) {
      viewData.view.webContents.goForward();
      return true;
    }
    return false;
  }

  reload(viewId) {
    const viewData = this.views.get(viewId);
    if (viewData?.view?.webContents) {
      viewData.view.webContents.reload();
      return true;
    }
    return false;
  }
}

module.exports = TabManager;
