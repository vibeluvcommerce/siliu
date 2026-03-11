// src/context-menu/index.js
// 解耦的上下文菜单模块 - 统一使用自定义圆角菜单

const { ipcMain } = require('electron');
const CustomMenuWindow = require('./custom-menu-window');

class ContextMenuModule {
  constructor(coreModule, options = {}) {
    this.core = coreModule;
    
    // 始终使用自定义圆角菜单
    this.customMenu = new CustomMenuWindow(coreModule);
    
    // 设置标签菜单 IPC
    this.setupTabMenuIPC();
    
    // 设置链接/图片菜单 IPC
    this.setupLinkContextMenu();
    
    // 设置文本菜单 IPC
    this.setupTextContextMenu();
  }

  // 文本右键菜单 - 使用自定义圆角菜单
  setupTextContextMenu() {
    ipcMain.on('text:contextmenu', async (e, { text, isEditable, hasSelection }) => {
      const windowManager = this.core.getWindowManagerForSender(e.sender);
      const tabManager = this.core.getTabManagerForSender(e.sender);

      const senderId = e.sender.id;
      let instance = CustomMenuWindow.getInstance(senderId);
      if (!instance) {
        instance = new CustomMenuWindow(this.core);
        instance.registerForWindow(senderId);
      }

      // 获取当前鼠标屏幕位置（与链接/图片菜单一致）
      const { screen } = require('electron');
      const cursorPos = screen.getCursorScreenPoint();
      
      // 获取窗口位置
      const win = windowManager.getWindow();
      const windowBounds = win?.getBounds() || { x: 0, y: 0 };
      
      // 计算相对于窗口的坐标
      const relativeX = cursorPos.x - windowBounds.x;
      const relativeY = cursorPos.y - windowBounds.y;

      await instance.showTextMenu({ text, isEditable, hasSelection }, relativeX, relativeY, windowManager, tabManager, senderId);
    });
  }

  // 标签菜单 IPC 设置
  setupTabMenuIPC() {
    ipcMain.handle('contextmenu:tab', async (e, { viewId, isPinned, x, y }) => {
      const senderId = e.sender.id;
      const windowManager = this.core.getWindowManagerForSender(e.sender);
      const tabManager = this.core.getTabManagerForSender(e.sender);
      
      let instance = CustomMenuWindow.getInstance(senderId);
      if (!instance) {
        instance = new CustomMenuWindow(this.core);
        instance.registerForWindow(senderId);
      }
      
      await instance.showMenu(viewId, isPinned, x, y, windowManager, tabManager);
    });
  }
  
  // 链接/图片右键菜单 - 使用自定义圆角菜单
  setupLinkContextMenu() {
    // 链接右键菜单
    ipcMain.on('link:contextmenu', async (e, { url, text }) => {
      const windowManager = this.core.getWindowManagerForSender(e.sender);
      const tabManager = this.core.getTabManagerForSender(e.sender);
      
      const senderId = e.sender.id;
      let instance = CustomMenuWindow.getInstance(senderId);
      if (!instance) {
        instance = new CustomMenuWindow(this.core);
        instance.registerForWindow(senderId);
      }
      
      // 获取当前鼠标屏幕位置
      const { screen } = require('electron');
      const cursorPos = screen.getCursorScreenPoint();
      
      // 获取窗口位置
      const win = windowManager.getWindow();
      const windowBounds = win?.getBounds() || { x: 0, y: 0 };
      
      // 计算相对于窗口的坐标
      const relativeX = cursorPos.x - windowBounds.x;
      const relativeY = cursorPos.y - windowBounds.y;
      
      await instance.showLinkMenu({ url, text }, relativeX, relativeY, windowManager, tabManager, senderId);
    });

    // 图片右键菜单
    ipcMain.on('image:contextmenu', async (e, { src, alt }) => {
      const windowManager = this.core.getWindowManagerForSender(e.sender);
      const tabManager = this.core.getTabManagerForSender(e.sender);

      const senderId = e.sender.id;
      let instance = CustomMenuWindow.getInstance(senderId);
      if (!instance) {
        instance = new CustomMenuWindow(this.core);
        instance.registerForWindow(senderId);
      }

      // 获取当前鼠标屏幕位置
      const { screen } = require('electron');
      const cursorPos = screen.getCursorScreenPoint();

      // 获取窗口位置
      const win = windowManager.getWindow();
      const windowBounds = win?.getBounds() || { x: 0, y: 0 };

      // 计算相对于窗口的坐标
      const relativeX = cursorPos.x - windowBounds.x;
      const relativeY = cursorPos.y - windowBounds.y;

      await instance.showImageMenu({ src, alt }, relativeX, relativeY, windowManager, tabManager, senderId);
    });
  }
}

module.exports = ContextMenuModule;
