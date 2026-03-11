// src/preload/menu-preload.js
// 菜单窗口的预加载脚本

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('menuAPI', {
  sendAction: (action, viewId) => {
    ipcRenderer.send('menu:action', { action, viewId });
  },
  sendLinkAction: (action) => {
    ipcRenderer.send('menu:link-action', { action });
  },
  sendImageAction: (action) => {
    ipcRenderer.send('menu:image-action', { action });
  },
  sendTextAction: (action) => {
    ipcRenderer.send('menu:text-action', { action });
  },
  sendShellTextAction: (action) => {
    ipcRenderer.send('menu:shell-text-action', { action });
  },
  close: () => {
    ipcRenderer.send('menu:close');
  }
});
