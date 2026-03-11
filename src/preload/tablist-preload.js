// src/preload/tablist-preload.js
// 标签列表窗口的预加载脚本

const { contextBridge, ipcRenderer } = require('electron');

// 暴露 API
contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel, data) => ipcRenderer.send(channel, data),
  on: (channel, callback) => ipcRenderer.on(channel, (event, ...args) => callback(...args))
});
