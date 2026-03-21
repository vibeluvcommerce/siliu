/**
 * Siliu Browser - Main Entry（解耦优化版）
 *
 * 模块加载顺序：
 * ① EventBus → ② ConfigManager → ③ AIServiceManager → ④ Core → ⑤ ContextMenu
 * → ⑥ SiliuController → ⑦ Copilot → ⑧ AdBlock
 */

const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// 启用远程调试协议（用于 CDP 模式）
const DEBUG_PORT = process.env.SILIU_DEBUG_PORT || 9223;

// 注意：commandLine 需要在 app ready 之前设置，但需要在 electron 模块加载之后
// 使用 try-catch 避免在某些环境中出错
try {
  // 禁用 sandbox（Linux 无 root 权限时需要）
  app?.commandLine?.appendSwitch('--no-sandbox');
  app?.commandLine?.appendSwitch('--disable-setuid-sandbox');
  app?.commandLine?.appendSwitch('remote-debugging-port', String(DEBUG_PORT));
  console.log(`[Siliu] Remote debugging enabled on port ${DEBUG_PORT}`);
} catch (e) {
  console.log('[Siliu] Command line switches not applied:', e.message);
}

// castLabs Electron 已内置 Widevine (Windows)，Linux 需要手动配置
const widevinePath = path.join(__dirname, '../node_modules/electron/dist/WidevineCdm/_platform_specific/linux_x64/libwidevinecdm.so');
if (process.platform === 'linux') {
  try {
    app?.commandLine?.appendSwitch('widevine-cdm-path', widevinePath);
    app?.commandLine?.appendSwitch('widevine-cdm-version', '4.10.2710.0');
    console.log('[Siliu] Linux Widevine CDM path:', widevinePath);
  } catch (e) {
    console.log('[Siliu] Widevine switches not applied:', e.message);
  }
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
try {
  app?.commandLine?.appendSwitch('disable-features', 'UseChromeOSDirectVideoDecoder');
  app?.commandLine?.appendSwitch('enable-features', 'WebRtcHideLocalIpsWithMdns,WebRTCPipeWireCapturer');
  app?.commandLine?.appendSwitch('disable-gpu-sandbox');
  app?.commandLine?.appendSwitch('ignore-gpu-blocklist');
} catch (e) {
  console.log('[Siliu] Video switches not applied:', e.message);
}
// GPU 和扩展设置
try {
  app?.commandLine?.appendSwitch('enable-gpu-rasterization');
  app?.commandLine?.appendSwitch('enable-zero-copy');
  app?.commandLine?.appendSwitch('disable-extensions-except', '');
  app?.commandLine?.appendSwitch('disable-extensions', '');
} catch (e) {
  console.log('[Siliu] GPU switches not applied:', e.message);
}

// 请求单实例锁
let gotTheLock = false;
try {
  gotTheLock = app?.requestSingleInstanceLock?.() ?? true;
} catch (e) {
  console.log('[Siliu] Single instance lock not available:', e.message);
  gotTheLock = true;
}
if (!gotTheLock) {
  console.log('[Siliu] Another instance is already running, quitting...');
  app.quit();
  return;
}

// ========== 模块引用 ==========
const { globalEventBus } = require('./core/event-bus');
const ConfigManager = require('./core/config-manager');
const { AIServiceManager } = require('./services/ai-service');
const { getWorkspaceManager } = require('./core/workspace-manager');
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
  adblock: null,
  agentLoader: null  // 【新增】Agent 动态加载器
};

// ========== IPC 处理器状态 ==========
let ipcHandlersRegistered = false;

// ========== Agent Editor 状态跟踪 ==========
// 跟踪处于 Agent Editor 激活状态的视图（用于页面导航后重新注入）
const agentEditorActiveViews = new Set();
// 存储每个视图的坐标数据（用于页面导航后恢复）
const agentEditorData = new Map();
// 存储每个视图的暂存状态（用于页面导航后恢复）
const agentEditorPausedState = new Map();
// 记录最后操作的标签页（用于切换时同步数据）
let lastActiveAgentEditorView = null;

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

    // ①b 初始化工作区管理器（必须在其他模块之前）
    console.log('[Siliu] Initializing WorkspaceManager...');
    const workspaceManager = getWorkspaceManager();
    await workspaceManager.initialize();
    console.log('[Siliu] Workspace ready at:', workspaceManager.workspaceBase);

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
      console.log('[Siliu] ai:toast received:', message, type);
      modules.core?.sendToRenderer?.('ai:toast', { message, type });
      console.log('[Siliu] ai:toast sent to renderer');
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
    
    // 监听页面导航事件，在 Agent Editor 激活的视图导航后重新注入
    modules.core.tabManager.on('view:url-changed', async ({ viewId, url }) => {
      if (agentEditorActiveViews.has(viewId)) {
        console.log('[Agent Editor] View navigated, re-injecting:', viewId, url);
        
        const view = modules.core?.tabManager?.getView?.(viewId);
        if (!view) {
          console.log('[Agent Editor] View not found for re-inject');
          return;
        }
        
        console.log('[Agent Editor] Waiting for page to finish loading...');
        
        // 等待页面完全加载
        if (view.webContents?.isLoading?.()) {
          console.log('[Agent Editor] Page is loading, waiting for did-finish-load');
          await new Promise(resolve => {
            view.webContents.once('did-finish-load', resolve);
          });
          console.log('[Agent Editor] Page finished loading');
        } else {
          console.log('[Agent Editor] Page not loading, continuing immediately');
        }
        
        // 延迟一点时间确保页面稳定
        console.log('[Agent Editor] Waiting 500ms for stability...');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 获取保存的坐标数据
        const savedCoordinates = agentEditorData.get(viewId) || [];
        console.log('[Agent Editor] Sending', savedCoordinates.length, 'coordinates to shell');
        
        // 通知 shell 页面已导航，并传递坐标数据
        if (modules.core?.sendToRenderer) {
          console.log('[Agent Editor] Sending agentEditor:navigated to shell');
          modules.core.sendToRenderer('agentEditor:navigated', { viewId, url, coordinates: savedCoordinates });
          console.log('[Agent Editor] Sent agentEditor:navigated event');
        } else {
          console.log('[Agent Editor] sendToRenderer not available!');
        }
      }
    });
    
    // 监听最后一个标签页关闭，清理 Agent Editor 状态（避免新标签页自动继承）
    modules.core.tabManager.on('view:last-closed', () => {
      console.log('[Agent Editor] Last tab closed, clearing all Agent Editor state');
      agentEditorActiveViews.clear();
      agentEditorData.clear();
      agentEditorPausedState.clear();
      lastActiveAgentEditorView = null;
    });
    
    // 拦截标签页关闭：Agent Editor 活跃时禁止关闭
    const originalCloseView = modules.core.tabManager.closeView.bind(modules.core.tabManager);
    modules.core.tabManager.closeView = (viewId) => {
      // 检查是否有任何标签页处于 Agent Editor 状态
      if (agentEditorActiveViews.size > 0) {
        console.log('[Agent Editor] Blocking tab close - Agent Editor is active');
        modules.core?.sendToRenderer?.('toast:show', {
          message: 'Agent 编辑状态下该功能暂不可用',
          type: 'warning'
        });
        return; // 阻止关闭
      }
      // 正常关闭
      return originalCloseView(viewId);
    };
    
    // 监听新标签页创建，如果有任何标签页开启了 Agent Editor，则在新标签页也自动打开
    modules.core.tabManager.on('view:created', async ({ viewId, url }) => {
      // 检查是否有任何视图开启了 Agent Editor
      if (agentEditorActiveViews.size === 0) return;
      
      // 找到坐标数据最多的视图作为数据来源（确保继承最完整的数据）
      let sourceViewId = null;
      let maxCoords = 0;
      for (const vid of agentEditorActiveViews) {
        const coords = agentEditorData.get(vid)?.length || 0;
        if (coords > maxCoords) {
          maxCoords = coords;
          sourceViewId = vid;
        }
      }
      // 如果没有找到有数据的，取最后一个（最新的）
      if (!sourceViewId) {
        const viewsArray = Array.from(agentEditorActiveViews);
        sourceViewId = viewsArray[viewsArray.length - 1];
      }
      console.log('[Agent Editor] New tab created while Agent Editor active, injecting to new tab:', viewId, 'from:', sourceViewId, 'with', maxCoords, 'coords');
      
      const view = modules.core?.tabManager?.getView?.(viewId);
      if (!view) return;
      
      // 等待页面加载完成
      if (view.webContents?.isLoading?.()) {
        await new Promise(resolve => {
          view.webContents.once('did-finish-load', resolve);
        });
      }
      
      // 延迟确保页面稳定
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 获取源视图的坐标数据和暂存状态
      const savedCoordinates = agentEditorData.get(sourceViewId) || [];
      const isPaused = agentEditorPausedState.get(sourceViewId) || false;
      console.log('[Agent Editor] Sending to new tab - coordinates:', savedCoordinates.length, 'paused:', isPaused, 'from:', sourceViewId);
      
      // 通知 shell 在新标签页打开 Agent Editor
      if (modules.core?.sendToRenderer) {
        modules.core.sendToRenderer('agentEditor:newTab', { 
          viewId, 
          url, 
          coordinates: savedCoordinates,
          isPaused: isPaused,
          fromViewId: sourceViewId 
        });
        console.log('[Agent Editor] Sent newTab event');
      }
    });
    
    // 监听标签页切换，同步最后操作标签页的数据
    modules.core.tabManager.on('view:activated', ({ viewId }) => {
      // 只处理开启了 Agent Editor 的视图
      if (!agentEditorActiveViews.has(viewId)) return;
      
      // 如果没有最后操作的标签页，或者就是当前标签页，则不需要同步
      if (!lastActiveAgentEditorView || lastActiveAgentEditorView === viewId) return;
      
      // 获取最后操作标签页的数据
      const sourceCoords = agentEditorData.get(lastActiveAgentEditorView) || [];
      console.log('[Agent Editor] Tab activated, syncing from last active tab:', lastActiveAgentEditorView, 'to', viewId, ':', sourceCoords.length, 'coordinates');
      
      // 更新当前标签页的数据为最后操作标签页的数据
      agentEditorData.set(viewId, [...sourceCoords]);
      
      // 通知 shell 更新显示
      if (modules.core?.sendToRenderer) {
        modules.core.sendToRenderer('agentEditor:tabActivated', {
          viewId,
          coordinates: sourceCoords,
          count: sourceCoords.length
        });
      }
    });

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

    // 【新增】初始化动态 Agent 加载器
    console.log('[Siliu] Initializing DynamicAgentLoader...');
    const { DynamicAgentLoader } = require('./copilot/agents/dynamic-agent-loader');
    modules.agentLoader = new DynamicAgentLoader(workspaceManager);
    await modules.agentLoader.initialize();
    console.log('[Siliu] DynamicAgentLoader ready');

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

// ========== Agent Editor 脚本构建 ==========
/**
 * 构建 Agent Editor 注入脚本
 * @param {Object} savedData - 之前保存的坐标数据（可选）
 * @returns {string} 注入脚本
 */
function buildAgentEditorScript(savedData) {
  // 这是一个简化版本，它会在页面加载后重新注入 Agent Editor
  // 注：完整实现需要将原有的注入脚本提取出来作为可重用的函数
  // 这里先使用一个占位符，实际使用时需要调用 agentEditor:inject IPC
  return `
    (function() {
      if (document.getElementById('__agent_editor_overlay__')) {
        return 'already-exists';
      }
      
      // 创建提示标记，展示导航后重新注入的状态
      const indicator = document.createElement('div');
      indicator.id = '__agent_editor_reinject_indicator__';
      indicator.style.cssText = 
        'position:fixed;top:60px;left:16px;' +
        'background:#1A73E8;color:white;' +
        'padding:8px 16px;border-radius:8px;' +
        'font-family:system-ui,sans-serif;font-size:13px;' +
        'z-index:2147483649;box-shadow:0 4px 12px rgba(0,0,0,0.15);' +
        'animation:slideIn 0.3s ease-out;';
      indicator.innerHTML = '📝 Agent Editor 已恢复（页面导航）';
      document.body.appendChild(indicator);
      
      setTimeout(() => {
        indicator.style.transition = 'opacity 0.5s';
        indicator.style.opacity = '0';
        setTimeout(() => indicator.remove(), 500);
      }, 2000);
      
      return 'reinject-indicator-shown';
    })()
  `;
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

  // ========== Agent Editor: 标注编辑器注入 ==========
  
  // 接收 BrowserView 的标注点击消息并转发到 shell
  const annotationClickHandler = (event, data) => {
    console.log('[Agent Editor] Received annotation click in main process:', data);
    // event.sender 就是发送消息的 webContents，直接使用
    console.log('[Agent Editor] Sender webContents id:', event.sender.id);
    
    // 直接广播到所有 shell 窗口，不需要查找 view
    modules.core?.sendToRenderer?.('agentEditor:click', {
      ...data,
      viewId: event.sender.id
    });
    console.log('[Agent Editor] Broadcasted to shell');
  };
  
  // 使用 ipcMain.on 而不是 safeHandle，因为这是一个事件而不是请求
  try {
    ipcMain.removeListener('view:annotationClick', annotationClickHandler);
  } catch {}
  ipcMain.on('view:annotationClick', annotationClickHandler);
  
  // 监听 Agent Editor 关闭事件
  const agentEditorCloseHandler = (event) => {
    console.log('[Agent Editor] Close requested');
    modules.core?.sendToRenderer?.('agentEditor:close', {});
  };
  try {
    ipcMain.removeListener('view:agentEditorClose', agentEditorCloseHandler);
  } catch {}
  ipcMain.on('view:agentEditorClose', agentEditorCloseHandler);
  
  // 监听 Agent Editor 暂存状态变更
  const agentEditorPauseStateHandler = (event, { isPaused }) => {
    // 获取发送者的 webContents ID，找到对应的 viewId
    const senderId = event.sender.id;
    // views 是 Map，需要转换为数组再 find
    const viewsArray = Array.from(modules.core?.tabManager?.views?.values?.() || []);
    const view = viewsArray.find(v => v.view.webContents.id === senderId);
    if (view) {
      agentEditorPausedState.set(view.id, isPaused);
      console.log('[Agent Editor] Pause state updated for', view.id, ':', isPaused);
    } else {
      console.log('[Agent Editor] Could not find view for sender:', senderId);
    }
  };
  try {
    ipcMain.removeListener('view:agentEditorPauseState', agentEditorPauseStateHandler);
  } catch {}
  ipcMain.on('view:agentEditorPauseState', agentEditorPauseStateHandler);
  
  // 监听 Agent Editor 取消事件
  const agentEditorCancelHandler = (event) => {
    console.log('[Agent Editor] Cancel clicked, removing current marker');
    modules.core?.sendToRenderer?.('agentEditor:cancel', {});
  };
  try {
    ipcMain.removeListener('view:agentEditorCancel', agentEditorCancelHandler);
  } catch {}
  ipcMain.on('view:agentEditorCancel', agentEditorCancelHandler);
  
  // 监听 Agent Editor 取消全部事件（关闭所有标签页并放弃所有标注）
  const agentEditorCancelAllHandler = async (event) => {
    console.log('[Agent Editor] Cancel all clicked, closing all tabs and clearing all data');
    
    // 1. 立即清理所有 Agent Editor 状态（必须在关闭标签页之前）
    agentEditorActiveViews.clear();
    agentEditorData.clear();
    agentEditorPausedState.clear();
    lastActiveAgentEditorView = null;
    console.log('[Agent Editor] All Agent Editor state cleared');
    
    // 2. 通知 shell 清理状态
    modules.core?.sendToRenderer?.('agentEditor:cancelAll', {});
    console.log('[Agent Editor] Sent cancelAll event to shell');
    
    // 3. 获取所有视图 ID 并关闭
    const tabManager = modules.core?.tabManager;
    if (tabManager) {
      const allViewIds = Array.from(tabManager.views?.keys?.() || []);
      console.log('[Agent Editor] Closing all', allViewIds.length, 'tabs');
      
      // 关闭所有标签页
      for (const viewId of allViewIds) {
        try {
          tabManager.closeView?.(viewId);
        } catch (err) {
          console.log('[Agent Editor] Error closing tab', viewId, ':', err.message);
        }
      }
    }
    
    console.log('[Agent Editor] Cancel all completed');
  };
  try {
    ipcMain.removeListener('view:agentEditorCancelAll', agentEditorCancelAllHandler);
  } catch {}
  ipcMain.on('view:agentEditorCancelAll', agentEditorCancelAllHandler);
  
  // 监听保存 Agent 事件
  const agentEditorSaveHandler = async (event, data) => {
    console.log('[Agent Editor] Save agent clicked:', data.config?.metadata?.name);
    try {
      if (modules.agentLoader && data.config) {
        const result = await modules.agentLoader.saveAgent(data.config);
        console.log('[Agent Editor] Agent saved result:', result);
        if (result.success) {
          // 1. 手动触发刷新（watcher 可能不工作）
          console.log('[Agent Editor] Triggering manual refresh...');
          await modules.agentLoader.refresh();
          
          // 2. 通知 shell 显示成功提示
          modules.core?.sendToRenderer?.('toast:show', { 
            message: `Agent "${data.config.metadata.name}" 保存成功！`, 
            type: 'success' 
          });
          
          // 3. 通知 shell 刷新 Agent 列表
          modules.core?.sendToRenderer?.('agents:reload', {});
          
          // 4. 退出 Agent Editor 模式（保持页面打开，仅关闭标注面板）
          const senderViewId = event.sender?.id;
          if (senderViewId) {
            // 移除该视图的 Agent Editor 状态
            agentEditorActiveViews.delete(senderViewId);
            agentEditorData.delete(senderViewId);
            agentEditorPausedState.delete(senderViewId);
            if (lastActiveAgentEditorView === senderViewId) {
              lastActiveAgentEditorView = null;
            }
            // 移除页面上的标注面板
            try {
              const view = modules.core?.tabManager?.getViewByWebContentsId?.(senderViewId);
              if (view) {
                await modules.controller.agentEditorRemove(view.id);
              }
            } catch (err) {
              console.log('[Agent Editor] Error removing editor after save:', err.message);
            }
          }
          
          // 4. 如果所有标注都完成了，通知 shell 关闭 Agent Editor 状态
          if (agentEditorActiveViews.size === 0) {
            modules.core?.sendToRenderer?.('agentEditor:close', {});
          }
        } else {
          modules.core?.sendToRenderer?.('toast:show', { 
            message: '保存失败: ' + (result.error || '未知错误'), 
            type: 'error' 
          });
        }
      }
    } catch (err) {
      console.error('[Agent Editor] Failed to save agent:', err);
      modules.core?.sendToRenderer?.('toast:show', { 
        message: '保存失败: ' + err.message, 
        type: 'error' 
      });
    }
  };
  try {
    ipcMain.removeListener('view:agentEditorSave', agentEditorSaveHandler);
  } catch {}
  ipcMain.on('view:agentEditorSave', agentEditorSaveHandler);
  
  // 监听保存并关闭 Agent Editor 事件
  const agentEditorSaveAndCloseHandler = async (event, data) => {
    console.log('[Agent Editor] Save and close clicked:', data.config?.metadata?.name);
    try {
      if (modules.agentLoader && data.config) {
        const result = await modules.agentLoader.saveAgent(data.config);
        console.log('[Agent Editor] Agent saved result:', result);
        if (result.success) {
          // 1. 手动触发刷新（watcher 可能不工作）
          console.log('[Agent Editor] Triggering manual refresh...');
          await modules.agentLoader.refresh();
          
          // 2. 显示成功提示
          modules.core?.sendToRenderer?.('toast:show', { 
            message: `Agent "${data.config.metadata.name}" 保存成功！`, 
            type: 'success' 
          });
          
          // 3. 刷新 Agent 列表
          modules.core?.sendToRenderer?.('agents:reload', {});
          
          // 4. 关闭所有标签页并清空缓存（与取消按钮一致的行为）
          console.log('[Agent Editor] Save completed, closing all tabs and clearing all data');
          
          // 立即清理所有 Agent Editor 状态
          agentEditorActiveViews.clear();
          agentEditorData.clear();
          agentEditorPausedState.clear();
          lastActiveAgentEditorView = null;
          console.log('[Agent Editor] All Agent Editor state cleared');
          
          // 通知 shell 关闭所有状态
          modules.core?.sendToRenderer?.('agentEditor:cancelAll', {});
          
          // 获取所有视图 ID 并关闭
          const tabManager = modules.core?.tabManager;
          if (tabManager) {
            const allViewIds = Array.from(tabManager.views?.keys?.() || []);
            console.log('[Agent Editor] Closing all', allViewIds.length, 'tabs after save');
            
            for (const viewId of allViewIds) {
              try {
                tabManager.closeView?.(viewId);
              } catch (err) {
                console.log('[Agent Editor] Error closing tab', viewId, ':', err.message);
              }
            }
          }
          
          console.log('[Agent Editor] Save and close completed');
        } else {
          modules.core?.sendToRenderer?.('toast:show', { 
            message: '保存失败: ' + (result.error || '未知错误'), 
            type: 'error' 
          });
        }
      }
    } catch (err) {
      console.error('[Agent Editor] Failed to save agent:', err);
      modules.core?.sendToRenderer?.('toast:show', { 
        message: '保存失败: ' + err.message, 
        type: 'error' 
      });
    }
  };
  try {
    ipcMain.removeListener('view:agentEditorSaveAndClose', agentEditorSaveAndCloseHandler);
  } catch {}
  ipcMain.on('view:agentEditorSaveAndClose', agentEditorSaveAndCloseHandler);
  
  // 监听 Toast 请求
  const agentEditorToastHandler = async (event, data) => {
    console.log('[Agent Editor] Toast request:', data.message);
    modules.core?.sendToRenderer?.('toast:show', { 
      message: data.message, 
      type: data.type || 'info'
    });
  };
  try {
    ipcMain.removeListener('view:agentEditorToast', agentEditorToastHandler);
  } catch {}
  ipcMain.on('view:agentEditorToast', agentEditorToastHandler);
  
  // 监听坐标命名确认
  const annotationNameConfirmedHandler = async (event, data) => {
    console.log('[Agent Editor] annotationNameConfirmedHandler CALLED');
    console.log('[Agent Editor] Name confirmed, sender id:', event.sender?.id);
    console.log('[Agent Editor] Received data:', data);
    
    // 获取当前 view 的截图
    const senderId = event.sender.id;
    const tabManager = modules.core?.tabManager;
    
    // 从 views Map 中查找
    let targetView = null;
    if (tabManager?.views) {
      for (const [viewId, viewData] of tabManager.views.entries()) {
        if (viewData.view?.webContents?.id === senderId) {
          targetView = viewData;
          break;
        }
      }
    }
    
    console.log('[Agent Editor] Sender id:', senderId, 'Found view:', targetView ? 'yes' : 'no');
    
    let screenshotPath = null;
    if (targetView?.view?.webContents) {
      console.log('[Agent Editor] Capturing page...');
      try {
        const image = await targetView.view.webContents.capturePage();
        
        // 保存截图到文件
        const fs = require('fs').promises;
        const path = require('path');
        const workspaceManager = getWorkspaceManager();
        const screenshotsDir = workspaceManager.getScreenshotsDir();
        
        // 确保目录存在
        await fs.mkdir(screenshotsDir, { recursive: true });
        
        // 生成文件名: {site}_{page}_{timestamp}.png
        const url = new URL(data.url || 'http://unknown');
        const hostname = url.hostname.replace(/^www\./, '').replace(/[^a-zA-Z0-9]/g, '_');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${hostname}_${timestamp}.png`;
        screenshotPath = path.join(screenshotsDir, filename);
        
        // 保存图片
        await fs.writeFile(screenshotPath, image.toPNG());
        console.log('[Agent Editor] Screenshot saved to:', screenshotPath);
      } catch (err) {
        console.error('[Agent Editor] Failed to save screenshot:', err.message);
      }
    } else {
      console.log('[Agent Editor] No view found for screenshot');
    }
    
    // 广播完整数据到 shell（包含截图路径）
    console.log('[Agent Editor] Broadcasting to shell, sendToRenderer exists:', !!modules.core?.sendToRenderer);
    console.log('[Agent Editor] screenshotPath to send:', screenshotPath);
    const dataToSend = {
      name: data.name,
      viewportX: data.viewportX,
      viewportY: data.viewportY,
      docX: data.docX,
      docY: data.docY,
      scrollX: data.scrollX,
      scrollY: data.scrollY,
      viewportWidth: data.viewportWidth,
      viewportHeight: data.viewportHeight,
      tag: data.tag,
      selector: data.selector,
      url: data.url,
      screenshotPath: screenshotPath  // 文件路径，不是 base64
    };
    console.log('[Agent Editor] Full data to send:', JSON.stringify(dataToSend, null, 2));
    if (modules.core?.sendToRenderer) {
      modules.core.sendToRenderer('agentEditor:nameConfirmed', dataToSend);
      console.log('[Agent Editor] Data sent to renderer');
    } else {
      console.log('[Agent Editor] sendToRenderer not available');
    }
  };
  try {
    ipcMain.removeListener('view:annotationNameConfirmed', annotationNameConfirmedHandler);
  } catch {}
  ipcMain.on('view:annotationNameConfirmed', annotationNameConfirmedHandler);
  
  console.log('[Siliu] Registering agentEditor:inject handler...');
  safeHandle('agentEditor:inject', async (event, viewId, customScript, coordinates) => {
    console.log('========================================');
    console.log('[Agent Editor] Inject for view:', viewId);
    console.log('[Agent Editor] customScript provided:', !!customScript);
    console.log('========================================');
    
    try {
      // 先读取 SVG 图标（无论是否使用自定义脚本都需要）
      const iconSvgs = {};
      try {
        const iconsDir = path.join(__dirname, '../assets/icons');
        console.log('[Agent Editor] Loading icons from:', iconsDir);
        const iconFiles = {
          'robot': 'robot.svg',
          'magnifying-glass': 'magnifying-glass.svg',
          'shopping-cart': 'shopping-cart.svg',
          'chart-bar': 'chart-bar.svg',
          'file-text': 'file-text.svg',
          'game-controller': 'game-controller.svg',
          'users': 'users.svg',
          'wrench': 'wrench.svg',
          'star': 'star.svg',
          'bookmark': 'bookmark.svg'
        };
        for (const [key, filename] of Object.entries(iconFiles)) {
          try {
            const svgPath = path.join(iconsDir, filename);
            const svgContent = fs.readFileSync(svgPath, 'utf-8');
            console.log('[Agent Editor] Loaded icon:', filename, 'size:', svgContent.length);
            iconSvgs[key] = svgContent;
          } catch (err) {
            console.error('[Agent Editor] Failed to load icon:', filename, err.message);
          }
        }
      } catch (err) {
        console.error('[Agent Editor] Failed to load icons:', err.message);
      }
      
      const view = modules.core?.tabManager?.getView?.(viewId);
      if (!view) {
        console.log('[Agent Editor] View not found:', viewId);
        return { success: false, error: 'View not found' };
      }
      
      // 如果传入自定义脚本，直接执行
      console.log('[Agent Editor] Checking customScript:', typeof customScript, customScript ? 'provided' : 'null/undefined');
      if (customScript) {
        console.log('[Agent Editor] Executing custom script, length:', customScript.length);
        const result = await view.webContents.executeJavaScript(customScript, true);
        console.log('[Agent Editor] Custom script result:', result);
        return { success: true, result };
      }
      
      console.log('[Agent Editor] View found, webContents id:', view.webContents.id);
      
      // 从主进程读取暂存状态和坐标数据
      const wasPausedBefore = agentEditorPausedState.get(viewId) || false;
      // 优先使用传入的 coordinates 参数，否则从 Map 读取
      const savedCoordinates = coordinates !== undefined ? coordinates : (agentEditorData.get(viewId) || []);
      console.log('[Agent Editor] Was paused before navigation:', wasPausedBefore);
      console.log('[Agent Editor] Coordinates to restore:', savedCoordinates.length);
      console.log('[Agent Editor] Was paused before navigation:', wasPausedBefore);
      console.log('[Agent Editor] Coordinates to restore:', savedCoordinates.length);
      
      // 将坐标数据序列化为 JSON 字符串传入脚本
      const coordinatesJson = JSON.stringify(savedCoordinates);
      
      const script = `
        (function() {
          console.log('[Agent Editor] Script executing in page context');
          
          // 自定义确认弹窗 - Promise 版本
          function showConfirmDialog(message, title = '确认') {
            return new Promise((resolve) => {
              // 移除已存在的弹窗
              const existing = document.getElementById('__agent_editor_confirm_modal__');
              if (existing) existing.remove();
              
              // 创建遮罩
              const overlay = document.createElement('div');
              overlay.id = '__agent_editor_confirm_modal__';
              overlay.style.cssText = 
                'position:fixed;top:0;left:0;right:0;bottom:0;' +
                'background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);' +
                'display:flex;align-items:center;justify-content:center;' +
                'z-index:2147483650;opacity:0;transition:opacity 0.2s;';
              
              // 创建弹窗
              const modal = document.createElement('div');
              modal.style.cssText = 
                'background:white;border-radius:12px;width:400px;max-width:90vw;' +
                'box-shadow:0 20px 60px rgba(0,0,0,0.2);overflow:hidden;' +
                'transform:scale(0.95);transition:transform 0.2s;';
              
              // 头部
              const header = document.createElement('div');
              header.style.cssText = 'padding:16px 20px;border-bottom:1px solid #e5e7eb;';
              header.innerHTML = '<h3 style="margin:0;font-size:16px;font-weight:600;color:#111827;">' + title + '</h3>';
              
              // 内容
              const body = document.createElement('div');
              body.style.cssText = 'padding:20px;';
              body.innerHTML = '<p style="margin:0;font-size:14px;color:#4b5563;line-height:1.5;">' + message + '</p>';
              
              // 按钮区域
              const footer = document.createElement('div');
              footer.style.cssText = 'padding:12px 20px 16px;display:flex;justify-content:flex-end;gap:8px;';
              
              // 关闭弹窗的函数
              const closeModal = (result) => {
                overlay.style.opacity = '0';
                modal.style.transform = 'scale(0.95)';
                setTimeout(() => {
                  overlay.remove();
                  resolve(result);
                }, 200);
              };
              
              // 取消按钮
              const cancelBtn = document.createElement('button');
              cancelBtn.textContent = '取消';
              cancelBtn.style.cssText = 
                'padding:8px 16px;font-size:13px;font-weight:500;color:#6b7280;' +
                'background:transparent;border:none;border-radius:6px;cursor:pointer;' +
                'transition:all 0.15s;';
              cancelBtn.onmouseenter = () => cancelBtn.style.background = '#f3f4f6';
              cancelBtn.onmouseleave = () => cancelBtn.style.background = 'transparent';
              cancelBtn.onclick = () => closeModal(false);
              
              // 确认按钮
              const confirmBtn = document.createElement('button');
              confirmBtn.textContent = '确定';
              confirmBtn.style.cssText = 
                'padding:8px 16px;font-size:13px;font-weight:500;color:white;' +
                'background:#dc2626;border:none;border-radius:6px;cursor:pointer;' +
                'transition:all 0.15s;';
              confirmBtn.onmouseenter = () => confirmBtn.style.background = '#b91c1c';
              confirmBtn.onmouseleave = () => confirmBtn.style.background = '#dc2626';
              confirmBtn.onclick = () => closeModal(true);
              
              footer.appendChild(cancelBtn);
              footer.appendChild(confirmBtn);
              modal.appendChild(header);
              modal.appendChild(body);
              modal.appendChild(footer);
              overlay.appendChild(modal);
              document.body.appendChild(overlay);
              
              // 动画显示
              requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                modal.style.transform = 'scale(1)';
              });
              
              // ESC 取消
              const escHandler = (e) => {
                if (e.key === 'Escape') {
                  document.removeEventListener('keydown', escHandler);
                  closeModal(false);
                }
              };
              document.addEventListener('keydown', escHandler);
              
              // 点击遮罩关闭
              overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                  closeModal(false);
                }
              });
            });
          }
          
          // 暂存状态管理 - 从传入的参数恢复
          let isPaused = ${wasPausedBefore};
          console.log('[Agent Editor] Initial isPaused:', isPaused);
          
          // 坐标数据 - 从传入的参数恢复（使用 window 全局变量以便外部更新）
          window.savedCoordinates = ${coordinatesJson};
          console.log('[Agent Editor] Initial savedCoordinates:', window.savedCoordinates.length);
          
          if (document.getElementById('__agent_editor_overlay__')) {
            console.log('[Agent Editor] Already exists');
            return 'already-exists';
          }
          
          const overlay = document.createElement('div');
          overlay.id = '__agent_editor_overlay__';
          overlay.style.cssText = 
            'position:fixed;top:0;left:0;width:100%;height:100%;' +
            'z-index:2147483647;cursor:crosshair;background:rgba(233,69,96,0.2);' +
            (isPaused ? 'display:none;pointer-events:none;' : '');
          
          // 创建左上角手风琴面板（Agent Editor）
          const historyPanel = document.createElement('div');
          historyPanel.id = '__agent_editor_panel__';
          historyPanel.style.cssText = 
            'position:fixed;' +
            'top:16px;' +
            'left:16px;' +
            'width:320px;' +
            'z-index:2147483649;' +
            'background:#ffffff;' +
            'border:1px solid rgba(0,0,0,0.08);' +
            'border-radius:16px;' +
            'box-shadow:0 20px 60px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.08);' +
            'pointer-events:auto;' +
            'display:flex;' +
            'flex-direction:column;' +
            'overflow:hidden;' +
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;';
          
          // Panel 1: 可点击展开的头部（包含三个 icon 按钮 + 展开箭头）
          const panelHeader = document.createElement('div');
          panelHeader.id = '__agent_editor_header__';
          panelHeader.style.cssText = 
            'padding:14px 16px;' +
            'background:#ffffff;' +
            'display:flex;' +
            'align-items:center;' +
            'justify-content:space-between;' +
            'cursor:grab;' +
            'transition:background 0.15s;';
          panelHeader.onmouseenter = () => { panelHeader.style.background = '#fafafa'; };
          panelHeader.onmouseleave = () => { panelHeader.style.background = '#ffffff'; };
          
          // 左侧：图标 + 标题 + 计数
          const panelLeft = document.createElement('div');
          panelLeft.style.cssText = 'display:flex;align-items:center;gap:10px;overflow:hidden;';
          panelLeft.innerHTML = 
            '<div style="width:32px;height:32px;flex-shrink:0;background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);border-radius:8px;display:flex;align-items:center;justify-content:center;">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2">' +
            '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="white"/>' +
            '</svg></div>' +
            '<div style="overflow:hidden;">' +
            '<div style="font-size:13px;font-weight:600;color:#111827;white-space:nowrap;">Agent 编辑器</div>' +
            '<div style="font-size:11px;color:#6b7280;white-space:nowrap;">已标注 <span id="__agent_editor_count__">0</span> 处</div>' +
            '</div>';
          
          // 右侧：三个 icon 按钮 + 展开箭头
          const panelRight = document.createElement('div');
          panelRight.style.cssText = 'display:flex;align-items:center;gap:4px;flex-shrink:0;';
          
          // 取消按钮（icon only）
          const cancelBtn = document.createElement('button');
          cancelBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>';
          cancelBtn.title = '取消';
          cancelBtn.style.cssText = 
            'width:28px;height:28px;display:flex;align-items:center;justify-content:center;' +
            'background:transparent;color:#9ca3af;border:none;border-radius:6px;cursor:pointer;' +
            'transition:all 0.15s;';
          cancelBtn.onmouseenter = () => { cancelBtn.style.background = '#fee2e2'; cancelBtn.style.color = '#dc2626'; };
          cancelBtn.onmouseleave = () => { cancelBtn.style.background = 'transparent'; cancelBtn.style.color = '#9ca3af'; };
          cancelBtn.onclick = async (e) => {
            e.stopPropagation();
            console.log('[Agent Editor] Cancel button clicked, coordinates:', window.savedCoordinates?.length || 0);
            
            // 如果没有标记的点位，直接关闭不需要弹窗
            if (!window.savedCoordinates || window.savedCoordinates.length === 0) {
              console.log('[Agent Editor] No coordinates, closing directly');
              window.postMessage({ type: 'AGENT_EDITOR_CANCEL_ALL' }, '*');
              return;
            }
            
            // 有标记时显示确认弹窗
            const confirmed = await showConfirmDialog('确定要放弃所有已完成的标注并关闭所有标签页吗？', '取消确认');
            if (confirmed) {
              console.log('[Agent Editor] Cancel confirmed, sending CANCEL_ALL');
              window.postMessage({ type: 'AGENT_EDITOR_CANCEL_ALL' }, '*');
            }
          };
          
          // 暂存按钮（icon only）
          const pauseBtn = document.createElement('button');
          // 根据传入的暂存状态设置初始图标
          pauseBtn.innerHTML = isPaused 
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
          pauseBtn.title = isPaused ? '继续' : '暂存';
          pauseBtn.style.cssText = 
            'width:28px;height:28px;display:flex;align-items:center;justify-content:center;' +
            'background:transparent;color:' + (isPaused ? '#2563eb' : '#9ca3af') + ';border:none;border-radius:6px;cursor:pointer;' +
            'transition:all 0.15s;';
          pauseBtn.onmouseenter = () => { 
            if (!isPaused) {
              pauseBtn.style.background = '#fef3c7'; 
              pauseBtn.style.color = '#d97706'; 
            } else {
              pauseBtn.style.background = '#dbeafe'; 
              pauseBtn.style.color = '#2563eb'; 
            }
          };
          pauseBtn.onmouseleave = () => { 
            pauseBtn.style.background = 'transparent'; 
            pauseBtn.style.color = isPaused ? '#2563eb' : '#9ca3af';
          };
          
          // 暂存/继续切换功能
          pauseBtn.onclick = (e) => { 
            e.stopPropagation();
            
            const overlay = document.getElementById('__agent_editor_overlay__');
            if (!overlay) return;
            
            isPaused = !isPaused;
            
            // 通过 postMessage 通知主进程更新状态
            window.postMessage({ type: 'AGENT_EDITOR_PAUSE_STATE', isPaused: isPaused }, '*');
            console.log('[Agent Editor] Pause state change sent:', isPaused);
            
            if (isPaused) {
              // 暂存：隐藏遮罩层，恢复页面操作
              overlay.style.display = 'none';
              overlay.style.pointerEvents = 'none';
              pauseBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
              pauseBtn.title = '继续';
              pauseBtn.style.color = '#2563eb';
              console.log('[Agent Editor] Paused - overlay hidden');
            } else {
              // 继续：显示遮罩层，恢复标注能力
              overlay.style.display = 'block';
              overlay.style.pointerEvents = 'auto';
              pauseBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
              pauseBtn.title = '暂存';
              pauseBtn.style.color = '#9ca3af';
              console.log('[Agent Editor] Resumed - overlay shown');
            }
          };
          
          // 保存按钮（icon only）
          const saveBtn = document.createElement('button');
          saveBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>';
          saveBtn.title = '保存为 Agent';
          saveBtn.style.cssText = 
            'width:28px;height:28px;display:flex;align-items:center;justify-content:center;' +
            'background:transparent;color:#9ca3af;border:none;border-radius:6px;cursor:pointer;' +
            'transition:all 0.15s;';
          saveBtn.onmouseenter = () => { saveBtn.style.background = '#d1fae5'; saveBtn.style.color = '#059669'; };
          saveBtn.onmouseleave = () => { saveBtn.style.background = 'transparent'; saveBtn.style.color = '#9ca3af'; };
          saveBtn.onclick = async (e) => {
            e.stopPropagation();
            console.log('[Agent Editor] Save button clicked, coordinates:', window.savedCoordinates?.length || 0);
            
            // 如果没有标记的点位，toast 提示
            if (!window.savedCoordinates || window.savedCoordinates.length === 0) {
              console.log('[Agent Editor] No coordinates, showing toast');
              // 发送 toast 消息到主进程
              window.postMessage({ type: 'AGENT_EDITOR_TOAST', message: '请先完成 Agent 标注', toastType: 'warning' }, '*');
              return;
            }
            
            // 获取当前域名和路径
            const domain = window.location.hostname;
            const url = window.location.href;
            
            // 调用保存弹窗函数
            const result = await showSaveAgentDialog(window.savedCoordinates || [], domain, url);
            if (result) {
              console.log('[Agent Editor] Agent config prepared:', result.name);
              // 发送给主进程保存并关闭
              window.postMessage({ 
                type: 'AGENT_EDITOR_SAVE_AND_CLOSE', 
                config: result 
              }, '*');
            }
          };
          
          // 保存 Agent 弹窗函数
          function showSaveAgentDialog(coordinates, domain, url) {
            return new Promise((resolve) => {
              // 移除已存在的弹窗
              const existing = document.getElementById('__agent_editor_save_modal__');
              if (existing) existing.remove();
              
              // 生成 10 位随机码: agent-xxxxxxxxxx (只含小写和数字)
              const randomId = () => {
                const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
                const arr = new Uint8Array(10);
                crypto.getRandomValues(arr);
                return 'agent-' + Array.from(arr, b => chars[b % 36]).join('');
              };
              const defaultId = randomId();
              const pagePath = new URL(url).pathname;
              
              // SVG 图标（从文件读取，添加尺寸样式）
              const iconSvgs = ${JSON.stringify(iconSvgs)};
              console.log('[Agent Editor] Icons loaded:', Object.keys(iconSvgs));
              // 给 SVG 添加尺寸样式
              const formatSvg = (svg) => {
                if (!svg) return '<span>●</span>';
                return svg.replace('<svg', '<svg style="width:20px;height:20px;display:block;"');
              };
              const icons = [
                { name: '机器人', icon: 'robot', svg: formatSvg(iconSvgs['robot']) },
                { name: '搜索', icon: 'magnifying-glass', svg: formatSvg(iconSvgs['magnifying-glass']) },
                { name: '购物', icon: 'shopping-cart', svg: formatSvg(iconSvgs['shopping-cart']) },
                { name: '数据', icon: 'chart-bar', svg: formatSvg(iconSvgs['chart-bar']) },
                { name: '文档', icon: 'file-text', svg: formatSvg(iconSvgs['file-text']) },
                { name: '游戏', icon: 'game-controller', svg: formatSvg(iconSvgs['game-controller']) },
                { name: '用户', icon: 'users', svg: formatSvg(iconSvgs['users']) },
                { name: '工具', icon: 'wrench', svg: formatSvg(iconSvgs['wrench']) },
                { name: '星标', icon: 'star', svg: formatSvg(iconSvgs['star']) },
                { name: '书签', icon: 'bookmark', svg: formatSvg(iconSvgs['bookmark']) }
              ];
              
              // 颜色选项 - 鲜色系（与灰色图标区分）
              const colors = [
                { name: '蓝色', value: '#1A73E8', end: '#4285F4' },
                { name: '红色', value: '#EA4335', end: '#FF6B6B' },
                { name: '绿色', value: '#34A853', end: '#51CF66' },
                { name: '橙色', value: '#FB8C00', end: '#FFAA33' },
                { name: '紫色', value: '#7C3AED', end: '#A855F7' },
                { name: '青色', value: '#0891B2', end: '#22D3EE' },
                { name: '粉色', value: '#DB2777', end: '#F472B6' },
                { name: '深蓝', value: '#4338CA', end: '#6366F1' }
              ];
              
              const overlay = document.createElement('div');
              overlay.id = '__agent_editor_save_modal__';
              overlay.style.cssText = 
                'position:fixed;top:0;left:0;right:0;bottom:0;' +
                'background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);' +
                'display:flex;align-items:center;justify-content:center;' +
                'z-index:2147483650;opacity:0;transition:opacity 0.2s;' +
                'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
              
              const modal = document.createElement('div');
              modal.style.cssText = 
                'background:white;border-radius:16px;width:480px;max-width:90vw;' +
                'max-height:85vh;overflow-y:auto;' +
                'box-shadow:0 25px 80px rgba(0,0,0,0.25);' +
                'transform:scale(0.95);transition:transform 0.2s;';
              
              // 预览元素
              let previewIcon = icons[0];
              let previewColor = colors[0];
              
              const header = document.createElement('div');
              header.style.cssText = 'padding:16px 20px;border-bottom:1px solid #DADCE0;background:white;display:flex;align-items:center;gap:12px;';
              
              // 预览区域
              const previewBox = document.createElement('div');
              previewBox.id = '__agent_preview_box__';
              previewBox.style.cssText = 
                'width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;' +
                'background:linear-gradient(135deg,' + previewColor.value + ',' + previewColor.end + ');' +
                'box-shadow:0 2px 8px ' + previewColor.value + '40;transition:all 0.3s;';
              previewBox.style.color = 'white';
              previewBox.innerHTML = icons[0].svg;
              
              header.appendChild(previewBox);
              header.innerHTML += '<h3 style="margin:0;font-size:17px;font-weight:600;color:#202124;flex:1;letter-spacing:-0.2px;">保存为 Agent</h3>';
              
              const body = document.createElement('div');
              body.style.cssText = 'padding:20px;';
              
              // 幻灯片提示
              const coordHint = document.createElement('div');
              coordHint.style.cssText = 'background:linear-gradient(135deg,' + previewColor.value + '15,' + previewColor.end + '15);border-radius:12px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#5F6368;border:1px solid ' + previewColor.value + '20;';
              coordHint.innerHTML = '<div style="display:flex;align-items:center;gap:4px;"><span style="color:#5F6368;">已标注 <strong style="color:' + previewColor.value + ';">' + coordinates.length + '</strong> 个坐标</span></div>';
              body.appendChild(coordHint);
              
              // 现代化输入框样式
              const inputBase = 'width:100%;padding:12px 14px;border:1.5px solid #E8EAED;border-radius:10px;font-size:14px;outline:none;transition:all 0.2s;box-sizing:border-box;color:#202124;background:#FAFBFC;';
              const inputFocus = 'border-color:' + previewColor.value + ';background:#fff;box-shadow:0 0 0 3px ' + previewColor.value + '15;';
              
              // Agent 名称 + ID 同行
              const nameRow = document.createElement('div');
              nameRow.style.cssText = 'display:grid;grid-template-columns:1fr 140px;gap:12px;margin-bottom:16px;';
              
              const nameField = document.createElement('div');
              nameField.innerHTML = '<label style="display:block;font-size:13px;font-weight:600;color:#202124;margin-bottom:6px;">Agent 名称</label>';
              const nameInput = document.createElement('input');
              nameInput.type = 'text';
              nameInput.placeholder = '例如: 淘宝搜索助手';
              nameInput.style.cssText = inputBase;
              nameInput.onfocus = () => nameInput.style.cssText = inputBase + inputFocus;
              nameInput.onblur = () => nameInput.style.cssText = inputBase;
              nameField.appendChild(nameInput);
              nameRow.appendChild(nameField);
              
              const idField = document.createElement('div');
              idField.innerHTML = '<label style="display:block;font-size:13px;font-weight:600;color:#202124;margin-bottom:6px;">Agent ID</label>';
              const idInput = document.createElement('input');
              idInput.type = 'text';
              idInput.value = defaultId;
              idInput.readOnly = true;
              idInput.style.cssText = 'width:100%;padding:12px 10px;border:1.5px solid #E8EAED;border-radius:10px;font-size:13px;outline:none;box-sizing:border-box;color:#9AA0A6;background:#F1F3F4;font-family:monospace;cursor:not-allowed;';
              idField.appendChild(idInput);
              nameRow.appendChild(idField);
              body.appendChild(nameRow);
              
              // 图标 + 颜色 + 描述 布局
              const visualRow = document.createElement('div');
              visualRow.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:16px;margin-bottom:20px;';
              
              // 左侧：图标（2排）
              const iconField = document.createElement('div');
              iconField.innerHTML = '<label style="display:block;font-size:13px;font-weight:600;color:#202124;margin-bottom:8px;">图标</label>';
              const iconGrid = document.createElement('div');
              iconGrid.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:6px;';
              let selectedIcon = icons[0];
              // 更新预览函数
              const updatePreview = () => {
                const preview = document.getElementById('__agent_preview_box__');
                if (preview && previewIcon) {
                  preview.style.background = 'linear-gradient(135deg,' + previewColor.value + ',' + previewColor.end + ')';
                  preview.style.boxShadow = '0 2px 8px ' + previewColor.value + '40';
                  preview.style.color = 'white';
                  preview.innerHTML = previewIcon.svg;
                }
              };
              
              icons.forEach((item, idx) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.style.cssText = 
                  'width:36px;height:36px;border:2px solid ' + (idx === 0 ? previewColor.value : '#E8EAED') + ';border-radius:8px;' +
                  'background:' + (idx === 0 ? previewColor.value + '15' : '#FAFBFC') + ';cursor:pointer;' +
                  'display:flex;align-items:center;justify-content:center;color:' + (idx === 0 ? previewColor.value : '#9ca3af') + ';' +
                  'transition:all 0.2s;padding:0;box-shadow:' + (idx === 0 ? '0 2px 6px ' + previewColor.value + '20' : 'none') + ';';
                btn.innerHTML = item.svg;
                btn.title = item.name;
                btn.onmouseenter = () => { if (btn.style.borderColor !== previewColor.value) { btn.style.borderColor = '#DADCE0'; btn.style.background = '#F1F3F4'; } };
                btn.onmouseleave = () => { if (btn.style.borderColor !== previewColor.value) { btn.style.borderColor = '#E8EAED'; btn.style.background = '#FAFBFC'; } };
                btn.onclick = () => {
                  selectedIcon = item;
                  previewIcon = item;
                  updatePreview();
                  iconGrid.querySelectorAll('button').forEach((b, i) => {
                    b.style.borderColor = i === idx ? previewColor.value : '#E8EAED';
                    b.style.background = i === idx ? previewColor.value + '15' : '#FAFBFC';
                    b.style.color = i === idx ? previewColor.value : '#9ca3af';
                    b.style.boxShadow = i === idx ? '0 2px 8px ' + previewColor.value + '20' : 'none';
                  });
                };
                iconGrid.appendChild(btn);
              });
              iconField.appendChild(iconGrid);
              
              // 图标下方的描述输入
              const descInIcon = document.createElement('div');
              descInIcon.style.cssText = 'margin-top:16px;';
              descInIcon.innerHTML = '<label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#202124;margin-bottom:6px;"><span>描述</span><span style="font-size:11px;font-weight:400;color:#9AA0A6;background:#F1F3F4;padding:2px 6px;border-radius:4px;">可选</span></label>';
              const descInput2 = document.createElement('input');
              descInput2.type = 'text';
              descInput2.placeholder = '简短描述这个 Agent...';
              descInput2.style.cssText = inputBase;
              descInput2.onfocus = () => descInput2.style.cssText = inputBase + inputFocus;
              descInput2.onblur = () => descInput2.style.cssText = inputBase;
              descInIcon.appendChild(descInput2);
              iconField.appendChild(descInIcon);
              
              visualRow.appendChild(iconField);
              
              // 颜色选择
              const colorField = document.createElement('div');
              colorField.innerHTML = '<label style="display:block;font-size:13px;font-weight:600;color:#202124;margin-bottom:8px;">颜色</label>';
              const colorGrid = document.createElement('div');
              colorGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;max-width:100px;';
              let selectedColor = colors[0];
              colors.forEach((item, idx) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.style.cssText = 
                  'width:32px;height:32px;border-radius:50%;border:2px solid ' + (idx === 0 ? 'white' : 'transparent') + ';' +
                  'background:linear-gradient(135deg,' + item.value + ',' + item.end + ');cursor:pointer;' +
                  'transition:all 0.2s;box-shadow:0 2px 6px ' + item.value + '30,' + (idx === 0 ? '0 0 0 2px ' + item.value : '') + ';';
                btn.title = item.name;
                btn.onmouseenter = () => { if (btn.style.boxShadow.indexOf('0 0 0 2px') === -1) btn.style.transform = 'scale(1.1)'; };
                btn.onmouseleave = () => { btn.style.transform = 'scale(1)'; };
                btn.onclick = () => {
                  selectedColor = item;
                  previewColor = item;
                  updatePreview();
                  // 更新图标边框颜色
                  iconGrid.querySelectorAll('button').forEach((b, i) => {
                    if (b.style.boxShadow !== 'none') {
                      b.style.borderColor = item.value;
                      b.style.background = item.value + '15';
                      b.style.color = item.value;
                      b.style.boxShadow = '0 2px 8px ' + item.value + '20';
                    }
                  });
                  colorGrid.querySelectorAll('button').forEach((b, i) => {
                    b.style.borderColor = i === idx ? 'white' : 'transparent';
                    b.style.boxShadow = '0 2px 6px ' + colors[i].value + '30,' + (i === idx ? '0 0 0 2px ' + colors[i].value : '');
                  });
                };
                colorGrid.appendChild(btn);
              });
              colorField.appendChild(colorGrid);
              visualRow.appendChild(colorField);
              body.appendChild(visualRow);
              
              // 性格能力
              const personalityField = document.createElement('div');
              personalityField.style.cssText = 'margin-bottom:4px;';
              personalityField.innerHTML = '<label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#202124;margin-bottom:8px;"><span>性格与能力</span><span style="font-size:11px;font-weight:400;color:#9AA0A6;background:#F1F3F4;padding:2px 6px;border-radius:4px;">可选</span></label>';
              const personalityInput = document.createElement('textarea');
              personalityInput.placeholder = '例如: 擅长网页数据采集、熟悉淘宝搜索和购物流程...';
              personalityInput.style.cssText = inputBase + 'min-height:70px;resize:vertical;';
              personalityInput.onfocus = () => personalityInput.style.cssText = inputBase + 'min-height:70px;resize:vertical;' + inputFocus;
              personalityInput.onblur = () => personalityInput.style.cssText = inputBase + 'min-height:70px;resize:vertical;';
              personalityField.appendChild(personalityInput);
              body.appendChild(personalityField);
              
              // 底部按钮
              const footer = document.createElement('div');
              footer.style.cssText = 'padding:16px 20px;border-top:1px solid #E8EAED;display:flex;justify-content:flex-end;gap:12px;background:#FAFBFC;';
              
              const closeModal = (result) => {
                overlay.style.opacity = '0';
                modal.style.transform = 'scale(0.95)';
                setTimeout(() => {
                  overlay.remove();
                  resolve(result);
                }, 200);
              };
              
              const cancelBtn = document.createElement('button');
              cancelBtn.textContent = '取消';
              cancelBtn.style.cssText = 
                'padding:10px 20px;font-size:14px;font-weight:500;color:#5F6368;' +
                'background:#fff;border:1.5px solid #E8EAED;border-radius:8px;cursor:pointer;' +
                'transition:all 0.2s;';
              cancelBtn.onmouseenter = () => { cancelBtn.style.background = '#F1F3F4'; cancelBtn.style.borderColor = '#DADCE0'; };
              cancelBtn.onmouseleave = () => { cancelBtn.style.background = '#fff'; cancelBtn.style.borderColor = '#E8EAED'; };
              cancelBtn.onclick = () => closeModal(null);
              
              const saveBtn2 = document.createElement('button');
              saveBtn2.textContent = '保存 Agent';
              saveBtn2.style.cssText = 
                'padding:10px 24px;font-size:14px;font-weight:600;color:white;' +
                'background:#1A73E8;border:none;border-radius:8px;cursor:pointer;' +
                'transition:all 0.2s;box-shadow:0 2px 8px rgba(26,115,232,0.3);';
              saveBtn2.onmouseenter = () => { saveBtn2.style.opacity = '0.9'; saveBtn2.style.transform = 'translateY(-1px)'; };
              saveBtn2.onmouseleave = () => { saveBtn2.style.opacity = '1'; saveBtn2.style.transform = 'translateY(0)'; };
              saveBtn2.onclick = () => {
                const name = nameInput.value.trim();
                if (!name) {
                  nameInput.style.borderColor = '#EA4335';
                  nameInput.style.boxShadow = '0 0 0 3px rgba(234,67,53,0.1)';
                  nameInput.placeholder = '请输入 Agent 名称';
                  nameInput.focus();
                  return;
                }
                
                closeModal({
                  metadata: {
                    id: idInput.value.trim() || defaultId,
                    name: name,
                    description: descInput2.value.trim(),
                    icon: selectedIcon.icon,
                    color: selectedColor.value,
                    colorEnd: selectedColor.end
                  },
                  sites: [{
                    domain: domain,
                    pages: [{
                      path: pagePath,
                      coordinates: coordinates.map((c, idx) => ({
                        name: c.name || ('coord_' + (idx + 1)),
                        docX: c.docX ?? 0,
                        docY: c.docY ?? 0,
                        viewportX: c.viewportX ?? 0,
                        viewportY: c.viewportY ?? 0,
                        scrollX: c.scrollX ?? 0,
                        scrollY: c.scrollY ?? 0,
                        viewportWidth: c.viewportWidth ?? 0,
                        viewportHeight: c.viewportHeight ?? 0,
                        description: c.description || '',
                        screenshot: c.screenshotPath || null
                      }))
                    }]
                  }],
                  knowledge: personalityInput.value.trim()
                });
              };
              
              footer.appendChild(cancelBtn);
              footer.appendChild(saveBtn2);
              
              modal.appendChild(header);
              modal.appendChild(body);
              modal.appendChild(footer);
              overlay.appendChild(modal);
              document.body.appendChild(overlay);
              
              requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                modal.style.transform = 'scale(1)';
              });
              
              const escHandler = (e) => {
                if (e.key === 'Escape') {
                  document.removeEventListener('keydown', escHandler);
                  closeModal(null);
                }
              };
              document.addEventListener('keydown', escHandler);
              
              overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                  closeModal(null);
                }
              });
              
            });
          }
          
          // 展开箭头
          const expandArrow = document.createElement('div');
          expandArrow.id = '__agent_editor_expand_arrow__';
          expandArrow.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
          expandArrow.style.cssText = 'width:24px;height:24px;display:flex;align-items:center;justify-content:center;transition:transform 0.2s;cursor:pointer;';
          
          panelRight.appendChild(cancelBtn);
          panelRight.appendChild(pauseBtn);
          panelRight.appendChild(saveBtn);
          panelRight.appendChild(expandArrow);
          
          panelHeader.appendChild(panelLeft);
          panelHeader.appendChild(panelRight);
          
          // Panel 2: 可折叠的标注列表
          const coordListPanel = document.createElement('div');
          coordListPanel.id = '__agent_editor_list_panel__';
          coordListPanel.style.cssText = 
            'max-height:0;' +
            'overflow:hidden;' +
            'transition:max-height 0.3s ease;' +
            'background:#fafafb;' +
            'border-top:1px solid transparent;';
          
          const coordList = document.createElement('div');
          coordList.id = '__agent_editor_list__';
          // 隐藏滚动条但保留滚动功能
          coordList.style.cssText = 'padding:16px;max-height:320px;overflow-y:scroll;scrollbar-width:none;-ms-overflow-style:none;';
          
          // 添加隐藏滚动条的样式
          const listId = '__agent_editor_list__';
          const scrollbarStyle = document.createElement('style');
          scrollbarStyle.textContent = '#' + listId + '::-webkit-scrollbar { display: none; }';
          document.head.appendChild(scrollbarStyle);
          coordList.innerHTML = 
            '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 20px;color:#9ca3af;">' +
            '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:10px;opacity:0.4;">' +
            '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>' +
            '<span style="font-size:13px;">点击页面添加标注</span>' +
            '</div>';
          
          coordListPanel.appendChild(coordList);
          
          // 拖拽功能
          let isDragging = false;
          let hasDragged = false;
          let dragOffsetX = 0;
          let dragOffsetY = 0;
          let dragStartX = 0;
          let dragStartY = 0;
          
          // 在 header 上按下开始拖拽
          panelHeader.addEventListener('mousedown', (e) => {
            // 如果点击的是按钮或展开箭头，不触发拖拽
            if (e.target.closest('button') || e.target.closest('#__agent_editor_expand_arrow__')) return;
            
            isDragging = true;
            hasDragged = false;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            const rect = historyPanel.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            panelHeader.style.cursor = 'grabbing';
            panelHeader.style.userSelect = 'none';
          });
          
          // 全局鼠标移动
          document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            
            // 检测是否真正移动了（超过 5px 认为是拖拽）
            if (Math.abs(e.clientX - dragStartX) > 5 || Math.abs(e.clientY - dragStartY) > 5) {
              hasDragged = true;
            }
            
            let newX = e.clientX - dragOffsetX;
            let newY = e.clientY - dragOffsetY;
            
            // 限制在视口内
            const rect = historyPanel.getBoundingClientRect();
            const maxX = window.innerWidth - rect.width;
            const maxY = window.innerHeight - rect.height;
            
            newX = Math.max(0, Math.min(newX, maxX));
            newY = Math.max(0, Math.min(newY, maxY));
            
            historyPanel.style.left = newX + 'px';
            historyPanel.style.top = newY + 'px';
          });
          
          // 全局鼠标释放
          document.addEventListener('mouseup', () => {
            if (isDragging) {
              isDragging = false;
              panelHeader.style.cursor = 'grab';
              panelHeader.style.userSelect = '';
            }
          });
          
          // 手风琴展开/收起逻辑
          let isExpanded = false;
          panelHeader.addEventListener('click', (e) => {
            // 如果点击的是按钮或曾经拖拽过，不触发展开
            if (e.target.closest('button') || hasDragged) return;
            
            isExpanded = !isExpanded;
            if (isExpanded) {
              coordListPanel.style.maxHeight = '400px';
              coordListPanel.style.borderTopColor = 'rgba(0,0,0,0.06)';
              expandArrow.style.transform = 'rotate(180deg)';
            } else {
              coordListPanel.style.maxHeight = '0';
              coordListPanel.style.borderTopColor = 'transparent';
              expandArrow.style.transform = 'rotate(0deg)';
            }
          });
          
          // 展开箭头的独立点击事件
          expandArrow.addEventListener('click', (e) => {
            e.stopPropagation();
            isExpanded = !isExpanded;
            if (isExpanded) {
              coordListPanel.style.maxHeight = '400px';
              coordListPanel.style.borderTopColor = 'rgba(0,0,0,0.06)';
              expandArrow.style.transform = 'rotate(180deg)';
            } else {
              coordListPanel.style.maxHeight = '0';
              coordListPanel.style.borderTopColor = 'transparent';
              expandArrow.style.transform = 'rotate(0deg)';
            }
          });
          
          historyPanel.appendChild(panelHeader);
          historyPanel.appendChild(coordListPanel);
          
          // 跟踪滚动位置，让标记点跟随内容
          let scrollX = window.scrollX || 0;
          let scrollY = window.scrollY || 0;
          // 坐标计数从之前保存的坐标数量开始（实现跨页面序号连续）
          let coordCount = window.savedCoordinates.length;
          console.log('[Agent Editor] Starting coordCount from previous:', coordCount);
          
          const updateScroll = () => {
            scrollX = window.scrollX || 0;
            scrollY = window.scrollY || 0;
            // 更新所有标记点的位置
            document.querySelectorAll('.__agent_editor_marker__').forEach(marker => {
              const docX = parseFloat(marker.dataset.docX || 0);
              const docY = parseFloat(marker.dataset.docY || 0);
              marker.style.left = (docX - scrollX) + 'px';
              marker.style.top = (docY - scrollY) + 'px';
            });
          };
          
          window.addEventListener('scroll', updateScroll, { passive: true });
          
          overlay.addEventListener('click', (e) => {
            console.log('[Agent Editor] Click detected at:', e.clientX, e.clientY);
            e.preventDefault();
            e.stopPropagation();
            
            // 检查是否有未完成的标注输入框
            const existingNaming = document.getElementById('__agent_editor_naming__');
            if (existingNaming) {
              console.log('[Agent Editor] Found unfinished annotation, removing previous marker');
              // 删除最后一个红点（未完成的标注）
              const markers = document.querySelectorAll('.__agent_editor_marker__[data-temp="true"]');
              if (markers.length > 0) {
                markers[markers.length - 1].remove();
              }
              // 删除可能存在的 tooltip
              const tooltips = document.querySelectorAll('.__agent_editor_tooltip__');
              if (tooltips.length > 0) {
                tooltips[tooltips.length - 1].remove();
              }
              // 删除输入框
              existingNaming.remove();
              // 注意：临时标记不增加计数，所以也不需要减少
            }
            
            // 记录多种坐标信息
            const viewportWidth = window.innerWidth;           // 视口宽度
            const viewportHeight = window.innerHeight;         // 视口高度
            const viewportX = e.clientX / viewportWidth;       // 视口比例坐标 (0-1)
            const viewportY = e.clientY / viewportHeight;      // 视口比例坐标 (0-1)
            const docX = e.clientX + scrollX;                  // 文档绝对坐标 (像素)
            const docY = e.clientY + scrollY;                  // 文档绝对坐标 (像素)
            
            // 获取点击位置的元素
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const tag = el?.tagName || 'element';
            
            // 尝试获取元素的简单选择器
            let selector = '';
            if (el) {
              if (el.id) {
                selector = '#' + el.id;
              } else if (el.className) {
                const className = el.className.split(' ')[0];
                if (className) selector = '.' + className;
              }
              selector = el.tagName.toLowerCase() + (selector ? selector : '');
            }
            
            // 计算当前是第几个标注
            let markerNumber = 1;
            try {
              markerNumber = (window.savedCoordinates?.length || 0) + 1;
            } catch(e) {}
            
            // 同时检查页面上已确认的标记数量
            const confirmedMarkers = document.querySelectorAll('.__agent_editor_marker__:not([data-temp="true"])').length;
            if (confirmedMarkers + 1 > markerNumber) {
              markerNumber = confirmedMarkers + 1;
            }
            
            // 创建带序号的红点标记（fixed 定位，但基于文档坐标）
            const marker = document.createElement('div');
            marker.className = '__agent_editor_marker__';
            marker.dataset.docX = docX;
            marker.dataset.docY = docY;
            marker.dataset.temp = 'true'; // 标记为临时，等待命名
            marker.dataset.number = markerNumber; // 序号
            marker.textContent = markerNumber; // 显示序号
            marker.style.cssText = 
              'position:fixed;' +
              'left:' + (docX - scrollX) + 'px;' +
              'top:' + (docY - scrollY) + 'px;' +
              'width:28px;' +
              'height:28px;' +
              'background:#E94560;' +
              'border:2px solid white;' +
              'border-radius:50%;' +
              'transform:translate(-50%,-50%);' +
              'z-index:2147483648;' +
              'box-shadow:0 2px 10px rgba(233,69,96,0.6);' +
              'cursor:pointer;' +
              'pointer-events:auto;' +
              'display:flex;' +
              'align-items:center;' +
              'justify-content:center;' +
              'color:white;' +
              'font-size:12px;' +
              'font-weight:700;' +
              'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
            document.body.appendChild(marker);
            // 注意：coordCount 只在确认添加时增加，临时标记不增加计数
            
            console.log('[Agent Editor] Red marker created at doc:', docX, docY, 'tag:', tag, 'selector:', selector);
            
            window.postMessage({
              type: 'AGENT_EDITOR_CLICK',
              viewportX: viewportX,      // 视口比例坐标 (0-1)
              viewportY: viewportY,      // 视口比例坐标 (0-1)
              docX: docX,                // 文档绝对 X (像素)
              docY: docY,                // 文档绝对 Y (像素)
              scrollX: scrollX,          // 滚动位置 X
              scrollY: scrollY,          // 滚动位置 Y
              viewportWidth: viewportWidth,   // 视口宽度
              viewportHeight: viewportHeight, // 视口高度
              tag: tag,                  // 元素标签
              selector: selector,        // CSS 选择器
              url: location.href         // 页面 URL
            }, '*');
            console.log('[Siliu Overlay] Message posted with full coordinate data');
          });
          
          if (document.body) {
            document.body.appendChild(overlay);
            document.body.appendChild(historyPanel);
            console.log('[Agent Editor] Overlay and history panel appended to body');
          } else {
            console.log('[Agent Editor] Body not ready, waiting...');
            setTimeout(() => {
              if (document.body) {
                document.body.appendChild(overlay);
                document.body.appendChild(historyPanel);
                console.log('[Agent Editor] Appended to body (delayed)');
              }
            }, 100);
          }
          return 'injected';
        })()
      `;
      
      console.log('[Agent Editor] Executing script...');
      const result = await view.webContents.executeJavaScript(script, true);
      console.log('[Agent Editor] Inject result:', result);
      
      // 记录该视图处于 Agent Editor 激活状态
      if (result === 'injected' || result === 'already-exists') {
        agentEditorActiveViews.add(viewId);
        console.log('[Agent Editor] View marked as active:', viewId);
      }
      
      return { success: true, result };
    } catch (err) {
      console.error('[Agent Editor] Inject failed:', err);
      return { success: false, error: err.message };
    }
  });
  
  safeHandle('agentEditor:syncData', async (event, viewId, coordinates, isPaused) => {
    try {
      // 保存坐标数据到主进程内存
      agentEditorData.set(viewId, coordinates);
      // 记录这是最后操作的标签页
      lastActiveAgentEditorView = viewId;
      console.log('[Agent Editor] Last active view updated:', viewId);
      // 如果传入了暂存状态，也保存
      if (isPaused !== undefined) {
        agentEditorPausedState.set(viewId, isPaused);
        console.log('[Agent Editor] Coordinates and pause state synced for', viewId, ':', coordinates.length, 'coords, paused:', isPaused);
      } else {
        console.log('[Agent Editor] Coordinates synced for', viewId, ':', coordinates.length, 'coords');
      }
      return { success: true };
    } catch (err) {
      console.error('[Agent Editor] Failed to sync coordinates:', err);
      return { success: false, error: err.message };
    }
  });
  
  // 更新 Agent Editor 的数据（不重新注入，只更新 savedCoordinates）
  safeHandle('agentEditor:updateData', async (event, viewId, coordinates) => {
    try {
      const view = modules.core?.tabManager?.getView?.(viewId);
      if (!view) {
        return { success: false, error: 'View not found' };
      }
      
      // 通过 executeJavaScript 更新页面内的 savedCoordinates
      const script = `
        (function() {
          // 更新全局的 savedCoordinates 变量
          if (typeof window.savedCoordinates !== 'undefined') {
            window.savedCoordinates = ${JSON.stringify(coordinates || [])};
            console.log('[Agent Editor] savedCoordinates updated:', window.savedCoordinates.length);
            return { success: true, count: window.savedCoordinates.length };
          }
          return { success: false, error: 'savedCoordinates not found' };
        })()
      `;
      
      const result = await view.webContents.executeJavaScript(script, true);
      console.log('[Agent Editor] Data update result:', result);
      return result;
    } catch (err) {
      console.error('[Agent Editor] Failed to update data:', err);
      return { success: false, error: err.message };
    }
  });
  
  safeHandle('agentEditor:remove', async (event, viewId) => {
    try {
      const view = modules.core?.tabManager?.getView?.(viewId);
      if (!view) {
        return { success: false, error: 'View not found' };
      }
      
      const script = `
        (function() {
          const overlay = document.getElementById('__agent_editor_overlay__');
          const historyPanel = document.getElementById('__agent_editor_panel__');
          const coordListPanel = document.getElementById('__agent_editor_list_panel__');
          const namingModal = document.getElementById('__agent_editor_naming__');
          let result = '';
          if (overlay) {
            overlay.remove();
            result += 'overlay-removed ';
          }
          if (historyPanel) {
            historyPanel.remove();
            result += 'history-removed ';
          }
          if (coordListPanel) {
            coordListPanel.remove();
            result += 'coordlist-removed ';
          }
          if (namingModal) {
            namingModal.remove();
            result += 'naming-removed ';
          }
          // 同时移除所有红点标记
          const markers = document.querySelectorAll('.__agent_editor_marker__');
          markers.forEach(m => m.remove());
          if (markers.length > 0) {
            result += 'markers-' + markers.length + ' ';
          }
          // 同时移除所有 tooltip
          const tooltips = document.querySelectorAll('.__agent_editor_tooltip__');
          tooltips.forEach(t => t.remove());
          if (tooltips.length > 0) {
            result += 'tooltips-' + tooltips.length + ' ';
          }
          return result || 'not-found';
        })()
      `;
      
      const result = await view.webContents.executeJavaScript(script);
      
      // 从激活状态集合中移除该视图
      agentEditorActiveViews.delete(viewId);
      agentEditorData.delete(viewId);
      agentEditorPausedState.delete(viewId); // 清除暂存状态
      console.log('[Agent Editor] View removed from active set:', viewId);
      
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Agent Editor 确认弹窗（注入到 BrowserView 中显示，避免被遮挡）
  safeHandle('agentEditor:showConfirm', async (event, viewId, message, title) => {
    try {
      const view = modules.core?.tabManager?.getView?.(viewId);
      if (!view) {
        console.log('[Agent Editor] showConfirm: View not found:', viewId);
        return false;
      }
      
      const script = `
        (function() {
          return new Promise((resolve) => {
            // 移除已存在的弹窗
            const existing = document.getElementById('__agent_editor_confirm_modal__');
            if (existing) existing.remove();
            
            // 创建遮罩
            const overlay = document.createElement('div');
            overlay.id = '__agent_editor_confirm_modal__';
            overlay.style.cssText = 
              'position:fixed;top:0;left:0;right:0;bottom:0;' +
              'background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);' +
              'display:flex;align-items:center;justify-content:center;' +
              'z-index:2147483650;opacity:0;transition:opacity 0.2s;';
            
            // 创建弹窗
            const modal = document.createElement('div');
            modal.style.cssText = 
              'background:white;border-radius:12px;width:400px;max-width:90vw;' +
              'box-shadow:0 20px 60px rgba(0,0,0,0.2);overflow:hidden;' +
              'transform:scale(0.95);transition:transform 0.2s;';
            
            // 头部
            const header = document.createElement('div');
            header.style.cssText = 'padding:16px 20px;border-bottom:1px solid #e5e7eb;';
            header.innerHTML = '<h3 style="margin:0;font-size:16px;font-weight:600;color:#111827;">' + ${JSON.stringify(title)} + '</h3>';
            
            // 内容
            const body = document.createElement('div');
            body.style.cssText = 'padding:20px;';
            body.innerHTML = '<p style="margin:0;font-size:14px;color:#4b5563;line-height:1.5;">' + ${JSON.stringify(message)} + '</p>';
            
            // 按钮区域
            const footer = document.createElement('div');
            footer.style.cssText = 'padding:12px 20px 16px;display:flex;justify-content:flex-end;gap:8px;';
            
            // 关闭弹窗的函数
            const closeModal = (result) => {
              overlay.style.opacity = '0';
              modal.style.transform = 'scale(0.95)';
              setTimeout(() => {
                overlay.remove();
                resolve(result);
              }, 200);
            };
            
            // 取消按钮
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = '取消';
            cancelBtn.style.cssText = 
              'padding:8px 16px;font-size:13px;font-weight:500;color:#6b7280;' +
              'background:transparent;border:none;border-radius:6px;cursor:pointer;' +
              'transition:all 0.15s;';
            cancelBtn.onmouseenter = () => cancelBtn.style.background = '#f3f4f6';
            cancelBtn.onmouseleave = () => cancelBtn.style.background = 'transparent';
            cancelBtn.onclick = () => closeModal(false);
            
            // 确认按钮
            const confirmBtn = document.createElement('button');
            confirmBtn.textContent = '确定';
            confirmBtn.style.cssText = 
              'padding:8px 16px;font-size:13px;font-weight:500;color:white;' +
              'background:#dc2626;border:none;border-radius:6px;cursor:pointer;' +
              'transition:all 0.15s;';
            confirmBtn.onmouseenter = () => confirmBtn.style.background = '#b91c1c';
            confirmBtn.onmouseleave = () => confirmBtn.style.background = '#dc2626';
            confirmBtn.onclick = () => closeModal(true);
            
            footer.appendChild(cancelBtn);
            footer.appendChild(confirmBtn);
            modal.appendChild(header);
            modal.appendChild(body);
            modal.appendChild(footer);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            
            // 动画显示
            requestAnimationFrame(() => {
              overlay.style.opacity = '1';
              modal.style.transform = 'scale(1)';
            });
            
            // ESC 取消
            const escHandler = (e) => {
              if (e.key === 'Escape') {
                document.removeEventListener('keydown', escHandler);
                closeModal(false);
              }
            };
            document.addEventListener('keydown', escHandler);
            
            // 点击遮罩关闭
            overlay.addEventListener('click', (e) => {
              if (e.target === overlay) {
                closeModal(false);
              }
            });
          });
        })()
      `;
      
      console.log('[Agent Editor] Showing confirm dialog in view:', viewId);
      const result = await view.webContents.executeJavaScript(script, true);
      console.log('[Agent Editor] Confirm result:', result);
      return result === true;
    } catch (err) {
      console.error('[Agent Editor] showConfirm error:', err);
      return false;
    }
  });

  // 确认弹窗（使用原生 dialog，避免 BrowserView 层级问题）
  safeHandle('dialog:confirm', async (event, message, title) => {
    try {
      const win = modules.core?.windowManager?.getWindow?.();
      if (!win) return false;
      
      const result = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['取消', '确定'],
        defaultId: 1,
        cancelId: 0,
        title: title || '确认',
        message: message || '确定要执行此操作吗？',
        icon: undefined
      });
      
      return result.response === 1;
    } catch (err) {
      console.error('[Dialog] Error showing confirm dialog:', err);
      return false;
    }
  });

  // Agent Editor: 保存 Agent 弹窗（注入到 BrowserView）
  safeHandle('agentEditor:showSaveDialog', async (event, viewId, coordinates, domain, url) => {
    try {
      const view = modules.core?.tabManager?.getView?.(viewId);
      if (!view) {
        console.log('[Agent Editor] showSaveDialog: View not found:', viewId);
        return { success: false, error: 'View not found' };
      }
      
      // 【关键】收集所有标签页的坐标数据（支持多网站多页面）
      const allCoordinates = [];
      for (const [vid, coords] of agentEditorData.entries()) {
        if (Array.isArray(coords)) {
          allCoordinates.push(...coords);
        }
      }
      console.log('[Agent Editor] Collecting coordinates from all tabs:', allCoordinates.length, 'total');
      
      // 生成 10 位随机码: agent-xxxxxxxxxx (只含小写和数字)
      const generateRandomId = () => {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        const arr = new Uint8Array(10);
        crypto.getRandomValues(arr);
        return 'agent-' + Array.from(arr, b => chars[b % 36]).join('');
      };
      const defaultId = generateRandomId();
      const pagePath = new URL(url || 'http://' + domain).pathname;
      
      const script = `
        (function() {
          return new Promise((resolve) => {
            // 移除已存在的弹窗
            const existing = document.getElementById('__agent_editor_save_modal__');
            if (existing) existing.remove();
            
            // 图标选项（Phosphor 图标名称）
            const icons = [
              { name: '机器人', icon: 'robot' },
              { name: '导航', icon: 'magnifying-glass' },
              { name: '购物', icon: 'shopping-cart' },
              { name: '搜索', icon: 'magnifying-glass' },
              { name: '数据', icon: 'chart-bar' },
              { name: '文档', icon: 'file-text' },
              { name: '娱乐', icon: 'game-controller' },
              { name: '社交', icon: 'users' },
              { name: '工具', icon: 'wrench' },
              { name: '星标', icon: 'star' }
            ];
            
            // 颜色选项
            const colors = [
              { name: '蓝色', value: '#1A73E8', end: '#4285F4' },
              { name: '红色', value: '#DC2626', end: '#EF4444' },
              { name: '绿色', value: '#059669', end: '#10B981' },
              { name: '紫色', value: '#7C3AED', end: '#8B5CF6' },
              { name: '橙色', value: '#EA580C', end: '#F97316' },
              { name: '粉色', value: '#DB2777', end: '#EC4899' },
              { name: '青色', value: '#0891B2', end: '#06B6D4' },
              { name: '深灰', value: '#374151', end: '#4B5563' }
            ];
            
            // 创建遮罩
            const overlay = document.createElement('div');
            overlay.id = '__agent_editor_save_modal__';
            overlay.style.cssText = 
              'position:fixed;top:0;left:0;right:0;bottom:0;' +
              'background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);' +
              'display:flex;align-items:center;justify-content:center;' +
              'z-index:2147483650;opacity:0;transition:opacity 0.2s;' +
              'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
            
            // 创建弹窗
            const modal = document.createElement('div');
            modal.style.cssText = 
              'background:white;border-radius:16px;width:480px;max-width:90vw;' +
              'max-height:85vh;overflow-y:auto;' +
              'box-shadow:0 25px 80px rgba(0,0,0,0.25);' +
              'transform:scale(0.95);transition:transform 0.2s;';
            
            // 头部
            const header = document.createElement('div');
            header.style.cssText = 'padding:20px 24px;border-bottom:1px solid #e5e7eb;position:sticky;top:0;background:white;z-index:1;';
            header.innerHTML = '<h3 style="margin:0;font-size:18px;font-weight:600;color:#111827;">保存为 Agent</h3>';
            
            // 内容区域
            const body = document.createElement('div');
            body.style.cssText = 'padding:20px 24px;';
            
            // 坐标数量提示
            const coordCount = ${allCoordinates.length};
            const coordHint = document.createElement('div');
            coordHint.style.cssText = 'background:#f3f4f6;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#6b7280;';
            coordHint.innerHTML = '<span style="font-weight:600;color:#111827;">当前页面:</span> ' + ${JSON.stringify(domain)} + ' <span style="margin:0 8px;">·</span> <span style="font-weight:600;color:#059669;">已标注 ' + coordCount + ' 个坐标</span>';
            body.appendChild(coordHint);
            
            // 表单字段样式
            const fieldStyle = 'margin-bottom:16px;';
            const labelStyle = 'display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:6px;';
            const inputStyle = 'width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;outline:none;transition:all 0.15s;box-sizing:border-box;';
            const textareaStyle = inputStyle + 'min-height:80px;resize:vertical;';
            
            // 1. Agent 名称
            const nameField = document.createElement('div');
            nameField.style.cssText = fieldStyle;
            nameField.innerHTML = '<label style="' + labelStyle + '">Agent 名称 *</label>';
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.id = '__agent_save_name__';
            nameInput.placeholder = '例如: 淘宝搜索助手';
            nameInput.style.cssText = inputStyle;
            nameInput.style.cssText += ':focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }';
            nameField.appendChild(nameInput);
            body.appendChild(nameField);
            
            // 2. Agent ID
            const idField = document.createElement('div');
            idField.style.cssText = fieldStyle;
            idField.innerHTML = '<label style="' + labelStyle + '">Agent ID <span style="font-weight:400;color:#9ca3af;">(用于唯一标识)</span></label>';
            const idInput = document.createElement('input');
            idInput.type = 'text';
            idInput.id = '__agent_save_id__';
            idInput.value = ${JSON.stringify(defaultId)};
            idInput.readOnly = true;
            idInput.style.cssText = inputStyle + 'font-family:monospace;background:#f3f4f6;color:#6b7280;cursor:not-allowed;';
            idField.appendChild(idInput);
            body.appendChild(idField);
            
            // 3. 描述
            const descField = document.createElement('div');
            descField.style.cssText = fieldStyle;
            descField.innerHTML = '<label style="' + labelStyle + '">用途描述</label>';
            const descInput = document.createElement('textarea');
            descInput.id = '__agent_save_desc__';
            descInput.placeholder = '描述这个 Agent 的主要用途和能力...';
            descInput.style.cssText = textareaStyle;
            descField.appendChild(descInput);
            body.appendChild(descField);
            
            // 4. 图标选择
            const iconField = document.createElement('div');
            iconField.style.cssText = fieldStyle;
            iconField.innerHTML = '<label style="' + labelStyle + '">图标</label>';
            const iconGrid = document.createElement('div');
            iconGrid.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:8px;';
            let selectedIcon = icons[0];
            icons.forEach((item, idx) => {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.style.cssText = 
                'aspect-ratio:1;border:2px solid ' + (idx === 0 ? '#3b82f6' : '#e5e7eb') + ';border-radius:8px;' +
                'background:' + (idx === 0 ? '#eff6ff' : 'white') + ';cursor:pointer;font-size:24px;' +
                'transition:all 0.15s;';
              btn.textContent = item.icon;
              btn.title = item.name;
              btn.onclick = () => {
                selectedIcon = item;
                iconGrid.querySelectorAll('button').forEach((b, i) => {
                  b.style.borderColor = i === idx ? '#3b82f6' : '#e5e7eb';
                  b.style.background = i === idx ? '#eff6ff' : 'white';
                });
              };
              iconGrid.appendChild(btn);
            });
            iconField.appendChild(iconGrid);
            body.appendChild(iconField);
            
            // 5. 颜色选择
            const colorField = document.createElement('div');
            colorField.style.cssText = fieldStyle;
            colorField.innerHTML = '<label style="' + labelStyle + '">主题颜色</label>';
            const colorGrid = document.createElement('div');
            colorGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;';
            let selectedColor = colors[0];
            colors.forEach((item, idx) => {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.style.cssText = 
                'width:40px;height:40px;border-radius:50%;border:3px solid ' + (idx === 0 ? '#111827' : 'transparent') + ';' +
                'background:linear-gradient(135deg,' + item.value + ',' + item.end + ');cursor:pointer;' +
                'transition:all 0.15s;box-shadow:0 2px 8px ' + item.value + '40;';
              btn.title = item.name;
              btn.onclick = () => {
                selectedColor = item;
                colorGrid.querySelectorAll('button').forEach((b, i) => {
                  b.style.borderColor = i === idx ? '#111827' : 'transparent';
                });
              };
              colorGrid.appendChild(btn);
            });
            colorField.appendChild(colorGrid);
            body.appendChild(colorField);
            
            // 6. 性格能力
            const personalityField = document.createElement('div');
            personalityField.style.cssText = fieldStyle;
            personalityField.innerHTML = '<label style="' + labelStyle + '">性格与能力</label>';
            const personalityInput = document.createElement('textarea');
            personalityInput.id = '__agent_save_personality__';
            personalityInput.placeholder = '描述这个 Agent 的性格特点、专长领域、工作方式等...&#92;n&#92;n例如:&#92;n- 擅长网页数据采集&#92;n- 熟悉淘宝搜索和购物流程&#92;n- 操作细心且高效';
            personalityInput.style.cssText = textareaStyle;
            personalityField.appendChild(personalityInput);
            body.appendChild(personalityField);
            
            // 底部按钮
            const footer = document.createElement('div');
            footer.style.cssText = 'padding:16px 24px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:12px;position:sticky;bottom:0;background:white;';
            
            // 关闭函数
            const closeModal = (result) => {
              overlay.style.opacity = '0';
              modal.style.transform = 'scale(0.95)';
              setTimeout(() => {
                overlay.remove();
                resolve(result);
              }, 200);
            };
            
            // 取消按钮
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = '取消';
            cancelBtn.style.cssText = 
              'padding:10px 20px;font-size:14px;font-weight:500;color:#6b7280;' +
              'background:transparent;border:none;border-radius:8px;cursor:pointer;' +
              'transition:all 0.15s;';
            cancelBtn.onmouseenter = () => cancelBtn.style.background = '#f3f4f6';
            cancelBtn.onmouseleave = () => cancelBtn.style.background = 'transparent';
            cancelBtn.onclick = () => closeModal(null);
            
            // 保存按钮
            const saveBtn = document.createElement('button');
            saveBtn.textContent = '保存 Agent';
            saveBtn.style.cssText = 
              'padding:10px 24px;font-size:14px;font-weight:600;color:white;' +
              'background:linear-gradient(135deg,#1A73E8,#4285F4);border:none;border-radius:8px;cursor:pointer;' +
              'transition:all 0.15s;box-shadow:0 4px 12px rgba(26,115,232,0.3);';
            saveBtn.onmouseenter = () => saveBtn.style.opacity = '0.9';
            saveBtn.onmouseleave = () => saveBtn.style.opacity = '1';
            saveBtn.onclick = () => {
              const name = nameInput.value.trim();
              if (!name) {
                nameInput.style.borderColor = '#dc2626';
                nameInput.style.boxShadow = '0 0 0 3px rgba(220,38,38,0.1)';
                nameInput.placeholder = '请输入 Agent 名称';
                nameInput.focus();
                return;
              }
              
              const agentId = idInput.value.trim() || ${JSON.stringify(defaultId)};
              
              // 从坐标数据自动提取域名和路径分组
              const coordsByDomain = {};
              ${JSON.stringify(allCoordinates)}.forEach(c => {
                try {
                  const url = new URL(c.url || 'http://' + ${JSON.stringify(domain)});
                  const domainKey = url.hostname;
                  const pathKey = url.pathname;
                  if (!coordsByDomain[domainKey]) {
                    coordsByDomain[domainKey] = {};
                  }
                  if (!coordsByDomain[domainKey][pathKey]) {
                    coordsByDomain[domainKey][pathKey] = [];
                  }
                  coordsByDomain[domainKey][pathKey].push(c);
                } catch (e) {
                  // 如果 URL 解析失败，使用默认域名
                  const defaultDomain = ${JSON.stringify(domain)};
                  if (!coordsByDomain[defaultDomain]) {
                    coordsByDomain[defaultDomain] = {};
                  }
                  const defaultPath = '/'
                  if (!coordsByDomain[defaultDomain][defaultPath]) {
                    coordsByDomain[defaultDomain][defaultPath] = [];
                  }
                  coordsByDomain[defaultDomain][defaultPath].push(c);
                }
              });
              
              // 构建 sites 结构
              const sites = Object.entries(coordsByDomain).map(([domain, paths]) => ({
                domain: domain,
                pages: Object.entries(paths).map(([path, coords]) => ({
                  match: path,
                  coordinates: coords.map((c, idx) => ({
                    name: c.name || ('coord_' + (idx + 1)),
                    url: c.url,  // 保留原始 URL，供 AI 匹配使用
                    docX: c.docX ?? 0,
                    docY: c.docY ?? 0,
                    viewportX: c.viewportX ?? 0,
                    viewportY: c.viewportY ?? 0,
                    scrollX: c.scrollX ?? 0,
                    scrollY: c.scrollY ?? 0,
                    viewportWidth: c.viewportWidth ?? 0,
                    viewportHeight: c.viewportHeight ?? 0,
                    description: c.description || '',
                    tag: c.tag || '',
                    screenshot: c.screenshotPath || null
                  }))
                }))
              }));
              
              closeModal({
                metadata: {
                  id: agentId,
                  name: name,
                  description: descInput.value.trim(),
                  icon: selectedIcon.icon,
                  color: selectedColor.value,
                  colorEnd: selectedColor.end
                },
                sites: sites,
                knowledge: personalityInput.value.trim()
              });
            };
            
            footer.appendChild(cancelBtn);
            footer.appendChild(saveBtn);
            
            modal.appendChild(header);
            modal.appendChild(body);
            modal.appendChild(footer);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            
            // 动画显示
            requestAnimationFrame(() => {
              overlay.style.opacity = '1';
              modal.style.transform = 'scale(1)';
            });
            
            // ESC 关闭
            const escHandler = (e) => {
              if (e.key === 'Escape') {
                document.removeEventListener('keydown', escHandler);
                closeModal(null);
              }
            };
            document.addEventListener('keydown', escHandler);
            
            // 点击遮罩关闭
            overlay.addEventListener('click', (e) => {
              if (e.target === overlay) {
                closeModal(null);
              }
            });
          });
        })()
      `;
      
      console.log('[Agent Editor] Showing save dialog in view:', viewId);
      const result = await view.webContents.executeJavaScript(script, true);
      console.log('[Agent Editor] Save dialog result:', result);
      
      if (result && result.metadata) {
        // 保存 Agent
        if (modules.agentLoader) {
          const saveResult = await modules.agentLoader.saveAgent(result);
          console.log('[Agent Editor] Agent saved:', saveResult);
          return saveResult;
        } else {
          return { success: false, error: 'Agent loader not initialized' };
        }
      }
      
      return { success: false, cancelled: true };
    } catch (err) {
      console.error('[Agent Editor] showSaveDialog error:', err);
      return { success: false, error: err.message };
    }
  });

  safeHandle('siliu:executeScript', async (event, code) => {
    try {
      const viewId = modules.controller.getActiveViewId?.();
      if (!viewId) {
        return { success: false, error: 'No active view' };
      }
      const view = modules.core?.tabManager?.getView?.(viewId);
      if (!view) {
        return { success: false, error: 'View not found' };
      }
      const result = await view.webContents.executeJavaScript(code, true);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err.message };
    }
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

  // ========== 【新增】Configurable Agent IPC 接口 ==========
  const { registry } = require('./copilot/agents/agent-registry');

  // 获取所有用户自定义 Agent（YAML 配置）
  safeHandle('agents:listUserAgents', () => {
    return modules.agentLoader?.getUserAgents() || [];
  });

  // 获取所有 ConfigurableAgent（包括内置的）
  safeHandle('agents:listConfigurable', () => {
    return registry.getConfigurableAgents();
  });

  // 获取所有 Agent（包括内置和自定义）
  safeHandle('agents:listAll', () => {
    return registry.getAllAgents();
  });

  // 保存 Agent 配置
  safeHandle('agents:save', async (event, config) => {
    if (!modules.agentLoader) {
      return { success: false, error: 'Agent loader not initialized' };
    }
    return await modules.agentLoader.saveAgent(config);
  });

  // 删除 Agent 配置
  safeHandle('agents:delete', async (event, agentId) => {
    if (!modules.agentLoader) {
      return { success: false, error: 'Agent loader not initialized' };
    }
    const result = await modules.agentLoader.deleteAgent(agentId);
    if (result.success) {
      // 删除成功后刷新列表
      modules.core?.sendToRenderer?.('agents:reload', {});
    }
    return result;
  });

  // 获取 Agent 配置内容（YAML）
  safeHandle('agents:getConfig', async (event, agentId) => {
    if (!modules.agentLoader) {
      return { success: false, error: 'Agent loader not initialized' };
    }
    return await modules.agentLoader.getAgentConfig(agentId);
  });

  // 检查是否为内置 Agent
  safeHandle('agents:isBuiltIn', (event, agentId) => {
    return registry.isBuiltInAgent(agentId);
  });

  // 手动刷新 Agent 列表（热加载备选）
  safeHandle('agents:refresh', async () => {
    if (!modules.agentLoader) {
      return { success: false, error: 'Agent loader not initialized' };
    }
    const result = await modules.agentLoader.refresh();
    if (result.success) {
      // 通知前端刷新列表
      modules.core?.sendToRenderer?.('agents:reload', {});
    }
    return result;
  });

  // 打开 Agent 编辑器窗口（预留，暂时返回不可用）
  safeHandle('agents:openEditor', () => {
    return { success: false, error: 'Agent 编辑器即将推出，敬请期待' };
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
    // 停止文件管理器轮询循环（防止后台进程持续运行）
    modules.core?.tabManager?.fileManager?.stop();
    modules.copilot?.deactivateAll();
    modules.adblock?.deactivate();
    modules.aiService?.disconnect();
    app.quit();
  }
});

// 应用退出前停止所有轮询循环（双重保障）
app.on('before-quit', () => {
  console.log('[Siliu] Stopping all polling loops before quit...');
  modules.core?.tabManager?.fileManager?.stop();
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
