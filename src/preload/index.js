/**
 * Preload Script
 * 安全地暴露 API 到渲染进程
 */

console.log('[Preload] Script starting...');

const { contextBridge, ipcRenderer } = require('electron');

console.log('[Preload] Modules imported');

// 暴露 API
contextBridge.exposeInMainWorld('siliuAPI', {
  // ========== 视图控制 ==========
  // 导航
  navigate: (viewId, url) => ipcRenderer.invoke('view:navigate', { viewId, url }),
  goBack: (viewId) => ipcRenderer.invoke('view:goBack', { viewId }),
  goForward: (viewId) => ipcRenderer.invoke('view:goForward', { viewId }),
  reload: (viewId) => ipcRenderer.invoke('view:reload', { viewId }),

  // 标签页管理
  createView: (url, sidebarOpen) => ipcRenderer.invoke('view:create', { url, sidebarOpen }),
  closeView: (viewId) => ipcRenderer.invoke('view:close', { viewId }),
  setActiveView: (viewId, sidebarOpen) => ipcRenderer.invoke('view:setActive', { viewId, sidebarOpen }),
  getViews: () => ipcRenderer.invoke('view:getList'),
  getActiveView: () => ipcRenderer.invoke('view:getActive'),
  detachTab: (viewId, url) => ipcRenderer.invoke('view:detach', { viewId, url }),
  muteView: (viewId) => ipcRenderer.invoke('view:mute', { viewId }),

  // 标签页右键菜单（使用原生菜单避免被覆盖）- 传入鼠标坐标
  showTabContextMenu: (viewId, isPinned, x, y) =>
    ipcRenderer.invoke('contextmenu:tab', { viewId, isPinned, x, y }),

  // 标签列表窗口 - 传递按钮 bounds
  showTabList: (tabs, bounds) => ipcRenderer.invoke('tablist:show', { tabs, bounds }),
  hideTabList: () => ipcRenderer.send('tablist:hide'),

  // ========== 窗口控制 ==========
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  getWindowPosition: () => ipcRenderer.invoke('window:getPosition'),
  setSidebarOpen: (isOpen) => ipcRenderer.invoke('window:setSidebarOpen', isOpen),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // ========== AdBlock 控制 ==========
  setAdBlockEnabled: (enabled) => ipcRenderer.invoke('adblock:setEnabled', enabled),

  // ========== OpenClaw 控制 ==========
  openclawConnect: () => ipcRenderer.invoke('openclaw:connect'),
  openclawDisconnect: () => ipcRenderer.invoke('openclaw:disconnect'),
  openclawStatus: () => ipcRenderer.invoke('openclaw:status'),
  openclawSendMessage: (text) => ipcRenderer.invoke('openclaw:sendMessage', text),
  openclawGetHistory: (limit) => ipcRenderer.invoke('openclaw:getHistory', limit),

  // ========== SiliuController 控制 ==========
  siliuNavigate: (url) => ipcRenderer.invoke('siliu:navigate', url),
  siliuClick: (selector) => ipcRenderer.invoke('siliu:click', selector),
  siliuType: (selector, text) => ipcRenderer.invoke('siliu:type', selector, text),
  siliuSetAddressBar: (text) => ipcRenderer.invoke('siliu:setAddressBar', text),
  siliuScreenshot: (options) => ipcRenderer.invoke('siliu:screenshot', options),
  siliuGetContent: () => ipcRenderer.invoke('siliu:getContent'),
  siliuGetHTML: () => ipcRenderer.invoke('siliu:getHTML'),
  siliuScroll: (direction, amount) => ipcRenderer.invoke('siliu:scroll', direction, amount),
  siliuWaitFor: (selector, timeout) => ipcRenderer.invoke('siliu:waitForSelector', selector, timeout),
  siliuExecute: (code) => ipcRenderer.invoke('siliu:executeScript', code),
  siliuGetPageInfo: () => ipcRenderer.invoke('siliu:getPageInfo'),

  // ========== 文件管理控制（系统级对话框拦截）==========
  fileSetAutoMode: (enabled, options) => ipcRenderer.invoke('file:setAutoMode', enabled, options),
  filePrepareUpload: (filePath) => ipcRenderer.invoke('file:prepareUpload', filePath),
  fileGetWorkPath: (subDir) => ipcRenderer.invoke('file:getWorkPath', subDir),
  fileListFiles: (subDir) => ipcRenderer.invoke('file:listFiles', subDir),

  // ========== Copilot 控制 ==========
  copilotSendMessage: (text) => ipcRenderer.invoke('copilot:sendMessage', text),
  copilotGetConfig: () => ipcRenderer.invoke('copilot:getConfig'),
  copilotSaveConfig: (config) => ipcRenderer.invoke('copilot:saveConfig', config),
  copilotResetConfig: (serviceType) => ipcRenderer.invoke('copilot:resetConfig', serviceType),
  copilotTestConnection: (config) => ipcRenderer.invoke('copilot:testConnection', config),
  copilotOpenSettings: () => ipcRenderer.invoke('copilot:openSettings'),
  copilotContinue: () => ipcRenderer.invoke('copilot:continue'),
  copilotUserChoice: (shouldContinue) => ipcRenderer.invoke('copilot:userChoice', shouldContinue),
  switchAgent: (agentId) => ipcRenderer.invoke('copilot:switchAgent', agentId),

  // ========== Agent 管理 ==========
  getAllAgents: () => ipcRenderer.invoke('agents:getAll'),
  getCurrentAgent: () => ipcRenderer.invoke('agents:getCurrent'),
  switchToAgent: (agentId) => ipcRenderer.invoke('agents:switch', agentId),
  
  // ========== Step 1: 测试标注蒙版 ==========
  injectTestOverlay: (viewId, customScript) => ipcRenderer.invoke('annotation:injectTest', viewId, customScript),
  removeTestOverlay: (viewId) => ipcRenderer.invoke('annotation:removeTest', viewId),
  executeScript: (code) => ipcRenderer.invoke('siliu:executeScript', code),

  // ========== Shell 输入框右键菜单 ==========
  showShellContextMenu: (isEditable, hasSelection, text) => ipcRenderer.invoke('shell:contextmenu', { isEditable, hasSelection, text }),

  // ========== 事件监听 ==========
  on: (channel, callback) => {
    console.log('[Preload] on:', channel);
    const validChannels = [
      'tab-created',
      'tab-closed',
      'tab-activated',
      'tab-title-updated',
      'tab-favicon-updated',
      'tab:toggle-pin',
      'tab:close-others',
      'tab:close-right',
      'tab:add-to-group',
      'tab:mute',
      'tab:muted',
      'tablist:close-tab',
      'loading-started',
      'loading-finished',
      'loading-failed',
      'copilot:message',
      'copilot:stream',
      'copilot:thinking',
      'copilot:step-start',
      'copilot:step-result',
      'copilot:task-start',
      'copilot:task-finish',
      'copilot:need-login',
      'copilot:ask-continue',
      'copilot:screenshot',
      'copilot:configSaved',
      'adblock:stats',
      'adblock:enabled',
      'toast:show',
      'toast:adblock',
      // 新的事件系统 (ConfigManager)
      'ai:connected',
      'ai:disconnected',
      'ai:error',
      'ai:status',
      'ai:unconfigured',
      'ai:connectionError',
      'ai:toast',
      // 旧的事件系统 (兼容)
      'openclaw:connected',
      'openclaw:disconnected',
      'openclaw:message',
      'openclaw:unconfigured',
      'openclaw:connectionError',
      // Shell 输入框编辑操作
      'shell:editor-cut',
      'shell:editor-copy',
      'shell:editor-paste',
      'shell:editor-select-all',
      // Step 1-2: 标注点击事件
      'annotation:click',
      'annotation:done',
      'annotation:nameConfirmed'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, data) => {
        console.log('[Preload] Event received:', channel, data);
        callback(data);
      });
    }
  },

  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});

console.log('[Preload] API exposed');

// 通知渲染进程预加载完成
window.addEventListener('DOMContentLoaded', () => {
  console.log('[Preload] DOMContentLoaded - API ready');
});