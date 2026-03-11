/**
 * Siliu Browser - Main Entry（解耦优化版）
 *
 * 模块加载顺序：
 * ① EventBus → ② ConfigManager → ③ AIServiceManager → ④ Core → ⑤ ContextMenu
 * → ⑥ SiliuController → ⑦ Copilot → ⑧ AdBlock
 */

const { app } = require('electron');
const path = require('path');

// 禁用 sandbox（Linux 无 root 权限时需要）
app.commandLine.appendSwitch('--no-sandbox');
app.commandLine.appendSwitch('--disable-setuid-sandbox');

// 启用远程调试协议（用于 CDP 模式）
const DEBUG_PORT = process.env.SILIU_DEBUG_PORT || 9223;
app.commandLine.appendSwitch('remote-debugging-port', String(DEBUG_PORT));
console.log(`[Siliu] Remote debugging enabled on port ${DEBUG_PORT}`);

// castLabs Electron 已内置 Widevine (Windows)，Linux 需要手动配置
const widevinePath = path.join(__dirname, '../node_modules/electron/dist/WidevineCdm/_platform_specific/linux_x64/libwidevinecdm.so');
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('widevine-cdm-path', widevinePath);
  app.commandLine.appendSwitch('widevine-cdm-version', '4.10.2710.0');
  console.log('[Siliu] Linux Widevine CDM path:', widevinePath);
} else {
  console.log('[Siliu] Using castLabs Electron built-in Widevine (Windows)');
}

// 全局错误处理
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Siliu] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Siliu] Uncaught Exception:', error);
});

// 禁用可能干扰视频的限制
app.commandLine.appendSwitch('disable-features', 'UseChromeOSDirectVideoDecoder');

// WebRTC 支持（YouTube 直播使用）
app.commandLine.appendSwitch('enable-features', 'WebRtcHideLocalIpsWithMdns');

// 添加更多视频编解码器支持
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');

// 禁用 GPU 沙盒（某些 Linux 系统需要）
app.commandLine.appendSwitch('disable-gpu-sandbox');

// 启用 GPU 加速
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// 禁用实验性扩展 API（避免检测）
app.commandLine.appendSwitch('disable-extensions-except', '');
app.commandLine.appendSwitch('disable-extensions', '');

// 请求单实例锁
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[Siliu] Another instance is already running, quitting...');
  app.quit();
  return;
}

// ========== 模块引用 ==========
const { globalEventBus } = require('./core/event-bus');
const ConfigManager = require('./core/config-manager');
const { AIServiceManager } = require('./services/ai-service');
const CoreModule = require('./core');
const ContextMenuModule = require('./core/menu/index.js');
const SiliuController = require('./siliu-controller');
const { CopilotManager } = require('./copilot');
const AdBlockExtension = require('./adblock');
const { COPILOT_EVENTS, AI_EVENTS } = require('./core/events');

// ========== 全局实例 ==========
const modules = {
  config: null,
  aiService: null,
  core: null,
  contextMenu: null,
  controller: null,
  copilot: null,
  adblock: null
};

// ========== IPC 处理器状态 ==========
let ipcHandlersRegistered = false;

// ========== 启动流程 ==========
async function startup() {
  console.log('[Siliu] Starting...');

  // 注册自定义协议处理程序（阻止系统弹出提示）
  const protocols = ['bytedance', 'snssdk', 'intent', 'market', 'itms-apps'];
  for (const protocol of protocols) {
    if (!app.isDefaultProtocolClient(protocol)) {
      app.setAsDefaultProtocolClient(protocol);
      console.log(`[Siliu] Registered protocol handler: ${protocol}://`);
    }
  }

  // 监听协议打开事件
  app.on('open-url', (event, url) => {
    console.log('[Siliu] Blocked protocol URL:', url);
    event.preventDefault();
  });

  try {
    // ① 初始化配置管理器
    console.log('[Siliu] Loading ConfigManager...');
    modules.config = new ConfigManager();
    console.log('[Siliu] Config loaded');

    // ② 初始化 AI 服务管理器
    console.log('[Siliu] Initializing AIServiceManager...');
    modules.aiService = new AIServiceManager(modules.config);
    
    // 确保启动时状态是断开的
    console.log('[Siliu] Initial connection status:', modules.aiService.isConnected());
    console.log('[Siliu] Initial connection info:', modules.aiService.getConnectionInfo());

    // 监听 AI 连接状态
    globalEventBus.on('ai:connected', () => {
      console.log('[Siliu] AI service connected');
      modules.core?.sendToRenderer?.('ai:connected', {});
      modules.core?.sendToRenderer?.('openclaw:connected', {}); // 兼容旧前端
    });

    globalEventBus.on('ai:disconnected', () => {
      console.log('[Siliu] AI service disconnected');
      broadcastAIStatus();  // 广播更新后的状态
      modules.core?.sendToRenderer?.('ai:disconnected', {});
      modules.core?.sendToRenderer?.('openclaw:disconnected', {}); // 兼容旧前端
    });

    globalEventBus.on('ai:error', ({ error }) => {
      console.error('[Siliu] AI service error:', error);
      modules.core?.sendToRenderer?.('ai:error', { error });
      modules.core?.sendToRenderer?.('openclaw:connectionError', { error }); // 兼容旧前端
    });

    // AI toast 提示（连接成功/失败等）
    globalEventBus.on('ai:toast', ({ message, type }) => {
      modules.core?.sendToRenderer?.('ai:toast', { message, type });
    });

    // ③ 加载 Core
    console.log('[Siliu] Loading Core...');
    modules.core = new CoreModule();
    await modules.core.initialize();
    console.log('[Siliu] Core ready');

    // 设置全局 core 实例（供菜单等模块使用）
    global.coreInstance = modules.core;

    // ④ 加载 ContextMenu
    console.log('[Siliu] Loading ContextMenu...');
    modules.contextMenu = new ContextMenuModule(modules.core, {
      useCustomMenu: modules.config.get('ui.useCustomMenu') ?? true
    });
    console.log('[Siliu] ContextMenu ready');

    // ⑤ 创建主窗口
    console.log('[Siliu] Creating main window...');
    await modules.core.createWindow();
    console.log('[Siliu] Window created');

    // ⑥ 初始化 SiliuController（在窗口创建后，传递 windowManager 和 tabManager）
    console.log('[Siliu] Loading SiliuController...');
    modules.controller = new SiliuController({
      core: modules.core,
      configManager: modules.config,
      windowManager: modules.core.windowManager,
      tabManager: modules.core.tabManager,
      priorityMode: 'auto',
      debugPort: DEBUG_PORT
    });
    await modules.controller.initialize();
    console.log('[Siliu] Controller ready (priority: auto, fallback: enabled)');

    // ⑦ 加载 CopilotManager
    console.log('[Siliu] Loading CopilotManager...');
    modules.copilot = new CopilotManager({
      aiServiceManager: modules.aiService,
      core: modules.core,
      configManager: modules.config,
      controller: modules.controller
    });
    await modules.copilot.initialize();
    console.log('[Siliu] CopilotManager ready');

    // ⑧ 加载 AdBlock
    console.log('[Siliu] Loading AdBlock...');
    modules.adblock = new AdBlockExtension({
      core: modules.core,
      windowManager: modules.core.windowManager,
      enabled: modules.config.get('browser.blockAds') ?? true
    });
    await modules.adblock.activate();
    global.adblockExtension = modules.adblock;
    console.log('[Siliu] AdBlock ready');

    // 加载 TabListWindow（注册 tablist:show 等 IPC 处理器）
    const TabListWindow = require('./core/tab/tab-list-window');
    new TabListWindow(modules.core); // 创建主窗口的 TabListWindow 实例

    // ⑨ 设置 IPC 处理器（必须在连接 AI 之前，否则事件无法转发）
    modules.core.setupIPC({
      configManager: modules.config,  // 传入 configManager
      getController: () => modules.controller,
      getCopilot: () => modules.copilot,
      getAIService: () => modules.aiService,
      getAdblock: () => modules.adblock
    });
    setupIpcHandlers(); // 应用级 IPC 处理器

    // ⑩ 激活 AI 服务（有配置则自动连接，无配置则静默等待）
    console.log('[Siliu] Activating AI service...');
    await modules.aiService.activate();
    
    // 广播初始状态
    setTimeout(() => {
      console.log('[Siliu] Broadcasting initial AI status...');
      broadcastAIStatus();
    }, 2000);

    console.log('[Siliu] Startup complete!');
    globalEventBus.emit('app:ready', { modules });

  } catch (err) {
    console.error('[Siliu] Startup failed:', err);
    app.quit();
  }
}

// ========== AI 服务初始化（带提示版，用于手动连接）==========
async function initializeAIService() {
  if (!modules.config.hasValidConfig()) {
    modules.core?.sendToRenderer?.('ai:unconfigured', {
      message: '请配置 AI 服务',
      configPath: modules.config.getConfigPath()
    });
    return false;
  }

  const config = modules.config.get();

  // 根据 serviceType 连接对应服务
  if (config.serviceType === 'local') {
    return await connectLocalAI();
  } else {
    return await connectCloudAI();
  }
}

async function connectLocalAI() {
  try {
    const success = await modules.aiService.connectLocal();
    if (success) {
      // 广播连接状态
      broadcastAIStatus();
    } else {
      modules.core?.sendToRenderer?.('ai:connectionError', {
        error: '无法连接到本地 OpenClaw，请检查服务是否运行'
      });
    }
    return success;
  } catch (err) {
    modules.core?.sendToRenderer?.('ai:connectionError', {
      error: err.message
    });
    return false;
  }
}

async function connectCloudAI() {
  try {
    const success = await modules.aiService.connectKimiDirect();
    if (success) {
      // 广播连接状态
      broadcastAIStatus();
    } else {
      modules.core?.sendToRenderer?.('ai:connectionError', {
        error: '云端 AI 连接失败'
      });
    }
    return success;
  } catch (err) {
    modules.core?.sendToRenderer?.('ai:connectionError', {
      error: err.message || '云端 AI 连接失败'
    });
    return false;
  }
}

/**
 * 广播 AI 连接状态到所有窗口
 */
function broadcastAIStatus() {
  const info = modules.aiService?.getConnectionInfo();
  if (info) {
    console.log('[Siliu] Broadcasting AI status:', info);
    
    // 修复：如果显示已连接但实际未连接，强制设置为未连接
    if (info.connected && !modules.aiService?.isConnected()) {
      console.log('[Siliu] Fixing incorrect connected status');
      info.connected = false;
      info.displayName = '未连接';
    }
    
    // 发送 ai:status 事件（新格式）
    modules.core?.sendToRenderer?.('ai:status', info);
    
    // 根据实际连接状态发送对应事件
    if (info.connected) {
      modules.core?.sendToRenderer?.('openclaw:connected', { mode: info.mode });
    } else {
      modules.core?.sendToRenderer?.('openclaw:disconnected', { reason: '未连接' });
    }
    
    // 同时发送到所有分离窗口
    modules.core?.detachedWindows?.forEach(win => {
      win.windowManager?.sendToRenderer?.('ai:status', info);
      if (info.connected) {
        win.windowManager?.sendToRenderer?.('openclaw:connected', { mode: info.mode });
      } else {
        win.windowManager?.sendToRenderer?.('openclaw:disconnected', { reason: '未连接' });
      }
    });
  }
}

/**
 * 重新连接 AI 服务（用于配置更改后）
 */
async function reconnectAIService() {
  console.log('[Siliu] Reconnecting AI service...');
  
  // 断开现有连接
  if (modules.aiService) {
    await modules.aiService.disconnect();
  }
  
  // 等待一小段时间确保断开完成
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // 重新连接
  return await initializeAIService();
}

// ========== IPC 处理器 ==========
function setupIpcHandlers() {
  if (ipcHandlersRegistered) {
    console.log('[Siliu] IPC handlers already registered, skipping');
    return;
  }
  
  const { ipcMain } = require('electron');
  
  // 辅助函数：安全注册 handler（先移除已存在的）
  const safeHandle = (channel, handler) => {
    try {
      ipcMain.removeHandler(channel);
    } catch {}
    ipcMain.handle(channel, handler);
  };
  
  ipcHandlersRegistered = true;

  // 获取配置
  safeHandle('config:get', (event, path) => {
    return modules.config.get(path);
  });

  // 更新配置
  safeHandle('config:set', (event, path, value) => {
    modules.config.set(path, value);
    return { success: true };
  });

  // 批量更新配置
  safeHandle('config:update', async (event, updates) => {
    modules.config.update(updates);

    // 如果更新了 AI 相关配置，自动重新连接
    if (updates.serviceType || updates.local || updates.cloud) {
      console.log('[Siliu] AI config updated, reconnecting...');
      await initializeAIService();
    }

    return { success: true, connected: modules.aiService?.isConnected() || false };
  });

  // 获取配置路径
  safeHandle('config:getPath', () => {
    return modules.config.getConfigPath();
  });

  // 重新连接 AI
  safeHandle('ai:reconnect', async () => {
    await initializeAIService();
    return { connected: modules.aiService?.isConnected() };
  });

  // 断开 AI
  safeHandle('ai:disconnect', async () => {
    await modules.aiService?.disconnect();
    broadcastAIStatus();  // 广播更新后的状态
    return { success: true };
  });

  // 获取 AI 连接状态
  safeHandle('ai:getStatus', () => {
    const info = modules.aiService?.getConnectionInfo();
    return info || { mode: 'none', connected: false, name: 'None', displayName: '未连接' };
  });

  // 浏览器控制 API
  safeHandle('browser:navigate', async (event, url) => {
    return modules.controller.navigate(url);
  });

  safeHandle('browser:click', async (event, selector) => {
    return modules.controller.click(selector);
  });

  safeHandle('browser:type', async (event, selector, text) => {
    return modules.controller.type(selector, text);
  });

  safeHandle('browser:scroll', async (event, direction, amount) => {
    return modules.controller.scroll(direction, amount);
  });

  safeHandle('browser:screenshot', async () => {
    return modules.controller.screenshot();
  });

  safeHandle('browser:getContent', async () => {
    return modules.controller.getContent();
  });

  safeHandle('browser:getInfo', async () => {
    return modules.controller.getPageInfo();
  });

  // 别名：siliu: 前缀（兼容 preload）
  safeHandle('siliu:navigate', async (event, url) => {
    return modules.controller.navigate(url);
  });

  safeHandle('siliu:click', async (event, selector) => {
    return modules.controller.click(selector);
  });

  safeHandle('siliu:type', async (event, selector, text) => {
    return modules.controller.type(selector, text);
  });

  safeHandle('siliu:setAddressBar', async (event, text) => {
    // 获取发送者的窗口（shell 窗口）
    const senderWindow = require('electron').BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      return { success: false, error: 'Cannot get sender window' };
    }
    
    try {
      // 在 shell 窗口中执行 JS 设置地址栏
      const result = await senderWindow.webContents.executeJavaScript(`
        (function() {
          const input = document.getElementById('address-input');
          if (input) {
            input.value = '${text.replace(/'/g, "\\'")}';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return { success: true };
          }
          return { success: false, error: 'Address input not found' };
        })()
      `);
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle('siliu:scroll', async (event, direction, amount) => {
    return modules.controller.scroll(direction, amount);
  });

  safeHandle('siliu:screenshot', async () => {
    return modules.controller.screenshot();
  });

  safeHandle('siliu:getContent', async () => {
    return modules.controller.getContent();
  });

  safeHandle('siliu:getPageInfo', async () => {
    return modules.controller.getPageInfo();
  });

  safeHandle('siliu:getHTML', async () => {
    const wc = modules.controller.getWebContents?.();
    if (!wc) return { success: false, error: 'No active view' };
    try {
      const html = await wc.executeJavaScript('document.documentElement.outerHTML');
      return { success: true, html };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  safeHandle('siliu:executeScript', async (event, code) => {
    return modules.controller.executeScript(code);
  });

  safeHandle('siliu:waitForSelector', async (event, selector, timeout) => {
    return modules.controller.waitForSelector(selector, timeout);
  });

  // 广告拦截 API
  safeHandle('adblock:setEnabled', async (event, enabled) => {
    if (modules.adblock) {
      await modules.adblock.setEnabled(enabled);
      return { success: true };
    }
    return { success: false, error: 'AdBlock not initialized' };
  });

  // Copilot 配置 API (已移至 ipc-handlers.js)
  // 注释掉 app.js 中的实现，使用 ipc-handlers.js 中的完整实现

  // safeHandle('copilot:saveConfig', (event, config) => {
  //   modules.config.set('copilot', config);
  //   return { success: true };
  // });

  // safeHandle('copilot:resetConfig', () => {
  //   modules.config.set('copilot', {
  //     maxSteps: 30,
  //     autoStart: false,
  //     enableThinking: true
  //   });
  //   return { success: true };
  // });

  // safeHandle('copilot:testConnection', async () => {
  //   try {
  //     const connected = modules.aiService?.isConnected();
  //     return { success: true, connected };
  //   } catch (err) {
  //     return { success: false, error: err.message };
  //   }
  // });

  // 登录检测 API
  safeHandle('auth:checkLogin', async () => {
    try {
      const pageInfo = await modules.controller.getPageInfo();
      if (!pageInfo.success) {
        return { error: '无法获取页面信息' };
      }

      const content = await modules.controller.getContent();
      const loginStatus = modules.copilot.loginDetector.detect({
        url: pageInfo.url,
        title: pageInfo.title,
        content: content.content || ''
      });

      return loginStatus;
    } catch (err) {
      return { error: err.message };
    }
  });

  // 转发事件到渲染进程
  // 注意：COPILOT_EVENTS 和 openclaw:message 由 WindowCopilot 直接发送到对应窗口
  const eventsToForward = [
    // AI 事件（所有窗口都需要知道连接状态）
    AI_EVENTS.CONNECTED,
    AI_EVENTS.DISCONNECTED,
    AI_EVENTS.ERROR,
    AI_EVENTS.STATUS,
    // OpenClaw 兼容事件（旧）- 只保留连接状态事件
    'openclaw:connected',
    'openclaw:disconnected',
    'openclaw:error',
    'openclaw:unconfigured',
    'openclaw:connectionError'
  ];

  eventsToForward.forEach(eventName => {
    globalEventBus.on(eventName, (data) => {
      modules.core?.sendToRenderer?.(eventName, data);
      // 同时转发到所有分离窗口
      modules.core?.detachedWindows?.forEach(win => {
        win.windowManager?.sendToRenderer?.(eventName, data);
      });
    });
  });
  
  // 额外：将 ai:connected 映射到 openclaw:connected（兼容性）
  globalEventBus.on(AI_EVENTS.CONNECTED, (data) => {
    const compatData = { ...data, service: 'openclaw' };
    modules.core?.sendToRenderer?.('openclaw:connected', compatData);
    modules.core?.detachedWindows?.forEach(win => {
      win.windowManager?.sendToRenderer?.('openclaw:connected', compatData);
    });
  });
  
  globalEventBus.on(AI_EVENTS.DISCONNECTED, (data) => {
    const compatData = { ...data, service: 'openclaw' };
    modules.core?.sendToRenderer?.('openclaw:disconnected', compatData);
    modules.core?.detachedWindows?.forEach(win => {
      win.windowManager?.sendToRenderer?.('openclaw:disconnected', compatData);
    });
  });
}

// ========== Electron 生命周期 ==========
app.whenReady().then(startup);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    modules.copilot?.deactivateAll();
    modules.adblock?.deactivate();
    modules.aiService?.disconnect();
    app.quit();
  }
});

app.on('activate', () => {
  modules.core?.createWindow();
});

// 处理第二个实例
app.on('second-instance', (event, argv) => {
  console.log('[Siliu] Second instance started with args:', argv);

  // 检查是否是协议链接
  const protocolUrl = argv.find(arg => 
    arg.startsWith('bytedance://') || 
    arg.startsWith('snssdk://') ||
    arg.startsWith('intent://') ||
    arg.startsWith('market://')
  );
  if (protocolUrl) {
    console.log('[Siliu] Blocked protocol URL in second-instance:', protocolUrl);
    return;
  }

  if (argv.includes('--new-tab')) {
    const focusedId = global.lastFocusedWindowId;
    if (focusedId && modules.core?.detachedWindows?.has(focusedId)) {
      const detached = modules.core.detachedWindows.get(focusedId);
      detached?.tabManager?.createView?.(null, detached?.sidebarOpen);
      detached?.windowManager?.getWindow?.()?.focus();
      return;
    }
    modules.core?.createView?.(null, modules.core?.sidebarOpen);
    modules.core?.windowManager?.getWindow?.()?.focus();
  } else if (argv.includes('--new-window')) {
    modules.core?.createNewWindow?.();
  }
});

// ========== 导出供其他模块使用 ==========
module.exports = {
  get modules() { return modules; },
  get eventBus() { return globalEventBus; },
  reconnectAIService
};
