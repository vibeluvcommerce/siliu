// src/preload/agent-panel-preload.js
// Agent 栏预加载脚本

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentPanel', {
  // 接收初始数据
  onInit: (callback) => {
    ipcRenderer.on('init-agents', (event, data) => callback(data));
  },

  // Agent 列表更新
  onAgentsUpdated: (callback) => {
    ipcRenderer.on('agents-updated', (event, agents) => callback(agents));
  },

  // 选择 Agent
  selectAgent: (agentId) => {
    ipcRenderer.send('agent-select', agentId);
  },

  // 添加 Agent
  addAgent: () => {
    ipcRenderer.send('agent-add');
  },

  // 移除监听
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('init-agents');
    ipcRenderer.removeAllListeners('agents-updated');
  },
});
