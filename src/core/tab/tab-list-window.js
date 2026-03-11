// src/core/tab/tab-list-window.js
// 标签列表置顶窗口 - 每个窗口独立实例

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// 存储所有 TabListWindow 实例（按父窗口 ID）
const instances = new Map();
// 记录当前打开的标签列表窗口属于哪个父窗口
const windowToParent = new Map();

class TabListWindow {
  constructor(coreModule) {
    this.core = coreModule;
    this.listWindow = null;
    this.windowId = null;
    
    // 注册实例
    this.registerInstance();
  }
  
  registerInstance() {
    // 获取主窗口 ID
    const mainWindow = this.core.mainWindow;
    if (mainWindow) {
      this.windowId = mainWindow.webContents.id;
      instances.set(this.windowId, this);
      console.log('[TabListWindow] Registered instance for window:', this.windowId);
    }
  }

  // 手动注册实例（用于子窗口）
  registerInstanceWithId(windowId) {
    this.windowId = windowId;
    instances.set(windowId, this);
    console.log('[TabListWindow] Registered instance with ID:', windowId);
  }

  // 注销实例（窗口关闭时调用）
  unregisterInstance() {
    if (this.windowId) {
      instances.delete(this.windowId);
      console.log('[TabListWindow] Unregistered instance for window:', this.windowId);
    }
    // 清理关联的 menuToParent 记录
    for (const [listId, parentId] of windowToParent.entries()) {
      if (parentId === this.windowId) {
        windowToParent.delete(listId);
      }
    }
  }

  // 静态方法：获取对应窗口的实例
  static getInstanceForWindow(windowId) {
    return instances.get(windowId);
  }

  async showWindow(tabs, bounds) {
    const mainWindow = this.core.mainWindow;
    if (!mainWindow) {
      console.error('[TabListWindow] No mainWindow available');
      return;
    }

    // 关闭已有窗口
    if (this.listWindow) {
      this.hideWindow();
    }

    // 窗口尺寸 - 固定高度 380px
    const width = 280;
    const FIXED_HEIGHT = 380;
    const height = FIXED_HEIGHT;

    // 获取主窗口边界和位置
    const mainBounds = mainWindow.getBounds();
    
    // 获取当前显示器的工作区域
    const { screen } = require('electron');
    const display = screen.getDisplayNearestPoint({ x: mainBounds.x, y: mainBounds.y });
    const workArea = display.workArea;
    
    // 计算位置：固定在 titlebar 下方（左侧对齐）
    let winX, winY;
    
    // X 坐标：优先使用按钮的 X 位置，否则左侧 4px
    if (bounds) {
      winX = bounds.x;
    } else {
      winX = mainBounds.x + 4;
    }
    
    // Y 坐标：固定在 titlebar 下方
    // 关键：窗口模式和全屏模式使用不同的计算方式
    if (mainWindow.isFullScreen() || mainWindow.isMaximized()) {
      // 全屏/最大化模式：使用工作区域顶部作为基准
      winY = workArea.y + 40;
    } else {
      // 窗口模式：使用窗口实际位置作为基准（原有方式）
      winY = mainBounds.y + 40;
    }
    
    // 确保不会超出工作区域底部
    const maxY = workArea.y + workArea.height - height - 10;
    if (winY > maxY) {
      winY = maxY;
    }
    // 确保不会超出工作区域顶部
    winY = Math.max(winY, workArea.y + 10);

    // 边界检测
    const finalWidth = Math.min(width, mainBounds.width - 8);
    const finalHeight = Math.min(height, mainBounds.height - 54);

    // 创建窗口
    this.listWindow = new BrowserWindow({
      width: finalWidth,
      height: finalHeight,
      x: Math.round(winX),
      y: Math.round(winY),
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../../preload/tablist-preload.js'),
      },
    });

    // 记录这个标签列表窗口属于哪个父窗口
    const parentId = mainWindow.webContents.id;
    const listWindowId = this.listWindow.webContents.id;
    windowToParent.set(listWindowId, parentId);
    console.log('[TabListWindow] Opened list window', listWindowId, 'for parent', parentId);

    this.listWindow.setHasShadow(true);

    // 加载 HTML 文件
    await this.listWindow.loadFile(path.join(__dirname, '../../../public/tablist.html'));
    
    // 发送初始数据
    this.listWindow.webContents.send('tablist:init', { tabs });
    
    // 直接显示
    this.listWindow.show();

    // 失焦关闭
    this.listWindow.on('blur', () => {
      setTimeout(() => this.hideWindow(), 100);
    });

    // 主窗口移动时关闭
    const closeHandler = () => this.hideWindow();
    mainWindow.once('move', closeHandler);
    mainWindow.once('resize', closeHandler);
    
    this.listWindow.on('closed', () => {
      windowToParent.delete(listWindowId);
      mainWindow.removeListener('move', closeHandler);
      mainWindow.removeListener('resize', closeHandler);
    });
  }

  hideWindow() {
    if (this.listWindow && !this.listWindow.isDestroyed()) {
      this.listWindow.close();
      this.listWindow = null;
    }
  }

  refreshList() {
    if (!this.listWindow || this.listWindow.isDestroyed()) return;

    const views = this.core.getViews();
    const activeId = this.core.activeViewId || this.core.tabManager?.getActiveViewId?.();
    
    const tabs = views.map(v => ({
      viewId: v.id,
      title: v.title,
      favicon: v.favicon,
      isActive: v.id === activeId,
      isPinned: false
    })).reverse();

    if (tabs.length === 0) {
      this.hideWindow();
      return;
    }

    this.listWindow.webContents.send('tablist:update', { tabs });
  }
  
  // 处理切换标签
  switchTab(viewId) {
    console.log('[TabListWindow] switchTab called:', viewId);
    this.core.setActiveView(viewId);
    this.hideWindow();
  }
  
  // 处理关闭标签
  closeTab(viewId) {
    console.log('[TabListWindow] closeTab called:', viewId);
    
    // 通知 shell.html 移除标签
    this.core.sendToRenderer('tablist:close-tab', { viewId });
    
    // 关闭视图
    this.core.closeView(viewId);
    
    // 刷新列表
    setTimeout(() => this.refreshList(), 100);
  }
}

// 全局 IPC 处理 - 根据标签列表窗口 ID 找到对应的父窗口实例
ipcMain.handle('tablist:show', async (e, { tabs, bounds }) => {
  const senderId = e.sender.id;
  console.log('[TabList IPC] Show requested from window:', senderId);
  
  // 直接根据 sender ID 查找实例
  let instance = TabListWindow.getInstanceForWindow(senderId);
  
  // 如果没找到，可能是从标签列表窗口发送的，查找它的父窗口
  if (!instance && windowToParent.has(senderId)) {
    const parentId = windowToParent.get(senderId);
    console.log('[TabList IPC] Sender is list window, parent:', parentId);
    instance = TabListWindow.getInstanceForWindow(parentId);
  }
  
  if (instance) {
    await instance.showWindow(tabs, bounds);
  } else {
    console.error('[TabList IPC] No instance found for window:', senderId);
  }
});

ipcMain.on('tablist:hide', (e) => {
  const senderId = e.sender.id;
  let instance = TabListWindow.getInstanceForWindow(senderId);
  
  if (!instance && windowToParent.has(senderId)) {
    const parentId = windowToParent.get(senderId);
    instance = TabListWindow.getInstanceForWindow(parentId);
  }
  
  if (instance) {
    instance.hideWindow();
  }
});

ipcMain.on('tablist:switch', (e, { viewId }) => {
  const senderId = e.sender.id;
  console.log('[TabList IPC] Switch from sender:', senderId, 'viewId:', viewId);
  
  // 标签列表窗口发送的消息，查找它的父窗口
  let parentId = windowToParent.get(senderId);
  if (parentId) {
    console.log('[TabList IPC] Found parent:', parentId);
    const instance = TabListWindow.getInstanceForWindow(parentId);
    if (instance) {
      instance.switchTab(viewId);
      return;
    }
  }
  
  // 直接查找
  const instance = TabListWindow.getInstanceForWindow(senderId);
  if (instance) {
    instance.switchTab(viewId);
  } else {
    console.error('[TabList IPC] No instance found for switch, sender:', senderId);
  }
});

ipcMain.on('tablist:close', (e, { viewId }) => {
  const senderId = e.sender.id;
  console.log('[TabList IPC] Close from sender:', senderId, 'viewId:', viewId);
  
  // 标签列表窗口发送的消息，查找它的父窗口
  let parentId = windowToParent.get(senderId);
  if (parentId) {
    console.log('[TabList IPC] Found parent:', parentId);
    const instance = TabListWindow.getInstanceForWindow(parentId);
    if (instance) {
      instance.closeTab(viewId);
      return;
    }
  }
  
  // 直接查找
  const instance = TabListWindow.getInstanceForWindow(senderId);
  if (instance) {
    instance.closeTab(viewId);
  } else {
    console.error('[TabList IPC] No instance found for close, sender:', senderId);
  }
});

module.exports = TabListWindow;
