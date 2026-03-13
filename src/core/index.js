/**
 * Module 2: Core
 * 浏览器核心 - 协调各个子模块
 *
 * 子模块：
 * - WindowManager: 主窗口管理
 * - TabManager: 标签页管理
 * - ViewEventHandler: 页面事件处理
 * - IPCHandlers: IPC 处理器
 */

const { app, ipcMain, shell, BrowserWindow } = require('electron');
const EventEmitter = require('events');
const WindowManager = require('./window-manager');
const TabManager = require('./tab-manager');
const ViewEventHandler = require('./view-event-handler');
const TaskbarModule = require('./taskbar');
const ToastModule = require('./toast');
const { IPCHandlers } = require('./ipc-handlers');

// 导出事件常量
const { 
  AI_EVENTS, 
  COPILOT_EVENTS, 
  CONTROLLER_EVENTS, 
  APP_EVENTS,
  OPENCLAW_EVENTS 
} = require('./events');

class CoreModule extends EventEmitter {
  constructor() {
    super();

    // 子模块
    this.windowManager = new WindowManager();
    this.tabManager = new TabManager(this.windowManager, {
      antiDetect: true,
      enableWebGL: true,
      enableCanvas: true,
      enablePlugins: true
    });
    this.eventHandler = new ViewEventHandler(this.tabManager, this.windowManager);
    this.taskbar = null;
    this.toast = null;
    this.ipcHandlers = null;

    // 存储分离的窗口
    this.detachedWindows = new Map();

    // 侧边栏状态
    this.sidebarOpen = false;

    // 公开属性（保持兼容性）
    this.mainWindow = null;
    this.views = this.tabManager.views;
    this.activeViewId = null;

    // 配置
    this.CONFIG = this.tabManager.config;
    this.NEW_TAB_URL = this.tabManager.config.newTabUrl;

    // Copilot 设置窗口
    this.copilotSettingsWindow = null;
  }

  /**
   * 初始化
   */
  async initialize() {
    this.setupAppEvents();
    this.setupSubModuleEvents();
  }

  /**
   * 设置应用事件
   */
  setupAppEvents() {
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', () => {
      if (!this.windowManager.getWindow()) {
        this.createWindow();
      }
    });
  }

  /**
   * 设置子模块事件连接
   */
  setupSubModuleEvents() {
    // 窗口大小变化时调整视图
    this.windowManager.onResize = () => {
      // Linux 适配：添加延迟确保窗口尺寸已稳定
      if (process.platform === 'linux') {
        setTimeout(() => {
          this.tabManager.resizeActiveView(this.sidebarOpen);
        }, 50);
      } else {
        this.tabManager.resizeActiveView(this.sidebarOpen);
      }
    };

    // 转发 TabManager 事件到 Core
    this.tabManager.on('view:created', (data) => {
      this.views = this.tabManager.views;
      this.eventHandler.setupEvents(data.viewId);
      this.windowManager.sendToRenderer('tab-created', {
        id: data.viewId,
        url: data.url,
        title: data.title || '新标签页'
      });
    });

    this.tabManager.on('view:closed', (data) => {
      this.views = this.tabManager.views;
      this.windowManager.sendToRenderer('tab-closed', { id: data.viewId });
    });

    this.tabManager.on('view:activated', (data) => {
      this.activeViewId = data.viewId;
      const viewData = this.tabManager.getViewData(data.viewId);
      this.windowManager.sendToRenderer('tab-activated', {
        id: data.viewId,
        url: viewData?.view?.webContents?.getURL() || '',
        canGoBack: viewData?.view?.webContents?.canGoBack() || false,
        canGoForward: viewData?.view?.webContents?.canGoForward() || false,
        isLoading: viewData?.view?.webContents?.isLoading() || false
      });
    });

    this.tabManager.on('view:title-updated', (data) => {
      this.windowManager.sendToRenderer('tab-title-updated', {
        id: data.viewId,
        title: data.title
      });
    });

    this.tabManager.on('view:url-changed', (data) => {
      this.windowManager.sendToRenderer('tab-url-changed', {
        id: data.viewId,
        url: data.url
      });
    });

    this.tabManager.on('view:favicon-updated', (data) => {
      this.windowManager.sendToRenderer('tab-favicon-updated', {
        id: data.viewId,
        favicon: data.favicon
      });
    });

    this.tabManager.on('view:loading-started', (data) => {
      this.windowManager.sendToRenderer('tab-loading-started', { id: data.viewId });
    });

    this.tabManager.on('view:loading-stopped', (data) => {
      this.windowManager.sendToRenderer('tab-loading-stopped', { 
        id: data.viewId,
        canGoBack: data.canGoBack,
        canGoForward: data.canGoForward
      });
    });

    // 拦截 sendToRenderer 以处理标签激活时的状态更新
    const originalSendToRenderer = this.windowManager.sendToRenderer.bind(this.windowManager);
    this.windowManager.sendToRenderer = (channel, data) => {
      originalSendToRenderer(channel, data);
      
      if (channel === 'tab-loading-stopped' && data.id) {
        setTimeout(() => {
          if (this.tabManager.getActiveViewId() === data.id) {
            this.emit('view:state-update', {
              canGoBack: data.canGoBack,
              canGoForward: data.canGoForward
            });
          }
        }, 50);
      }
    };
  }

  /**
   * 设置 IPC 处理器
   * @param {Object} options - 依赖注入选项
   */
  setupIPC(options = {}) {
    this.ipcHandlers = new IPCHandlers({
      core: this,
      tabManager: this.tabManager,
      windowManager: this.windowManager,
      detachedWindows: this.detachedWindows,
      configManager: options.configManager,  // 传递 configManager
      getController: options.getController,
      getCopilot: options.getCopilot,
      getAIService: options.getAIService,
      getAdblock: options.getAdblock,
      sidebarOpen: this.sidebarOpen
    });
    this.ipcHandlers.setup();
  }

  // ========== 窗口和视图管理 ==========

  async createWindow() {
    this.mainWindow = await this.windowManager.createWindow();
    
    // 跟踪主窗口聚焦状态
    this.mainWindow.on('focus', () => {
      global.lastFocusedWindowId = 'main';
    });
    
    // 创建初始标签页
    setTimeout(async () => {
      const initialUrl = this.NEW_TAB_URL;
      this.createView(initialUrl);
      await this.initializeModules();
    }, 100);

    return this.mainWindow;
  }

  async initializeModules() {
    if (!this.taskbar) {
      this.taskbar = new TaskbarModule({
        windowManager: this.windowManager,
        tabManager: this.tabManager
      });
    }

    if (!this.toast) {
      this.toast = new ToastModule(this.windowManager.getWindow());
    }

    setTimeout(() => {
      this.windowManager.sendToRenderer('window:focused', { windowId: 'main' });
    }, 100);
  }

  createView(url, sidebarOpen = this.sidebarOpen) {
    return this.tabManager.createView(url, sidebarOpen);
  }

  closeView(viewId) {
    this.tabManager.closeView(viewId);
  }

  setActiveView(viewId) {
    this.tabManager.setActiveView(viewId, this.sidebarOpen);
  }

  getActiveView() {
    return this.tabManager.getActiveView();
  }

  getViewData(viewId) {
    return this.tabManager.getViewData(viewId);
  }

  getViews() {
    return this.tabManager.getAllViews();
  }

  sendToRenderer(channel, data) {
    this.windowManager.sendToRenderer(channel, data);
  }

  // ========== 分离窗口管理 ==========

  async createNewWindow(url, sourceWindow = null) {
    try {
      return await this._doCreateNewWindow(url, sourceWindow);
    } catch (err) {
      console.error('[Core] Failed to create new window:', err.message);
      throw err;
    }
  }

  async _doCreateNewWindow(url, sourceWindow = null) {
    // 获取源窗口尺寸，保持一致的 17:9 比例
    let windowWidth = 1600;
    let windowHeight = 900;
    if (sourceWindow && !sourceWindow.isDestroyed()) {
      const bounds = sourceWindow.getBounds();
      windowWidth = bounds.width;
      windowHeight = bounds.height;
    }

    const newWindow = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      minWidth: 800,
      minHeight: 600,
      show: false,
      frame: false,  // 无边框窗口
      titleBarStyle: 'hidden',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: require('path').join(__dirname, '../preload/index.js'),
        sandbox: false,
        webSecurity: false
      }
    });

    const windowId = `detached-${Date.now()}`;

    // 移除菜单栏
    newWindow.setMenu(null);

    // 加载 shell.html
    const path = require('path');
    newWindow.loadFile(path.join(__dirname, '../../public/shell.html'));

    // 分离窗口的 WindowManager（先创建）
    const DetachedWindowManager = require('./window-manager');
    const detachedWindowManager = new DetachedWindowManager({
      window: newWindow,
      isDetached: true
    });

    // 分离窗口的 TabManager（传入 windowManager）
    const DetachedTabManager = require('./tab-manager');
    const detachedTabManager = new DetachedTabManager(detachedWindowManager, {
      isDetached: true,
      antiDetect: true,
      enableWebGL: true,
      enableCanvas: true,
      enablePlugins: true
    });

    // 设置分离窗口的 resize 回调
    detachedWindowManager.onResize = () => {
      const data = this.detachedWindows.get(windowId);
      if (data) {
        data.tabManager.resizeActiveView(data.sidebarOpen);
      }
    };

    // 注册到 AdBlock
    if (global.adblockExtension) {
      global.adblockExtension.registerWindow(detachedWindowManager);
    }

    // 为分离窗口创建 TabListWindow 实例
    const TabListWindow = require('./tab/tab-list-window');
    const tabListWindow = new TabListWindow({
      mainWindow: newWindow,
      windowManager: detachedWindowManager,
      tabManager: detachedTabManager,
      getViews: () => detachedTabManager.getAllViews(),
      activeViewId: () => detachedTabManager.getActiveViewId(),
      setActiveView: (viewId) => detachedTabManager.setActiveView(viewId),
      closeView: (viewId) => detachedTabManager.closeView(viewId),
      sendToRenderer: (channel, data) => detachedWindowManager.sendToRenderer(channel, data)
    });
    
    // 保存 webContents ID（在 closed 事件前）
    const windowWebContentsId = newWindow.webContents.id;
    tabListWindow.registerInstanceWithId(windowWebContentsId);

    // 存储分离窗口信息
    const eventHandlers = []; // 存储事件处理器以便清理
    
    this.detachedWindows.set(windowId, {
      window: newWindow,
      windowManager: detachedWindowManager,
      tabManager: detachedTabManager,
      tabListWindow: tabListWindow,
      windowWebContentsId: windowWebContentsId,
      sourceWindow,
      sidebarOpen: false,
      eventHandlers // 存储处理器引用
    });

    // 分离窗口的 ViewEventHandler
    const ViewEventHandler = require('./view-event-handler');
    const detachedEventHandler = new ViewEventHandler(detachedTabManager, detachedWindowManager);

    // 设置分离窗口的标签事件转发
    const handlers = {
      viewCreated: (data) => {
        detachedEventHandler.setupEvents(data.viewId);
        detachedWindowManager.sendToRenderer('tab-created', {
          id: data.viewId,
          url: data.url,
          title: data.title || '新标签页'
        });
      },
      viewClosed: (data) => {
        detachedWindowManager.sendToRenderer('tab-closed', { id: data.viewId });
      },
      viewActivated: (data) => {
        const viewData = detachedTabManager.getViewData(data.viewId);
        detachedWindowManager.sendToRenderer('tab-activated', {
          id: data.viewId,
          url: viewData?.view?.webContents?.getURL() || '',
          canGoBack: viewData?.view?.webContents?.canGoBack() || false,
          canGoForward: viewData?.view?.webContents?.canGoForward() || false,
          isLoading: viewData?.view?.webContents?.isLoading() || false
        });
      },
      viewTitleUpdated: (data) => {
        detachedWindowManager.sendToRenderer('tab-title-updated', {
          id: data.viewId,
          title: data.title
        });
      },
      viewFaviconUpdated: (data) => {
        detachedWindowManager.sendToRenderer('tab-favicon-updated', {
          id: data.viewId,
          favicon: data.favicon
        });
      },
      viewUrlChanged: (data) => {
        detachedWindowManager.sendToRenderer('tab-url-changed', {
          id: data.viewId,
          url: data.url
        });
      },
      viewLoadingStarted: (data) => {
        detachedWindowManager.sendToRenderer('tab-loading-started', { id: data.viewId });
      },
      viewLoadingStopped: (data) => {
        detachedWindowManager.sendToRenderer('tab-loading-stopped', {
          id: data.viewId,
          canGoBack: data.canGoBack,
          canGoForward: data.canGoForward
        });
      }
    };

    detachedTabManager.on('view:created', handlers.viewCreated);
    detachedTabManager.on('view:closed', handlers.viewClosed);
    detachedTabManager.on('view:activated', handlers.viewActivated);
    detachedTabManager.on('view:title-updated', handlers.viewTitleUpdated);
    detachedTabManager.on('view:favicon-updated', handlers.viewFaviconUpdated);
    detachedTabManager.on('view:url-changed', handlers.viewUrlChanged);
    detachedTabManager.on('view:loading-started', handlers.viewLoadingStarted);
    detachedTabManager.on('view:loading-stopped', handlers.viewLoadingStopped);

    // 存储处理器以便清理
    eventHandlers.push(
      ['view:created', handlers.viewCreated],
      ['view:closed', handlers.viewClosed],
      ['view:activated', handlers.viewActivated],
      ['view:title-updated', handlers.viewTitleUpdated],
      ['view:favicon-updated', handlers.viewFaviconUpdated],
      ['view:url-changed', handlers.viewUrlChanged],
      ['view:loading-started', handlers.viewLoadingStarted],
      ['view:loading-stopped', handlers.viewLoadingStopped]
    );

    newWindow.once('ready-to-show', () => {
      newWindow.show();

      // 创建初始视图（Copilot 默认展开）
      const currentUrl = url || this.NEW_TAB_URL;
      detachedTabManager.createView(currentUrl, true);
      
      // 通知 shell.html 展开 sidebar UI
      setTimeout(() => {
        detachedWindowManager.sendToRenderer('sidebar:open');
      }, 100);

      // 通知 Copilot 新窗口创建
      const copilot = this.ipcHandlers?.getCopilot?.();
      if (copilot) {
        copilot.createCopilot(windowId);
      }

      // 同步连接状态并使用 ai:toast 事件显示提示（与主窗口一致）
      const aiService = this.ipcHandlers?.getAIService?.();
      const isConnected = aiService?.isConnected() || false;
      const connInfo = aiService?.getConnectionInfo?.();

      setTimeout(() => {
        if (isConnected && connInfo) {
          // 已连接 - 与主窗口使用相同的 ai:toast 事件和文案
          const serviceName = connInfo.isLocal ? 'OpenClaw 本地服务' : 'Siliu AI 云端服务';
          detachedWindowManager.sendToRenderer('ai:toast', {
            message: `已连接到 ${serviceName}`,
            type: 'success'
          });
          detachedWindowManager.sendToRenderer('ai:connected', { service: connInfo.mode || 'openclaw' });
          detachedWindowManager.sendToRenderer('openclaw:connected', { service: connInfo.mode || 'openclaw' });
        } else {
          // 检查是否有配置，有配置但未连接才显示失败提示
          const configManager = this.ipcHandlers?.configManager;
          const serviceType = configManager?.get('serviceType') || 'local';
          let hasConfig = false;

          if (serviceType === 'cloud') {
            hasConfig = !!configManager?.get('cloud.apiKey');
          } else {
            hasConfig = !!configManager?.get('local.token');
          }

          // 只有有配置但未连接时才显示失败提示（无配置时静默）
          if (hasConfig) {
            const serviceName = connInfo?.isLocal !== false ? 'OpenClaw 本地服务' : 'Siliu AI 云端服务';
            detachedWindowManager.sendToRenderer('ai:toast', {
              message: `连接 ${serviceName} 失败`,
              type: 'error'
            });
          }
          detachedWindowManager.sendToRenderer('ai:disconnected', {});
          detachedWindowManager.sendToRenderer('openclaw:disconnected', {});
        }
      }, 800);
    });

    // 跟踪窗口聚焦状态（用于系统菜单新建标签页）
    newWindow.on('focus', () => {
      global.lastFocusedWindowId = windowId;
    });

    newWindow.on('closed', () => {
      const data = this.detachedWindows.get(windowId);
      
      // 销毁 Copilot 实例
      const copilot = this.ipcHandlers?.getCopilot?.();
      if (copilot) {
        copilot.destroyCopilot(windowId);
      }

      // 注销 CustomMenuWindow 实例（使用保存的 ID）
      if (data?.windowWebContentsId) {
        const CustomMenuWindow = require('./menu/custom-menu-window');
        const customMenu = CustomMenuWindow.getInstance(data.windowWebContentsId);
        if (customMenu) {
          customMenu.unregisterForWindow();
        }
      }

      // 注销 TabListWindow 实例
      if (data?.tabListWindow) {
        data.tabListWindow.unregisterInstance();
      }

      // 清理事件监听器
      if (data?.eventHandlers && data?.tabManager) {
        for (const [event, handler] of data.eventHandlers) {
          data.tabManager.off(event, handler);
        }
      }

      if (data?.tabManager) {
        // 关闭所有标签页
        for (const [viewId] of data.tabManager.views) {
          try {
            data.tabManager.closeView(viewId);
          } catch {}
        }
      }
      this.detachedWindows.delete(windowId);
    });

    return { windowId, window: newWindow };
  }

  // ========== 工具方法（供 IPC 使用） ==========

  _getWindowIdFromSender(sender) {
    const senderId = sender.id;
    const mainWindow = this.windowManager.getWindow();
    const mainWindowId = mainWindow?.webContents?.id;

    if (mainWindowId === senderId) {
      return 'main';
    }

    for (const [windowId, data] of this.detachedWindows) {
      if (data.window?.webContents?.id === senderId) {
        return windowId;
      }
    }

    return null;
  }

  // ========== 供其他模块使用的方法 ==========
  
  getWindowManagerForSender(sender) {
    const senderId = sender.id;
    const mainWindow = this.windowManager.getWindow();
    const mainWindowId = mainWindow?.webContents?.id;

    // 检查主窗口
    if (mainWindowId === senderId) {
      return this.windowManager;
    }

    // 检查主窗口的 BrowserViews
    for (const [viewId, viewData] of this.tabManager.views) {
      if (viewData.view?.webContents?.id === senderId) {
        return this.windowManager;
      }
    }

    // 检查分离窗口
    for (const [windowId, data] of this.detachedWindows) {
      if (data.window?.webContents?.id === senderId) {
        return data.windowManager;
      }
      // 检查分离窗口的 BrowserViews
      for (const [viewId, viewData] of data.tabManager.views) {
        if (viewData.view?.webContents?.id === senderId) {
          return data.windowManager;
        }
      }
    }

    return this.windowManager;
  }

  getTabManagerForSender(sender) {
    const senderId = sender.id;
    const mainWindow = this.windowManager.getWindow();
    const mainWindowId = mainWindow?.webContents?.id;

    // 检查主窗口
    if (mainWindowId === senderId) {
      return this.tabManager;
    }

    // 检查主窗口的 BrowserViews
    for (const [viewId, viewData] of this.tabManager.views) {
      if (viewData.view?.webContents?.id === senderId) {
        return this.tabManager;
      }
    }

    // 检查分离窗口
    for (const [windowId, data] of this.detachedWindows) {
      if (data.window?.webContents?.id === senderId) {
        return data.tabManager;
      }
      // 检查分离窗口的 BrowserViews
      for (const [viewId, viewData] of data.tabManager.views) {
        if (viewData.view?.webContents?.id === senderId) {
          return data.tabManager;
        }
      }
    }

    return this.tabManager;
  }
}

module.exports = CoreModule;
module.exports.AI_EVENTS = AI_EVENTS;
module.exports.COPILOT_EVENTS = COPILOT_EVENTS;
module.exports.CONTROLLER_EVENTS = CONTROLLER_EVENTS;
module.exports.APP_EVENTS = APP_EVENTS;
module.exports.OPENCLAW_EVENTS = OPENCLAW_EVENTS;
