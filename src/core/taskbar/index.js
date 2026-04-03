/**
 * Taskbar Module - 系统任务栏功能
 */

const { app, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// 默认 16x16 空白图标
const FALLBACK_ICON = nativeImage?.createFromDataURL?.(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAXklEQVQ4T2NkoBAwUqifYdQABjrQ0tLyn0zlTExMGBgYGJiYmJig9CMzSIYx0NXV9R9ZkI2NjQGZgWQYAy0tLf+RdVy+fPk/xIB//4lxAEmGAZ8+ffqP7EO8XoDLawDkNl2qM/8v9AAAAABJRU5ErkJggg=='
);

class TaskbarModule {
  constructor(deps) {
    this.core = deps.windowManager ? null : deps;
    this.windowManager = deps.windowManager || deps.windowManager;
    this.tabManager = deps.tabManager || deps.tabManager;
    this.eventHandler = deps.eventHandler || deps.eventHandler;
    this.currentProgress = -1;

    this.setupJumpList();
    this.setupDockMenu();
    this.setupTray();
    this.setupIPC();
  }

  setupTray() {
    if (process.platform === 'darwin') return;  // macOS 使用 Dock 菜单，不创建托盘

    const { Tray, Menu, BrowserWindow } = require('electron');
    // 托盘使用 win-app-pallet.png 图标，回退到 app.png
    const trayIconPath = path.join(__dirname, '../../../assets/win-app-pallet.png');
    const iconPath = fs.existsSync(trayIconPath) ? trayIconPath : path.join(__dirname, '../../../assets/app.png');
    const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : FALLBACK_ICON;

    this.tray = new Tray(icon);
    this.tray.setToolTip('Siliu - AI Copilot Browser');
    
    // 点击托盘图标打开主窗口
    this.tray.on('click', () => {
      const win = this.windowManager?.getWindow?.() || this.core?.mainWindow;
      if (win) {
        if (win.isMinimized()) win.restore();
        if (!win.isVisible()) win.show();
        win.focus();
      }
    });
    
    this.tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: '打开主窗口',
        click: () => {
          const win = this.windowManager?.getWindow?.() || this.core?.mainWindow;
          if (win) {
            if (win.isMinimized()) win.restore();
            if (!win.isVisible()) win.show();
            win.focus();
          }
        }
      },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ]));
  }

  setupJumpList() {
    if (process.platform !== 'win32') return;

    app.setJumpList([
      {
        type: 'tasks',
        items: [
          { type: 'task', title: '新建标签页', description: '打开新标签页', program: process.execPath, args: '--new-tab', iconPath: process.execPath, iconIndex: 0 },
          { type: 'task', title: '新建窗口', description: '打开新窗口', program: process.execPath, args: '--new-window', iconPath: process.execPath, iconIndex: 0 },
          { type: 'separator' },
          { type: 'task', title: '隐身模式', description: '打开隐身窗口', program: process.execPath, args: '--incognito', iconPath: process.execPath, iconIndex: 0 }
        ]
      }
    ]);
  }

  setupDockMenu() {
    if (process.platform !== 'darwin') return;

    const { Menu, BrowserWindow } = require('electron');
    app.dock.setMenu(Menu.buildFromTemplate([
      {
        label: '新建标签页',
        click: () => {
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow) {
            // 检查是否是分离窗口
            const core = this.core;
            if (core?.detachedWindows) {
              for (const [windowId, data] of core.detachedWindows) {
                if (data.window === focusedWindow) {
                  data.tabManager?.createView(null, data.sidebarOpen);
                  return;
                }
              }
            }
          }
          // 默认在主窗口创建
          this.tabManager?.createView(null, this.core?.sidebarOpen);
        }
      },
      { label: '新建窗口', click: () => this.core?.createNewWindow?.() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ]));
  }

  setupIPC() {
    // 缩略图工具栏按钮
    ipcMain.on('taskbar:update-buttons', (_, viewId) => this.updateThumbnailButtons(viewId));

    // 进度条
    ipcMain.on('taskbar:progress', (_, progress) => this.updateProgress(progress));

    // 监听标签变化更新按钮状态
    this.tabManager?.on?.('view:activated', ({ viewId }) => this.updateThumbnailButtons(viewId));
    this.tabManager?.on?.('view:closed', () => this.updateThumbnailButtons());
  }

  updateThumbnailButtons(activeViewId) {
    const win = this.windowManager?.getWindow?.() || this.core?.mainWindow;
    if (!win) return;

    const viewData = activeViewId ? this.tabManager?.getViewData?.(activeViewId) : null;
    const canGoBack = viewData?.view?.webContents?.canGoBack?.() || false;
    const canGoForward = viewData?.view?.webContents?.canGoForward?.() || false;

    win.setThumbarButtons?.([
      { tooltip: '后退', icon: this.createIcon('back'), click: () => viewData?.view?.webContents?.goBack?.(), flags: canGoBack ? [] : ['disabled'] },
      { tooltip: '前进', icon: this.createIcon('forward'), click: () => viewData?.view?.webContents?.goForward?.(), flags: canGoForward ? [] : ['disabled'] },
      { tooltip: '刷新', icon: this.createIcon('refresh'), click: () => viewData?.view?.webContents?.reload?.() }
    ]);
  }

  createIcon(type) {
    // 使用简单颜色块作为图标
    const colors = { back: '#4CAF50', forward: '#2196F3', refresh: '#FF9800' };
    return nativeImage.createFromDataURL(
      `data:image/svg+xml;base64,${Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect fill="${colors[type]}" width="16" height="16"/></svg>`
      ).toString('base64')}`
    );
  }

  updateProgress(progress) {
    const win = this.windowManager?.getWindow?.() || this.core?.mainWindow;
    if (!win) return;

    this.currentProgress = progress;
    if (progress >= 0) {
      win.setProgressBar(progress / 100);
    } else {
      win.setProgressBar(-1);
    }
  }
}

module.exports = TaskbarModule;
