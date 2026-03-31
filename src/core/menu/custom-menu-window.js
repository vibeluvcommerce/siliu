// src/core/menu/custom-menu-window.js
// 自定义圆角菜单窗口 - 替代原生 Menu

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// 存储每个窗口的菜单窗口实例
const instances = new Map();
// 记录菜单窗口属于哪个父窗口
const menuToParent = new Map();

// 公共 CSS 样式
const COMMON_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    background: transparent;
    overflow: hidden;
    user-select: none;
    width: 100%;
    height: 100%;
  }
  .menu {
    background: rgba(255, 255, 255, 0.98);
    border: 1px solid #dadce0;
    border-radius: 8px;
    /* box-shadow disabled for testing */
    padding: 6px 0;
    min-width: 180px;
    margin: 0;
  }
  .menu-item {
    padding: 8px 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #202124;
    transition: background 0.15s;
    max-width: 220px;
  }
  .menu-item:hover {
    background: #e8eaed;
  }
  .menu-item span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
  .separator {
    height: 1px;
    background: #dadce0;
    margin: 4px 0;
  }
`;

// 公共脚本
const COMMON_SCRIPT = `
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.menuAPI.close();
  });
  document.addEventListener('click', (e) => {
    if (e.target === document.body || !e.target.closest('.menu')) {
      window.menuAPI.close();
    }
  });
`;

class CustomMenuWindow {
  constructor(coreModule) {
    this.core = coreModule;
    this.menuWindow = null;
    this.windowId = null;
  }

  registerForWindow(windowId) {
    this.windowId = windowId;
    instances.set(windowId, this);
  }

  unregisterForWindow() {
    if (this.windowId) {
      instances.delete(this.windowId);
      this.windowId = null;
    }
    // 清理关联的 menuToParent 记录
    if (this.menuWindow) {
      menuToParent.delete(this.menuWindow.webContents.id);
    }
  }

  static getInstance(windowId) {
    return instances.get(windowId);
  }

  async showMenu(viewId, isPinned, x, y, windowManager, tabManager) {
    const mainWindow = windowManager.getWindow();
    if (!mainWindow) return;

    const viewData = tabManager.getViewData(viewId);
    const isMuted = viewData?.view?.webContents?.audioMuted || false;

    if (this.menuWindow) this.hideMenu();

    const pos = this.calculatePosition(x, y, 200, 320, mainWindow);
    this.createMenuWindow(pos.x, pos.y, 200, 320, mainWindow, true);

    instances.set(this.menuWindow.webContents.id, this);

    this.currentViewId = viewId;
    this.currentTabManager = tabManager;
    this.currentWindow = mainWindow;

    const html = this.buildHTML(this.generateMenuItems(viewId, isPinned, isMuted));
    await this.menuWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    
    // 延迟显示，确保内容渲染完成
    setTimeout(() => {
      if (this.menuWindow && !this.menuWindow.isDestroyed()) {
        this.menuWindow.setOpacity(1);
        this.menuWindow.show();
      }
    }, 30);
  }

  async showLinkMenu(menuData, x, y, windowManager, tabManager, parentWindowId) {
    const mainWindow = windowManager.getWindow();
    if (!mainWindow) return;

    if (this.menuWindow) this.hideMenu();

    const pos = this.calculatePosition(x, y, 200, 200, mainWindow);
    this.createMenuWindow(pos.x, pos.y, 200, 200, mainWindow, true);

    if (this.menuWindow) {
      instances.set(this.menuWindow.webContents.id, this);
      this.windowId = this.menuWindow.webContents.id;
    }

    this.currentTabManager = tabManager;
    this.currentWindow = mainWindow;
    this.currentLinkData = menuData;

    const items = [
      { action: 'open-in-new-tab', label: '在新标签页中打开链接' },
      { action: 'open-in-new-window', label: '在新窗口中打开链接' },
      { type: 'separator' },
      { action: 'copy-link-url', label: '复制链接地址' },
      { action: 'copy-link-text', label: '复制链接文字' }
    ];

    const itemsHtml = items.map(item => {
      if (item.type === 'separator') return '<div class="separator"></div>';
      return `<div class="menu-item" onclick="window.menuAPI.sendLinkAction('${item.action}')">
        <span>${item.label}</span>
      </div>`;
    }).join('');

    const html = this.buildHTML(itemsHtml);
    await this.menuWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    
    // 延迟显示，确保内容渲染完成
    setTimeout(() => {
      if (this.menuWindow && !this.menuWindow.isDestroyed()) {
        this.menuWindow.setOpacity(1);
        this.menuWindow.show();
      }
    }, 30);
  }

  async showImageMenu(menuData, x, y, windowManager, tabManager, parentWindowId) {
    const mainWindow = windowManager.getWindow();
    if (!mainWindow) return;

    if (this.menuWindow) this.hideMenu();

    const pos = this.calculatePosition(x, y, 200, 130, mainWindow);
    this.createMenuWindow(pos.x, pos.y, 200, 130, mainWindow, true);

    if (this.menuWindow) {
      instances.set(this.menuWindow.webContents.id, this);
      this.windowId = this.menuWindow.webContents.id;
    }

    this.currentTabManager = tabManager;
    this.currentWindow = mainWindow;
    this.currentImageData = menuData;

    const items = [
      { action: 'open-in-new-tab', label: '在新标签页中打开图片' },
      { action: 'save-image', label: '保存图片为...' },
      { type: 'separator' },
      { action: 'copy-image-url', label: '复制图片地址' }
    ];

    const itemsHtml = items.map(item => {
      if (item.type === 'separator') return '<div class="separator"></div>';
      return `<div class="menu-item" onclick="window.menuAPI.sendImageAction('${item.action}')">
        <span>${item.label}</span>
      </div>`;
    }).join('');

    const html = this.buildHTML(itemsHtml);
    await this.menuWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    
    // 延迟显示，确保内容渲染完成
    setTimeout(() => {
      if (this.menuWindow && !this.menuWindow.isDestroyed()) {
        this.menuWindow.setOpacity(1);
        this.menuWindow.show();
      }
    }, 30);
  }

  calculatePosition(x, y, width, height, mainWindow) {
    const { screen } = require('electron');
    
    const windowBounds = mainWindow.getBounds();
    let screenX = windowBounds.x + x;
    let screenY = windowBounds.y + y;
    
    const display = screen.getDisplayNearestPoint({ x: screenX, y: screenY });
    const workArea = display.workArea;
    
    let menuX = screenX;
    let menuY = screenY;
    
    if (menuX + width > workArea.x + workArea.width) {
      menuX = screenX - width;
    }
    
    if (menuY + height > workArea.y + workArea.height) {
      menuY = screenY - height;
    }
    
    if (menuX < workArea.x) {
      menuX = workArea.x + 5;
    }
    if (menuY < workArea.y) {
      menuY = workArea.y + 5;
    }
    
    return { x: Math.round(menuX), y: Math.round(menuY) };
  }

  createMenuWindow(x, y, width, height, parentWindow, focusable = false) {
    this.menuWindow = new BrowserWindow({
      width, height, x, y,
      frame: false, 
      transparent: true,
      alwaysOnTop: true, skipTaskbar: true,
      resizable: false, minimizable: false, maximizable: false,
      parent: parentWindow, modal: false, show: false,
      opacity: 0,
      focusable,
      webPreferences: {
        nodeIntegration: false, contextIsolation: true,
        preload: path.join(__dirname, '../../preload/menu-preload.js'),
      },
    });

    // 禁用系统阴影，完全使用 CSS 阴影避免双层效果
    this.menuWindow.setHasShadow(false);

    const parentId = parentWindow.webContents.id;
    menuToParent.set(this.menuWindow.webContents.id, parentId);

    this.menuWindow.on('blur', () => setTimeout(() => this.hideMenu(), 100));
  }

  buildHTML(itemsHtml) {
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>${COMMON_CSS}</style></head>
<body><div class="menu">${itemsHtml}</div><script>${COMMON_SCRIPT}</script></body></html>`;
  }

  generateMenuItems(viewId, isPinned, isMuted) {
    const items = [
      { action: isPinned ? 'unpin' : 'pin', label: isPinned ? '取消固定' : '固定标签页' },
      { action: 'mute', label: isMuted ? '取消静音' : '静音网站' },
      { type: 'separator' },
      { action: 'add-to-group', label: '添加到新组' },
      { type: 'separator' },
      { action: 'close', label: '关闭标签页' },
      { action: 'close-others', label: '关闭其他标签页' },
      { action: 'close-right', label: '关闭右侧标签页' },
      { type: 'separator' },
      { action: 'reload', label: '重新加载' },
      { action: 'duplicate', label: '复制标签页' }
    ];

    return items.map(item => {
      if (item.type === 'separator') return '<div class="separator"></div>';
      return `<div class="menu-item" onclick="window.menuAPI.sendAction('${item.action}', '${viewId}')">
        <span>${item.label}</span>
      </div>`;
    }).join('');
  }

  async showTextMenu(menuData, x, y, windowManager, tabManager, parentWindowId) {
    const mainWindow = windowManager.getWindow();
    if (!mainWindow) return;

    if (this.menuWindow) this.hideMenu();

    const pos = this.calculatePosition(x, y, 200, 200, mainWindow);
    this.createMenuWindow(pos.x, pos.y, 200, 200, mainWindow, true);

    if (this.menuWindow) {
      instances.set(this.menuWindow.webContents.id, this);
      this.windowId = this.menuWindow.webContents.id;
    }

    const activeViewData = tabManager.getActiveView();
    this.browserViewWebContents = activeViewData?.view?.webContents;

    this.currentTabManager = tabManager;
    this.currentWindow = mainWindow;
    this.currentTextData = menuData;

    const { isEditable, text, hasSelection } = menuData;
    const items = [];
    
    if (isEditable) {
      items.push(
        { action: 'cut', label: '剪切', disabled: !hasSelection },
        { action: 'copy', label: '复制', disabled: !hasSelection },
        { action: 'paste', label: '粘贴' },
        { type: 'separator' }
      );
    } else if (hasSelection) {
      items.push(
        { action: 'copy', label: '复制' },
        { type: 'separator' }
      );
    }
    
    if (hasSelection && text) {
      items.push(
        { action: 'search-google', label: `使用 Google 搜索 "${text}"` },
        { action: 'search-new-tab', label: `在新标签页中搜索 "${text}"` },
        { type: 'separator' }
      );
    }
    
    items.push({ action: 'select-all', label: '全选' });

    const itemsHtml = items.map(item => {
      if (item.type === 'separator') return '<div class="separator"></div>';
      const disabledAttr = item.disabled ? ' style="opacity:0.4;cursor:default;"' : '';
      const onclickAttr = item.disabled ? '' : `onclick="window.menuAPI.sendTextAction('${item.action}')"`;
      return `<div class="menu-item"${disabledAttr} ${onclickAttr}>
        <span>${item.label}</span>
      </div>`;
    }).join('');

    const html = this.buildHTML(itemsHtml);
    await this.menuWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    
    // 延迟显示，确保内容渲染完成
    setTimeout(() => {
      if (this.menuWindow && !this.menuWindow.isDestroyed()) {
        this.menuWindow.setOpacity(1);
        this.menuWindow.show();
      }
    }, 30);
  }

  async showShellTextMenu(menuData, x, y, windowManager, tabManager, shellWebContents, parentWindowId) {
    const mainWindow = windowManager.getWindow();
    if (!mainWindow) return;

    if (this.menuWindow) this.hideMenu();

    const pos = this.calculatePosition(x, y, 200, 200, mainWindow);
    this.createMenuWindow(pos.x, pos.y, 200, 200, mainWindow, true);

    if (this.menuWindow) {
      instances.set(this.menuWindow.webContents.id, this);
      this.windowId = this.menuWindow.webContents.id;
    }

    this.currentTabManager = tabManager;
    this.currentWindow = mainWindow;
    this.currentTextData = menuData;
    this.shellWebContents = shellWebContents;

    const { isEditable, text, hasSelection } = menuData;
    const items = [];
    
    if (isEditable) {
      items.push(
        { action: 'cut', label: '剪切', disabled: !hasSelection },
        { action: 'copy', label: '复制', disabled: !hasSelection },
        { action: 'paste', label: '粘贴' },
        { type: 'separator' }
      );
    } else if (hasSelection) {
      items.push(
        { action: 'copy', label: '复制' },
        { type: 'separator' }
      );
    }
    
    if (hasSelection && text) {
      items.push(
        { action: 'search-google', label: `使用 Google 搜索 "${text}"` },
        { action: 'search-new-tab', label: `在新标签页中搜索 "${text}"` },
        { type: 'separator' }
      );
    }
    
    items.push({ action: 'select-all', label: '全选' });

    const itemsHtml = items.map(item => {
      if (item.type === 'separator') return '<div class="separator"></div>';
      const disabledAttr = item.disabled ? ' style="opacity:0.4;cursor:default;"' : '';
      const onclickAttr = item.disabled ? '' : `onclick="window.menuAPI.sendShellTextAction('${item.action}')"`;
      return `<div class="menu-item"${disabledAttr} ${onclickAttr}>
        <span>${item.label}</span>
      </div>`;
    }).join('');

    const html = this.buildHTML(itemsHtml);
    await this.menuWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    
    // 延迟显示，确保内容渲染完成
    setTimeout(() => {
      if (this.menuWindow && !this.menuWindow.isDestroyed()) {
        this.menuWindow.setOpacity(1);
        this.menuWindow.show();
      }
    }, 30);
  }

  hideMenu() {
    if (this.menuWindow && !this.menuWindow.isDestroyed()) {
      instances.delete(this.menuWindow.webContents.id);
      menuToParent.delete(this.menuWindow.webContents.id);
      this.menuWindow.close();
      this.menuWindow = null;
    }
    
    this.currentViewId = null;
    this.currentTabManager = null;
    this.currentWindow = null;
    this.currentLinkData = null;
    this.currentImageData = null;
    this.currentTextData = null;
    this.shellWebContents = null;
  }

  handleAction(action, viewId) {
    if (!this.currentTabManager || !this.currentWindow) return;

    const norm = action === 'pin' || action === 'unpin' ? 'toggle-pin' : action;
    const handlers = {
      'toggle-pin': () => this.currentWindow.webContents.send('tab:toggle-pin', { viewId }),
      'mute': () => this.currentWindow.webContents.send('tab:mute', { viewId }),
      'add-to-group': () => this.currentWindow.webContents.send('tab:add-to-group', { viewId }),
      'close': () => this.currentTabManager.closeView(viewId),
      'close-others': () => this.currentWindow.webContents.send('tab:close-others', { viewId }),
      'close-right': () => this.currentWindow.webContents.send('tab:close-right', { viewId }),
      'reload': () => {
        const vd = this.currentTabManager.getViewData(viewId);
        if (vd?.view) vd.view.webContents.reload();
      },
      'duplicate': () => {
        const vd = this.currentTabManager.getViewData(viewId);
        if (vd) this.currentTabManager.createView(vd.url, this.currentTabManager.sidebarOpen);
      }
    };

    handlers[norm]?.();
    this.hideMenu();
  }

  handleLinkAction(action) {
    if (!this.currentTabManager || !this.currentWindow || !this.currentLinkData) return;
    const { clipboard } = require('electron');
    const { url, text } = this.currentLinkData;

    const handlers = {
      'open-in-new-tab': () => this.currentTabManager.createView(url, this.currentTabManager.sidebarOpen),
      'open-in-new-window': () => global.coreInstance?.createNewWindow(url),
      'copy-link-url': () => clipboard.writeText(url),
      'copy-link-text': () => clipboard.writeText(text || '')
    };

    handlers[action]?.();
    this.hideMenu();
  }

  handleImageAction(action) {
    if (!this.currentTabManager || !this.currentWindow || !this.currentImageData) return;
    const { clipboard, dialog } = require('electron');
    const { src } = this.currentImageData;
    const win = this.currentWindow;

    const handlers = {
      'open-in-new-tab': () => this.currentTabManager.createView(src, this.currentTabManager.sidebarOpen),
      'save-image': async () => {
        const path = require('path');
        const https = require('https');
        const http = require('http');
        const fs = require('fs');
        const { dialog } = require('electron');

        const url = new URL(src);
        const filename = path.basename(url.pathname) || 'image';
        
        // 检查是否有预设的自动保存路径（AI 模式）
        let savePath = null;
        const fileManager = this.core?.modules?.get('fileManager');
        if (fileManager) {
          savePath = fileManager.getAndClearImageSavePath();
        }

        // 如果有预设路径，直接使用；否则弹出对话框
        if (!savePath) {
          const result = await dialog.showSaveDialog(win, {
            defaultPath: filename,
            filters: [
              { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'] },
              { name: '所有文件', extensions: ['*'] }
            ]
          });
          
          if (result.canceled || !result.filePath) {
            return;
          }
          savePath = result.filePath;
        }

        // 执行下载
        const protocol = url.protocol === 'https:' ? https : http;
        const file = fs.createWriteStream(savePath);
        
        protocol.get(src, (response) => {
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            const stats = fs.statSync(savePath);
            console.log(`[CustomMenu] Image saved: ${path.basename(savePath)} (${stats.size} bytes)`);
            
            // 触发下载完成事件
            if (fileManager) {
              fileManager.emit('download:complete', {
                filePath: savePath,
                fileName: path.basename(savePath),
                fileSize: stats.size,
                sourceUrl: src,
                message: `图片 "${path.basename(savePath)}" 已保存完成，路径: ${savePath}`
              });
            }
          });
        }).on('error', (err) => {
          console.error('[CustomMenu] Image download failed:', err.message);
          fs.unlink(savePath, () => {});
        });
      },
      'copy-image-url': () => clipboard.writeText(src)
    };

    handlers[action]?.();
    this.hideMenu();
  }

  handleTextAction(action) {
    if (!this.currentTabManager || !this.currentWindow) return;

    const activeViewData = this.currentTabManager.getActiveView();
    const webContents = activeViewData?.view?.webContents;

    if (!webContents || webContents.isDestroyed()) {
      this.hideMenu();
      return;
    }

    if (action === 'paste') {
      this.hideMenu();
      setTimeout(() => {
        if (!webContents.isDestroyed()) {
          webContents.focus();
          webContents.send('editor:paste');
          setTimeout(() => {
            if (!webContents.isDestroyed()) {
              webContents.focus();
              webContents.send('editor:restore-focus');
            }
          }, 100);
        }
      }, 50);
      return;
    }

    const handlers = {
      'cut': () => webContents.send('editor:cut'),
      'copy': () => webContents.send('editor:copy'),
      'select-all': () => webContents.send('editor:select-all'),
      'search-google': () => {
        const query = encodeURIComponent(this.currentTextData.text);
        this.currentTabManager.createView(`https://www.google.com/search?q=${query}`, this.currentTabManager.sidebarOpen);
      },
      'search-new-tab': () => {
        const query = encodeURIComponent(this.currentTextData.text);
        this.currentTabManager.createView(`https://www.google.com/search?q=${query}`, this.currentTabManager.sidebarOpen);
      }
    };

    handlers[action]?.();
    this.hideMenu();
  }

  handleShellTextAction(action) {
    if (!this.shellWebContents || this.shellWebContents.isDestroyed()) return;
    
    const handlers = {
      'cut': () => this.shellWebContents.send('shell:editor-cut'),
      'copy': () => this.shellWebContents.send('shell:editor-copy'),
      'paste': () => this.shellWebContents.send('shell:editor-paste'),
      'select-all': () => this.shellWebContents.send('shell:editor-select-all'),
      'search-google': () => {
        if (this.currentTextData?.text) {
          const query = encodeURIComponent(this.currentTextData.text);
          this.currentTabManager?.createView(`https://www.google.com/search?q=${query}`, this.currentTabManager.sidebarOpen);
        }
      },
      'search-new-tab': () => {
        if (this.currentTextData?.text) {
          const query = encodeURIComponent(this.currentTextData.text);
          this.currentTabManager?.createView(`https://www.google.com/search?q=${query}`, this.currentTabManager.sidebarOpen);
        }
      }
    };

    handlers[action]?.();
    this.hideMenu();
  }
}

// 注册 IPC 处理器
ipcMain?.on?.('menu:action', (e, { action, viewId }) => {
  const instance = CustomMenuWindow.getInstance(e.sender.id);
  instance?.handleAction(action, viewId);
});

ipcMain?.on?.('menu:link-action', (e, { action }) => {
  const instance = CustomMenuWindow.getInstance(e.sender.id);
  instance?.handleLinkAction(action);
});

ipcMain?.on?.('menu:image-action', (e, { action }) => {
  const instance = CustomMenuWindow.getInstance(e.sender.id);
  instance?.handleImageAction(action);
});

ipcMain?.on?.('menu:text-action', (e, { action }) => {
  const instance = CustomMenuWindow.getInstance(e.sender.id);
  instance?.handleTextAction(action);
});

ipcMain?.on?.('menu:shell-text-action', (e, { action }) => {
  const instance = CustomMenuWindow.getInstance(e.sender.id);
  instance?.handleShellTextAction(action);
});

ipcMain?.on?.('menu:close', (e) => {
  const instance = CustomMenuWindow.getInstance(e.sender.id);
  instance?.hideMenu();
});

module.exports = CustomMenuWindow;
