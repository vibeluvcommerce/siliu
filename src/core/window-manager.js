// src/core/window-manager.js
// 主窗口管理 - 负责 BrowserWindow 创建和生命周期

const { BrowserWindow } = require('electron');
const path = require('path');

class WindowManager {
  constructor(options = {}) {
    this.config = {
      minWidth: 800,
      minHeight: 600,
      preloadPath: path.join(__dirname, '../preload/index.js'),
      shellHtmlPath: path.join(__dirname, '../../public/shell.html'),
      ...options
    };
    
    // 分离窗口模式：直接使用传入的窗口
    if (options.window) {
      this.mainWindow = options.window;
      this.isDetached = true;
      // 绑定 resize 事件
      this.mainWindow.on('resize', () => {
        this.onResize?.();
      });
    } else {
      this.mainWindow = null;
      this.isDetached = false;
    }
    
    this.onResize = null; // 外部回调
    this.copilotSettingsWindow = null; // Copilot 设置窗口
  }

  async createWindow() {
    // 根据平台选择不同的窗口配置
    const isMac = process.platform === 'darwin';
    const isWin = process.platform === 'win32';
    const isLinux = process.platform === 'linux';

    const windowOptions = {
      width: 1600,
      height: 900,
      minWidth: this.config.minWidth,
      minHeight: this.config.minHeight,
      fullscreenable: true,
      show: false,
      frame: false,  // 无边框窗口
      titleBarStyle: 'hidden',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: this.config.preloadPath,
      }
    };

    this.mainWindow = new BrowserWindow(windowOptions);

    // 移除菜单栏
    this.mainWindow.setMenu(null);

    // 等待窗口准备好再显示
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
    });

    // 窗口显示后触发 resize（确保 BrowserView 正确渲染）
    this.mainWindow.once('show', () => {
      setTimeout(() => {
        this.onResize?.();
      }, 100);
    });

    await this.mainWindow.loadFile(this.config.shellHtmlPath);

    // 窗口事件
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    this.mainWindow.on('resize', () => {
      this.onResize?.();
    });

    console.log('[WindowManager] Window created');
    return this.mainWindow;
  }

  getWindow() {
    return this.mainWindow;
  }

  isWindowReady() {
    return this.mainWindow && !this.mainWindow.isDestroyed();
  }

  sendToRenderer(channel, data) {
    if (this.isWindowReady()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  getBounds() {
    if (!this.isWindowReady()) return null;
    return this.mainWindow.getBounds();
  }

  getSize() {
    if (!this.isWindowReady()) return [1280, 800];
    return this.mainWindow.getSize();
  }

  // Linux 上手动拖动支持（-webkit-app-region 不工作）
  setupManualDrag() {
    // IPC 处理器在 core/index.js 中设置
  }

  /**
   * 打开 Copilot 设置窗口
   */
  async openCopilotSettings() {
    if (this.copilotSettingsWindow && !this.copilotSettingsWindow.isDestroyed()) {
      this.copilotSettingsWindow.focus();
      return;
    }

    const parentWindow = this.getWindow();
    if (!parentWindow) {
      throw new Error('Parent window not available');
    }

    const parentBounds = parentWindow.getBounds();
    const width = 640;
    const height = 700;

    // 计算窗口位置（居中显示在父窗口）
    const x = Math.round(parentBounds.x + (parentBounds.width - width) / 2);
    const y = Math.round(parentBounds.y + (parentBounds.height - height) / 2);

    this.copilotSettingsWindow = new BrowserWindow({
      width,
      height,
      x,
      y,
      parent: parentWindow,
      modal: false,
      show: false,
      resizable: true,
      minimizable: false,
      maximizable: false,
      title: 'Copilot 设置',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: this.config.preloadPath,
      }
    });

    this.copilotSettingsWindow.setMenu(null);

    // 等待窗口准备好再显示
    this.copilotSettingsWindow.once('ready-to-show', () => {
      this.copilotSettingsWindow.show();
    });

    await this.copilotSettingsWindow.loadFile(
      path.join(__dirname, '../../public/copilot-settings.html')
    );

    this.copilotSettingsWindow.on('closed', () => {
      this.copilotSettingsWindow = null;
    });

    console.log('[WindowManager] Copilot settings window opened');
  }
}

module.exports = WindowManager;
