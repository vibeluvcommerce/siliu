/**
 * IPC Handlers - IPC 处理器集中管理
 * 
 * 职责：注册核心浏览器相关的 IPC 处理器
 * 不包含：config、AI、controller 等应用级 IPC（在 app.js 中处理）
 */

const { ipcMain } = require('electron');

class IPCHandlers {
  constructor(options = {}) {
    this.core = options.core;
    this.tabManager = options.tabManager;
    this.windowManager = options.windowManager;
    this.detachedWindows = options.detachedWindows;
    this.configManager = options.configManager;  // 添加 configManager
    this.getCopilot = options.getCopilot;
    this.getAIService = options.getAIService;
    
    this._ipcSetupDone = false;
  }

  /**
   * 设置所有 IPC 处理器
   */
  setup() {
    console.log('[IPC] Setup called, _ipcSetupDone:', this._ipcSetupDone);
    if (this._ipcSetupDone) {
      console.log('[IPC] Setup already done, skipping');
      return;
    }
    this._ipcSetupDone = true;

    this._setupNavigationHandlers();
    this._setupTabHandlers();
    this._setupWindowHandlers();
    this._setupFileManagerHandlers();
    this._setupCopilotHandlers();
    this._setupOpenclawHandlers();
    this._setupShellContextMenu();
    this._setupFileChooserHandlers();
    this._setupAgentHandlers();
  }

  // ========== 导航控制 ==========
  _setupNavigationHandlers() {
    ipcMain.handle('view:navigate', (e, { viewId, url }) => {
      const tabManager = this._getTabManagerForSender(e.sender);
      const viewData = tabManager.getViewData(viewId);
      if (viewData?.view) {
        viewData.view.webContents.loadURL(url);
        return { success: true };
      }
      return { success: false, error: 'View not found' };
    });

    ipcMain.handle('view:goBack', (e, { viewId }) => {
      const tabManager = this._getTabManagerForSender(e.sender);
      const viewData = tabManager.getViewData(viewId);
      if (viewData?.view?.webContents?.canGoBack()) {
        viewData.view.webContents.goBack();
        return { success: true };
      }
      return { success: false, error: 'Cannot go back' };
    });

    ipcMain.handle('view:goForward', (e, { viewId }) => {
      const tabManager = this._getTabManagerForSender(e.sender);
      const viewData = tabManager.getViewData(viewId);
      if (viewData?.view?.webContents?.canGoForward()) {
        viewData.view.webContents.goForward();
        return { success: true };
      }
      return { success: false, error: 'Cannot go forward' };
    });

    ipcMain.handle('view:reload', (e, { viewId }) => {
      const tabManager = this._getTabManagerForSender(e.sender);
      const viewData = tabManager.getViewData(viewId);
      if (viewData?.view) {
        viewData.view.webContents.reload();
        return { success: true };
      }
      return { success: false, error: 'View not found' };
    });
  }

  // ========== 标签页管理 ==========
  _setupTabHandlers() {
    ipcMain.handle('view:create', (e, { url, sidebarOpen }) => {
      const tabManager = this._getTabManagerForSender(e.sender);
      const sidebarState = sidebarOpen !== undefined ? sidebarOpen : tabManager.sidebarOpen;
      const viewId = tabManager.createView(url, sidebarState);
      return { success: true, viewId };
    });

    ipcMain.handle('view:close', (e, { viewId }) => {
      const tabManager = this._getTabManagerForSender(e.sender);
      tabManager.closeView(viewId);
      return { success: true };
    });

    // 关闭当前视图（由视图自身调用）
    ipcMain.on('view:closeCurrent', (e) => {
      const senderId = e.sender.id;
      const tabManager = this._getTabManagerForSender(e.sender);
      
      // 查找 sender 对应的 viewId
      const views = tabManager.getAllViews();
      const view = views.find(v => v.view?.webContents?.id === senderId);
      
      if (view) {
        console.log('[IPC] Closing current view:', view.id);
        tabManager.closeView(view.id);
      } else {
        console.warn('[IPC] Could not find view for sender:', senderId);
      }
    });

    ipcMain.handle('view:setActive', (e, { viewId, sidebarOpen }) => {
      const tabManager = this._getTabManagerForSender(e.sender);
      const sidebarState = sidebarOpen !== undefined ? sidebarOpen : tabManager.sidebarOpen;
      tabManager.setActiveView(viewId, sidebarState);
      return { success: true };
    });

    ipcMain.handle('view:getList', (e) => {
      const tabManager = this._getTabManagerForSender(e.sender);
      return tabManager.getViews();
    });

    ipcMain.handle('view:getActive', (e) => {
      const tabManager = this._getTabManagerForSender(e.sender);
      const viewId = tabManager.getActiveViewId();
      const viewData = tabManager.getViewData(viewId);
      return {
        id: viewId,
        url: viewData?.view?.webContents?.getURL() || '',
        canGoBack: viewData?.view?.webContents?.canGoBack() || false,
        canGoForward: viewData?.view?.webContents?.canGoForward() || false,
        isLoading: viewData?.view?.webContents?.isLoading() || false
      };
    });

    ipcMain.handle('view:mute', (e, { viewId }) => {
      const tabManager = this._getTabManagerForSender(e.sender);
      const viewData = tabManager.getViewData(viewId);
      if (viewData?.view?.webContents) {
        const isMuted = viewData.view.webContents.audioMuted;
        viewData.view.webContents.audioMuted = !isMuted;
        return { success: true, muted: !isMuted };
      }
      return { success: false, error: 'View not found' };
    });

    ipcMain.handle('tab:reorder', (e, { newOrder }) => {
      const tabManager = this._getTabManagerForSender(e.sender);
      tabManager.reorderViews(newOrder);
      return { success: true };
    });

    ipcMain.handle('view:detach', async (e, { viewId, url }) => {
      const result = await this.core.createNewWindow(url);
      // 只返回可序列化的数据，不要返回 window 对象
      return { success: true, windowId: result.windowId };
    });
  }

  // ========== 窗口控制 ==========
  _setupWindowHandlers() {
    ipcMain.handle('window:minimize', (e) => {
      const windowManager = this._getWindowManagerForSender(e.sender);
      const win = windowManager.getWindow ? windowManager.getWindow() : windowManager;
      if (win) {
        win.minimize();
        return { success: true };
      }
      return { success: false };
    });

    ipcMain.handle('window:maximize', (e) => {
      const windowManager = this._getWindowManagerForSender(e.sender);
      const win = windowManager.getWindow ? windowManager.getWindow() : windowManager;
      if (win) {
        if (win.isMaximized()) {
          win.unmaximize();
          return { success: true, isMaximized: false };
        } else {
          win.maximize();
          return { success: true, isMaximized: true };
        }
      }
      return { success: false };
    });

    ipcMain.handle('window:close', (e) => {
      const windowManager = this._getWindowManagerForSender(e.sender);
      const win = windowManager.getWindow ? windowManager.getWindow() : windowManager;
      if (win) {
        win.close();
        return { success: true };
      }
      return { success: false };
    });

    ipcMain.handle('window:getPosition', (e) => {
      const windowManager = this._getWindowManagerForSender(e.sender);
      const win = windowManager.getWindow ? windowManager.getWindow() : windowManager;
      if (win) {
        const bounds = win.getBounds();
        return { success: true, x: bounds.x, y: bounds.y };
      }
      return { success: false };
    });

    ipcMain.handle('window:setSidebarOpen', (e, isOpen) => {
      const senderId = e.sender.id;
      
      // 检查是否是分离窗口
      for (const [windowId, data] of this.detachedWindows) {
        if (data.window?.webContents?.id === senderId) {
          data.sidebarOpen = isOpen;
          // 同步 sidebarOpen 状态到 TabManager，确保新标签页创建时使用正确状态
          if (data.tabManager) {
            data.tabManager.sidebarOpen = isOpen;
            data.tabManager.resizeActiveView(isOpen);
          }
          return { success: true };
        }
      }
      
      // 主窗口
      const windowManager = this._getWindowManagerForSender(e.sender);
      if (windowManager.setSidebarOpen) {
        windowManager.setSidebarOpen(isOpen);
      }
      this.core.sidebarOpen = isOpen;
      // 同步 sidebarOpen 状态到 TabManager
      if (this.core.tabManager) {
        this.core.tabManager.sidebarOpen = isOpen;
        this.core.tabManager.resizeActiveView(isOpen);
      }
      
      return { success: true };
    });

    ipcMain.handle('window:isMaximized', (e) => {
      const windowManager = this._getWindowManagerForSender(e.sender);
      const win = windowManager.getWindow ? windowManager.getWindow() : windowManager;
      return { isMaximized: win?.isMaximized() || false };
    });

    // 打开 DevTools（用于调试）
    ipcMain.handle('window:openDevTools', (e) => {
      try {
        e.sender.openDevTools();
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });
  }

  // ========== 文件管理控制（系统级对话框拦截）==========
  _setupFileManagerHandlers() {
    // 设置自动文件模式
    ipcMain.handle('file:setAutoMode', (e, enabled, options = {}) => {
      const tabManager = this._getTabManagerForSender(e.sender);
      if (tabManager?.fileManager) {
        tabManager.fileManager.setAutoMode(enabled, options);
        return { 
          success: true, 
          enabled, 
          workDir: tabManager.fileManager.getWorkPath() 
        };
      }
      return { success: false, error: 'FileManager not available' };
    });

    // 准备上传文件（设置待选文件）
    ipcMain.handle('file:prepareUpload', (e, filePath) => {
      const tabManager = this._getTabManagerForSender(e.sender);
      if (tabManager?.fileManager) {
        const result = tabManager.fileManager.prepareUpload(filePath);
        return { success: result, filePath };
      }
      return { success: false, error: 'FileManager not available' };
    });

    // 获取工作目录
    ipcMain.handle('file:getWorkPath', (e, subDir = '') => {
      const tabManager = this._getTabManagerForSender(e.sender);
      if (tabManager?.fileManager) {
        return { 
          success: true, 
          path: tabManager.fileManager.getWorkPath(subDir) 
        };
      }
      return { success: false, error: 'FileManager not available' };
    });

    // 列出文件
    ipcMain.handle('file:listFiles', (e, subDir = '') => {
      const tabManager = this._getTabManagerForSender(e.sender);
      if (tabManager?.fileManager) {
        return { 
          success: true, 
          files: tabManager.fileManager.listFiles(subDir) 
        };
      }
      return { success: false, error: 'FileManager not available' };
    });
  }

  // ========== Copilot 控制（用于分离窗口）==========
  _setupCopilotHandlers() {
    ipcMain.handle('copilot:sendMessage', async (e, text) => {
      const windowId = this._getWindowIdFromSender(e.sender);
      let copilot = this.getCopilot?.().getCopilot?.(windowId);
      
      // 如果 Copilot 不存在，自动创建
      if (!copilot) {
        console.log(`[IPC] Copilot not found for window ${windowId}, creating...`);
        const copilotManager = this.getCopilot?.();
        if (copilotManager) {
          copilot = await copilotManager.createCopilot(windowId);
        }
      }
      
      if (!copilot) {
        return { success: false, error: 'Copilot not initialized' };
      }
      try {
        await copilot.sendMessage(text);
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('copilot:continue', async (e) => {
      const windowId = this._getWindowIdFromSender(e.sender);
      const copilot = this.getCopilot?.();
      if (!copilot) {
        return { success: false, error: 'Copilot not initialized' };
      }
      try {
        copilot.onUserContinue(windowId);
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('copilot:userChoice', async (e, shouldContinue) => {
      const windowId = this._getWindowIdFromSender(e.sender);
      const copilot = this.getCopilot?.();
      if (!copilot) {
        return { success: false, error: 'Copilot not initialized' };
      }
      try {
        const windowCopilot = copilot.getCopilot(windowId);
        if (windowCopilot) {
          await windowCopilot.onUserChoice(shouldContinue);
        }
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('copilot:openSettings', async () => {
      const windowManager = this.windowManager;
      if (windowManager?.openCopilotSettings) {
        await windowManager.openCopilotSettings();
        return { success: true };
      }
      return { success: false, error: 'Method not available' };
    });

    // 【新】Agent 切换
    ipcMain.handle('copilot:switchAgent', async (e, agentId) => {
      const windowId = this._getWindowIdFromSender(e.sender);
      const copilotManager = this.getCopilot?.();
      
      if (!copilotManager) {
        return { success: false, error: 'Copilot manager not initialized' };
      }
      
      try {
        // 获取或创建该窗口的 Copilot
        let windowCopilot = copilotManager.getCopilot(windowId);
        if (!windowCopilot) {
          console.log(`[IPC] Copilot not found for window ${windowId}, creating...`);
          windowCopilot = await copilotManager.createCopilot(windowId);
        }
        
        if (!windowCopilot) {
          return { success: false, error: 'Failed to create copilot' };
        }
        
        // 切换 Agent
        const success = windowCopilot.switchAgent(agentId);
        return { success };
      } catch (err) {
        console.error('[IPC] switchAgent error:', err);
        return { success: false, error: err.message };
      }
    });

    // Copilot 配置相关 IPC
    ipcMain.handle('copilot:getConfig', async () => {
      try {
        const configManager = this.configManager;
        if (!configManager) {
          return { success: false, error: 'Config manager not initialized' };
        }
        // 返回完整的 copilot 相关配置
        const config = {
          serviceType: configManager.get('serviceType') || 'local',
          local: configManager.get('local'),
          cloud: configManager.get('cloud'),
          general: {
            autoConnect: configManager.get('copilot.autoStart') || false,
            browserAutomation: configManager.get('browser.humanize.enabled') !== false
          }
        };
        return { success: true, config };
      } catch (err) {
        console.error('[IPC] Failed to get config:', err);
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('copilot:saveConfig', async (e, config) => {
      try {
        const configManager = this.configManager;
        if (!configManager) {
          return { success: false, error: 'Config manager not initialized' };
        }
        
        // 获取旧配置用于比较
        const oldServiceType = configManager.get('serviceType');
        const oldLocalConfig = configManager.get('local');
        const oldCloudConfig = configManager.get('cloud');
        const oldAutoStart = configManager.get('copilot.autoStart');
        const oldHumanize = configManager.get('browser.humanize.enabled');
        
        console.log('[IPC] Comparing config:');
        console.log('[IPC]   Old local token:', oldLocalConfig?.token ? oldLocalConfig.token.slice(-8) : '(empty)');
        console.log('[IPC]   New local token:', config.local?.token ? config.local.token.slice(-8) : '(empty)');
        
        // 检查各项配置是否改变
        const serviceTypeChanged = config.serviceType !== undefined && config.serviceType !== oldServiceType;
        const localConfigChanged = config.local && (
          config.local.url !== oldLocalConfig?.url ||
          config.local.token !== oldLocalConfig?.token ||
          config.local.sessionKey !== oldLocalConfig?.sessionKey
        );
        console.log('[IPC]   serviceTypeChanged:', serviceTypeChanged, 'localConfigChanged:', localConfigChanged);
        const cloudConfigChanged = config.cloud && (
          config.cloud.apiEndpoint !== oldCloudConfig?.apiEndpoint ||
          config.cloud.apiKey !== oldCloudConfig?.apiKey ||
          config.cloud.model !== oldCloudConfig?.model ||
          config.cloud.temperature !== oldCloudConfig?.temperature ||
          config.cloud.maxTokens !== oldCloudConfig?.maxTokens
        );
        const generalConfigChanged = config.general && (
          config.general.autoConnect !== oldAutoStart ||
          config.general.browserAutomation !== oldHumanize
        );
        
        // 总体配置是否改变
        const configChanged = serviceTypeChanged || localConfigChanged || cloudConfigChanged || generalConfigChanged;
        
        // 连接相关配置是否改变
        const connectionConfigChanged = serviceTypeChanged || localConfigChanged || cloudConfigChanged;
        
        // 如果没有配置变化，直接返回
        if (!configChanged) {
          console.log('[IPC] Config not changed, skipping save');
          return { success: true, configChanged: false };
        }
        
        // 保存配置
        if (config.serviceType !== undefined) {
          configManager.set('serviceType', config.serviceType);
        }
        if (config.local) {
          configManager.set('local', config.local);
        }
        if (config.cloud) {
          configManager.set('cloud', config.cloud);
        }
        if (config.general) {
          configManager.set('copilot.autoStart', config.general.autoConnect);
          configManager.set('browser.humanize.enabled', config.general.browserAutomation);
        }
        
        // 只有在连接配置改变时才重新连接
        if (connectionConfigChanged) {
          const aiService = this.getAIService?.();
          if (aiService) {
            // 总是先断开现有连接（静默模式，不发送断开 toast）
            console.log('[IPC] Connection config changed, disconnecting existing connection (silent)...');
            await aiService.disconnect(true);
            
            // 检查是否有有效的 token 才尝试连接
            const hasValidToken = config.local?.token || configManager.get('local.token');
            const hasValidCloudKey = config.cloud?.apiKey || configManager.get('cloud.apiKey');
            
            if (!hasValidToken && !hasValidCloudKey) {
              console.log('[IPC] No valid token or API key, keeping disconnected');
              // 根据用户选择的服务类型显示对应提示
              const message = config.serviceType === 'cloud' 
                ? '请先输入 Siliu AI API Key'
                : '请先输入 OpenClaw Token';
              return {
                success: true,
                configChanged: true,
                reconnected: false,
                message: message
              };
            }
            
            console.log('[IPC] Has valid token, trying to connect...');
            let reconnected = false;
            let error = null;
            try {
              reconnected = await aiService.connect();
            } catch (err) {
              error = err.message;
            }
            console.log('[IPC] AI service reconnect result:', reconnected, error);

            // 构建返回结果
            let result = {
              success: true,
              configChanged: true,
              reconnected: reconnected
            };
            // 根据用户选择的服务类型显示对应的消息
            if (config.serviceType === 'cloud') {
              result.message = reconnected ? '已连接到 Siliu AI 云服务' : '连接 Siliu AI 云服务失败';
            } else {
              result.message = reconnected ? '已连接到 OpenClaw 本地服务' : '连接 OpenClaw 本地服务失败';
            }
            if (!reconnected && error) {
              result.error = error;
            }
            return result;
          }
        }

        // 配置改变但不需要重新连接（如只改了通用设置），不显示提示
        console.log('[IPC] Config saved, no connection changes needed');
        return {
          success: true,
          configChanged: true,
          reconnected: false
        };
      } catch (err) {
        console.error('[IPC] Failed to save config:', err);
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('copilot:testConnection', async (e, config) => {
      try {
        if (!config?.serviceType) {
          return { success: false, error: '未指定服务类型' };
        }
        
        // 创建临时服务实例进行测试，使用传入的配置而非已保存的配置
        const { OpenClawAdapter, CloudAIAdapter } = require('../services/ai-service');
        
        let tempService;
        if (config.serviceType === 'local') {
          if (!config.local?.token) {
            return { success: false, error: '未配置本地 Token' };
          }
          // 直接使用底层模块进行测试，避免触发全局事件
          const OpenClawModule = require('../openclaw');
          const module = new OpenClawModule({
            url: config.local.url || 'ws://127.0.0.1:18789',
            token: config.local.token,
            sessionKey: 'test-connection', // 使用特殊 sessionKey 避免干扰正常对话
            onHello: () => {},
            onClose: () => {},
            onEvent: () => {} // 空回调，不触发任何事件
          });
          
          try {
            await module.connect();
            module.disconnect?.();
            return { success: true };
          } catch (err) {
            return { success: false, error: err.message };
          }
        } else if (config.serviceType === 'cloud') {
          if (!config.cloud?.apiKey) {
            return { success: false, error: '未配置云端 API Key' };
          }
          
          const model = config.cloud.model || 'kimi-k2.5';
          const endpoint = config.cloud.apiEndpoint || '';
          
          // 测试云端 AI 连接
          console.log('[IPC] Testing cloud connection with config:', { 
            endpoint: config.cloud.apiEndpoint,
            model: model,
            keyLength: config.cloud.apiKey?.length 
          });
          
          // 根据模型值选择适配器，与主逻辑保持一致
          const isCodingModel = model === 'k2p5' || model === 'k2';
          const isMinimaxModel = model.startsWith('MiniMax-');
          console.log('[IPC] Model:', model, 'isCodingModel:', isCodingModel, 'isMinimaxModel:', isMinimaxModel);
          
          if (isMinimaxModel) {
            // 使用 MiniMax 适配器（Anthropic 格式）
            const { MinimaxAdapter } = require('../services/minimax-adapter');
            const minimaxConfig = {
              apiKey: config.cloud.apiKey,
              baseUrl: config.cloud.apiEndpoint || 'https://api.minimaxi.com/anthropic',
              model: model
            };
            console.log('[IPC] MinimaxAdapter config:', { ...minimaxConfig, apiKey: minimaxConfig.apiKey.substring(0, 10) + '...' });
            const adapter = new MinimaxAdapter(minimaxConfig);
            const connected = await adapter.checkConnection();
            console.log('[IPC] MiniMax connection test result:', connected);
            if (connected) {
              return { success: true };
            } else {
              return { success: false, error: 'MiniMax 连接失败，请检查 API Key、端点和模型是否匹配' };
            }
          } else if (isCodingModel) {
            // 使用 Kimi Coding 适配器（Anthropic 格式）
            const { KimiCodingAdapter } = require('../services/kimi-coding-adapter');
            const codingConfig = {
              apiKey: config.cloud.apiKey,
              baseUrl: config.cloud.apiEndpoint || 'https://api.kimi.com/coding',
              model: model
            };
            console.log('[IPC] KimiCodingAdapter config:', { ...codingConfig, apiKey: codingConfig.apiKey.substring(0, 10) + '...' });
            const adapter = new KimiCodingAdapter(codingConfig);
            const connected = await adapter.checkConnection();
            console.log('[IPC] Kimi Coding connection test result:', connected);
            if (connected) {
              return { success: true };
            } else {
              return { success: false, error: 'Kimi Coding 连接失败，请检查 API Key、端点和模型是否匹配' };
            }
          } else {
            // 使用普通 Kimi 适配器（OpenAI 格式）
            const { KimiAdapter } = require('../services/kimi-adapter');
            let baseUrl = config.cloud.apiEndpoint || 'https://api.moonshot.cn/v1';
            baseUrl = baseUrl.replace('wss://', 'https://');
            const kimiConfig = {
              apiKey: config.cloud.apiKey,
              baseUrl: baseUrl,
              model: model
            };
            console.log('[IPC] KimiAdapter config:', { ...kimiConfig, apiKey: kimiConfig.apiKey.substring(0, 10) + '...' });
            const adapter = new KimiAdapter(kimiConfig);
            const connected = await adapter.checkConnection();
            console.log('[IPC] Cloud connection test result:', connected);
            if (connected) {
              return { success: true };
            } else {
              return { success: false, error: 'Kimi 连接失败，请检查 API Key、端点和模型是否匹配' };
            }
          }
        } else {
          return { success: false, error: '未知服务类型' };
        }
      } catch (err) {
        console.error('[IPC] Failed to test connection:', err);
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('copilot:resetConfig', async (e, serviceType) => {
      try {
        const configManager = this.configManager;
        if (!configManager) {
          return { success: false, error: 'Config manager not initialized' };
        }
        
        // 默认重置本地配置
        const targetService = serviceType || 'local';
        
        // 检查当前是否正在使用该服务，如果是则断开连接
        const currentServiceType = configManager.get('serviceType');
        const aiService = this.getAIService?.();
        
        if (targetService === 'local') {
          // 重置本地配置为默认值
          configManager.set('local', {
            url: 'ws://127.0.0.1:18789',
            token: '',
            sessionKey: 'agent:main:main'
          });
          // 如果当前正在使用本地服务，断开连接
          if (currentServiceType === 'local' && aiService?.isConnected()) {
            console.log('[IPC] Disconnecting AI service after local config reset');
            await aiService.disconnect();
          }
          console.log('[IPC] Local config reset to default');
        } else if (targetService === 'cloud') {
          // 重置云端配置为默认值
          configManager.set('cloud', {
            apiEndpoint: 'wss://ai.siliu.io/v1',
            apiKey: '',
            model: 'kimi-coding/k2p5'
          });
          // 如果当前正在使用云端服务，断开连接
          if (currentServiceType === 'cloud' && aiService?.isConnected()) {
            console.log('[IPC] Disconnecting AI service after cloud config reset');
            await aiService.disconnect();
          }
          console.log('[IPC] Cloud config reset to default');
        } else {
          return { success: false, error: '未知服务类型: ' + targetService };
        }
        
        return { success: true };
      } catch (err) {
        console.error('[IPC] Failed to reset config:', err);
        return { success: false, error: err.message };
      }
    });
  }

  // ========== OpenClaw 控制 ==========
  _setupOpenclawHandlers() {
    ipcMain.handle('openclaw:connect', async (e, config) => {
      const aiService = this.getAIService?.();
      if (!aiService) {
        return { success: false, error: 'AI service not initialized' };
      }
      try {
        // 如果传入了配置，先保存到 configManager
        if (config?.local) {
          const configManager = this.configManager;
          if (configManager) {
            configManager.set('local', config.local);
          }
        }
        const result = await aiService.connect();
        return { success: result };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('openclaw:disconnect', async () => {
      console.log('[IPC] openclaw:disconnect called');
      const aiService = this.getAIService?.();
      if (aiService) {
        await aiService.disconnect();
        console.log('[IPC] disconnect completed');
        return { success: true };
      }
      return { success: false, error: 'AI service not initialized' };
    });

    ipcMain.handle('openclaw:status', () => {
      try {
        const aiService = this.getAIService?.();
        const isConnected = aiService?.isConnected?.() || false;
        const serviceName = aiService?.getServiceName?.();
        return {
          connected: Boolean(isConnected),
          service: String(serviceName || 'none')
        };
      } catch (err) {
        console.error('[IPC] openclaw:status error:', err.message);
        return { connected: false, service: 'none', error: err.message };
      }
    });

    ipcMain.handle('openclaw:sendMessage', async (e, text) => {
      const aiService = this.getAIService?.();
      if (!aiService) {
        return { success: false, error: 'AI service not initialized' };
      }
      try {
        const result = await aiService.sendMessage(text);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('openclaw:getHistory', async (e, limit = 50) => {
      const aiService = this.getAIService?.();
      if (!aiService) {
        return { success: false, error: 'AI service not initialized' };
      }
      try {
        const result = await aiService.getHistory(limit);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    // ========== Toast 通知（供 BrowserView 内部页面使用）==========
    ipcMain.handle('view:showToast', async (e, { message, type = 'success', duration = 3000 }) => {
      console.log('[IPC] view:showToast called:', message, type);
      const windowManager = this._getWindowManagerForSender(e.sender);
      console.log('[IPC] windowManager found:', !!windowManager, 'sendToRenderer:', !!windowManager?.sendToRenderer);
      if (windowManager?.sendToRenderer) {
        windowManager.sendToRenderer('toast:show', { message, type, duration });
        console.log('[IPC] toast:show event sent');
        return { success: true };
      }
      return { success: false, error: 'Window manager not available' };
    });
  }

  // ========== Shell 输入框右键菜单 ==========
  _setupShellContextMenu() {
    ipcMain.handle('shell:contextmenu', async (e, { isEditable, hasSelection, text }) => {
      const windowManager = this._getWindowManagerForSender(e.sender);
      const tabManager = this._getTabManagerForSender(e.sender);
      
      const senderId = e.sender.id;
      const CustomMenuWindow = require('./menu/custom-menu-window');
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

      // 使用 shell 专用文本菜单显示
      await instance.showShellTextMenu({ text, isEditable, hasSelection }, relativeX, relativeY, windowManager, tabManager, e.sender, senderId);
      return { success: true };
    });
  }

  // ========== 工具方法 ==========
  _getWindowIdFromSender(sender) {
    const senderId = sender.id;
    const mainWindow = this.windowManager.getWindow();
    const mainWindowId = mainWindow?.webContents?.id;

    if (mainWindowId === senderId) {
      return 'main';
    }

    for (const [windowId, data] of this.detachedWindows) {
      if (data.window?.webContents?.id === senderId) {
        return windowId;
      }
    }

    return null;
  }

  _getTabManagerForSender(sender) {
    const senderId = sender.id;
    const mainWindow = this.windowManager.getWindow();
    const mainWindowId = mainWindow?.webContents?.id;

    // 检查是否是分离窗口的 window webContents（shell.html）
    for (const [windowId, data] of this.detachedWindows) {
      if (data.window?.webContents?.id === senderId) {
        return data.tabManager;
      }
    }

    if (mainWindowId === senderId) {
      return this.tabManager;
    }

    for (const [viewId, viewData] of this.tabManager.views) {
      if (viewData?.view?.webContents?.id === senderId) {
        return this.tabManager;
      }
    }

    for (const [windowId, data] of this.detachedWindows) {
      for (const [viewId, viewData] of data.tabManager.views) {
        if (viewData?.view?.webContents?.id === senderId) {
          return data.tabManager;
        }
      }
    }

    return this.tabManager;
  }

  _getWindowManagerForSender(sender) {
    const senderId = sender.id;

    // 检查是否是分离窗口的 window webContents（shell.html）
    for (const [windowId, data] of this.detachedWindows) {
      if (data.window?.webContents?.id === senderId) {
        return data.windowManager;
      }
    }

    const mainWindow = this.windowManager.getWindow();
    const mainWindowId = mainWindow?.webContents?.id;

    if (mainWindowId === senderId) {
      return this.windowManager;
    }

    for (const [viewId, viewData] of this.tabManager.views) {
      if (viewData?.view?.webContents?.id === senderId) {
        return this.windowManager;
      }
    }

    for (const [windowId, data] of this.detachedWindows) {
      for (const [viewId, viewData] of data.tabManager.views) {
        if (viewData?.view?.webContents?.id === senderId) {
          return data.windowManager;
        }
      }
    }

    return this.windowManager;
  }

  // ========== 文件选择器拦截处理 ==========
  _setupFileChooserHandlers() {
    // 存储每个 webContents 的待上传文件路径
    const pendingFiles = new Map();

    // 文件选择器被打开（由 preload 脚本发送）
    ipcMain.on('filechooser:opened', (event, data) => {
      const webContentsId = event.sender.id;
      console.log('[IPC] File chooser opened in webContents:', webContentsId, data);
      
      // 检查是否有待上传的文件
      const pendingFile = pendingFiles.get(webContentsId);
      if (pendingFile) {
        console.log('[IPC] Has pending file, auto-setting:', pendingFile);
        // 通过 CDP 设置文件
        this._setFileInputFiles(event.sender, pendingFile).then(() => {
          pendingFiles.delete(webContentsId);
        }).catch(err => {
          console.error('[IPC] Failed to set file:', err);
        });
      }
    });

    // 设置待上传文件路径（由 CDP 控制器调用）
    ipcMain.handle('filechooser:setFile', async (event, filePath) => {
      const webContentsId = event.sender.id;
      console.log('[IPC] Setting pending file for webContents:', webContentsId, filePath);
      pendingFiles.set(webContentsId, filePath);
      return { success: true };
    });

    // 实际设置文件的内部方法
    this._setFileInputFiles = async (webContents, filePath) => {
      try {
        // 使用 CDP 设置文件
        const devTools = webContents.devToolsWebContents;
        if (!devTools) {
          // 尝试启用 DevTools
          webContents.openDevTools({ mode: 'detach' });
          webContents.closeDevTools();
        }

        // 通过 executeJavaScript 设置文件
        const result = await webContents.executeJavaScript(`
          (async function() {
            const input = window.__siliuFileInterceptor?.lastCapturedInput || 
                         document.querySelector('input[type="file"]:last-of-type');
            if (!input) {
              return { success: false, error: 'No file input found' };
            }
            
            // 创建一个 DataTransfer 对象来模拟文件选择
            try {
              const response = await fetch('file://' + ${JSON.stringify(filePath)});
              const blob = await response.blob();
              const file = new File([blob], ${JSON.stringify(require('path').basename(filePath))}, { type: blob.type || 'image/png' });
              
              const dataTransfer = new DataTransfer();
              dataTransfer.items.add(file);
              input.files = dataTransfer.files;
              
              // 触发事件
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new Event('input', { bubbles: true }));
              
              return { success: true, fileName: file.name };
            } catch (e) {
              // 如果 fetch 失败，使用简化方法
              input.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true, method: 'simplified' };
            }
          })()
        `);
        
        console.log('[IPC] Set file result:', result);
        return result;
      } catch (err) {
        console.error('[IPC] Error setting file:', err);
        throw err;
      }
    };
  }

  // ========== Agent 相关 IPC ==========
  _setupAgentHandlers() {
    console.log('[IPC] _setupAgentHandlers called');
    try {
      const { registry } = require('../copilot/agents/agent-registry');
      console.log('[IPC] Agent registry loaded, count:', registry?.count);
      
      if (!registry) {
        console.error('[IPC] Agent registry is null!');
        return;
      }
    
    // 获取所有 Agent 列表（用于 UI 渲染）
    console.log('[IPC] Registering agents:getAll handler');
    ipcMain.handle('agents:getAll', async (event) => {
      console.log('[IPC] agents:getAll called by:', event.sender.id);
      try {
        const agents = registry.getAllAgents();
        console.log('[IPC] agents:getAll returning', agents?.length, 'agents');
        return agents;
      } catch (err) {
        console.error('[IPC] agents:getAll error:', err);
        throw err;
      }
    });
    
    // 获取当前 Agent
    ipcMain.handle('agents:getCurrent', () => {
      const agent = registry.getCurrent();
      return agent ? agent.getDisplayInfo() : null;
    });
    
    // 切换 Agent
    ipcMain.handle('agents:switch', (e, agentId) => {
      const success = registry.switchTo(agentId);
      return { success, agent: success ? registry.getCurrent().getDisplayInfo() : null };
    });
    } catch (err) {
      console.error('[IPC] Error setting up agent handlers:', err);
    }
  }
}

module.exports = { IPCHandlers };
