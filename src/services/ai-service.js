/**
 * AIService - AI 服务抽象层
 * 解耦 Copilot 与具体的 AI 实现（OpenClaw/Cloud）
 */

const { globalEventBus } = require('../core/event-bus');

/**
 * AI 服务基类
 */
class BaseAIService {
  constructor(options = {}) {
    this.name = 'base';
    // 不要在这里设置 connected，让子类自己定义
    this.messageQueue = [];
    this.options = options;
  }

  async connect() {
    throw new Error('Not implemented');
  }

  async disconnect() {
    throw new Error('Not implemented');
  }

  async sendMessage(message, options = {}) {
    throw new Error('Not implemented');
  }

  onMessage(callback) {
    throw new Error('Not implemented');
  }

  onConnect(callback) {
    return globalEventBus.on('ai:connected', callback);
  }

  onDisconnect(callback) {
    return globalEventBus.on('ai:disconnected', callback);
  }

  onError(callback) {
    return globalEventBus.on('ai:error', callback);
  }
}

/**
 * OpenClaw 本地服务适配器
 * 使用原有的 OpenClawModule 实现
 */
class OpenClawAdapter extends BaseAIService {
  // 静态属性：存储当前活跃实例的 ID
  static _activeInstance = null;
  constructor(options = {}) {
    super(options);
    this.name = 'openclaw';
    this.url = options.url || 'ws://127.0.0.1:18789';
    this.token = options.token || '';
    this.sessionKey = options.sessionKey || 'agent:main:main';
    this._connected = false;
    this.messageCallbacks = [];

    // 实例 ID，用于识别当前实例是否过期
    this._instanceId = Date.now();

    // 使用原有的 OpenClawModule
    const OpenClawModule = require('../openclaw');

    this.module = new OpenClawModule({
      url: this.url,
      token: this.token,
      sessionKey: this.sessionKey,
      autoReconnect: false, // 首次连接失败不重试，快速反馈错误
      onHello: (result) => {
        // 检查实例是否过期（已被新实例替换）
        if (OpenClawAdapter._activeInstance !== this._instanceId) {
          console.log('[OpenClawAdapter] Ignoring hello from expired instance');
          return;
        }

        this._connected = true;
        // 只有当真正连接成功时才触发事件
        console.log('[OpenClawAdapter] Connected successfully, emitting ai:connected');
        globalEventBus.emit('ai:connected', { service: this.name });
      },
      onClose: () => {
        // 检查实例是否过期
        if (OpenClawAdapter._activeInstance !== this._instanceId) {
          console.log('[OpenClawAdapter] Ignoring close from expired instance');
          return;
        }

        // 只有在真正连接过的情况下才触发断开事件
        if (this._connected) {
          console.log('[OpenClawAdapter] Connection closed, emitting ai:disconnected');
          this._connected = false;
          globalEventBus.emit('ai:disconnected', { service: this.name });
          // 发送断开连接 toast
          const serviceName = this.isLocalOpenClaw ? 'OpenClaw 本地服务' : 'Siliu AI 云端服务';
          globalEventBus.emit('ai:toast', {
            message: `${serviceName} 已断开`,
            type: 'info'
          });
        } else {
          console.log('[OpenClawAdapter] Connection closed but was never fully connected');
        }
      },
      onEvent: (event) => {
        // 检查实例是否过期
        if (OpenClawAdapter._activeInstance !== this._instanceId) {
          return;
        }

        // 添加当前 sessionKey 到事件中，用于路由到正确的窗口
        const eventWithSessionKey = {
          ...event,
          payload: {
            ...event.payload,
            sessionKey: this.module.opts.sessionKey
          }
        };
        this.messageCallbacks.forEach(cb => cb(eventWithSessionKey));
      }
    });

    // 标记当前实例为活跃
    OpenClawAdapter._activeInstance = this._instanceId;
  }

  get connected() {
    // 只使用内部状态，避免与底层模块状态不同步
    return this._connected;
  }

  async connect() {
    if (this.connected) {
      return Promise.resolve();
    }

    try {
      await this.module.connect();
      // 等待一小段时间确保底层连接完成
      await new Promise(resolve => setTimeout(resolve, 100));
      this._connected = true;
      return true;
    } catch (err) {
      this._connected = false;
      globalEventBus.emit('ai:error', { service: this.name, error: err.message });
      throw err;
    }
  }

  async disconnect(silent = false) {
    // 标记实例过期（通过创建新实例 ID）
    OpenClawAdapter._activeInstance = Date.now();
    
    // 如果当前是连接状态，手动触发断开事件（因为 onClose 中需要 _connected 为 true）
    const wasConnected = this._connected;
    this._connected = false;
    
    if (wasConnected) {
      console.log('[OpenClawAdapter] Manual disconnect, silent:', silent);
      globalEventBus.emit('ai:disconnected', { service: this.name });
      // 非静默模式才发送 toast
      if (!silent) {
        const serviceName = this.isLocalOpenClaw ? 'OpenClaw 本地服务' : 'Siliu AI 云端服务';
        globalEventBus.emit('ai:toast', {
          message: `${serviceName} 已断开`,
          type: 'info'
        });
      }
    }
    
    // 断开并清理模块
    if (this.module) {
      this.module.disconnect?.();
      this.module = null;
    }
  }

  async sendMessage(message, options = {}) {
    // 如果提供了 sessionKey，设置它（不恢复，因为响应需要用它来路由）
    if (options.sessionKey) {
      this.module.opts.sessionKey = options.sessionKey;
    }
    return this.module.sendMessage(message);
  }

  onMessage(callback) {
    this.messageCallbacks.push(callback);
    return () => {
      const index = this.messageCallbacks.indexOf(callback);
      if (index > -1) this.messageCallbacks.splice(index, 1);
    };
  }
}

/**
 * 云端 AI 服务适配器（待实现）
 */
class CloudAIAdapter extends BaseAIService {
  constructor(options = {}) {
    super(options);
    this.name = 'cloud';
    this.apiEndpoint = options.apiEndpoint || 'wss://ai.siliu.io/v1';
    this.apiKey = options.apiKey || '';
    this.model = options.model || 'kimi-coding/k2p5';
  }

  async connect() {
    // TODO: 实现云端 AI 连接
    console.log('[CloudAIAdapter] Cloud AI not yet implemented');
    throw new Error('Cloud AI not implemented');
  }

  async disconnect() {
    this.connected = false;
  }

  async sendMessage(message, options = {}) {
    // TODO: 实现云端 AI 消息发送
    throw new Error('Cloud AI not implemented');
  }

  onMessage(callback) {
    // TODO: 实现消息监听
    return () => {};
  }
}

/**
 * AI 服务工厂
 */
class AIServiceFactory {
  static create(type, options = {}) {
    switch (type) {
      case 'openclaw':
      case 'local':
        return new OpenClawAdapter(options);
      case 'cloud':
        return new CloudAIAdapter(options);
      default:
        throw new Error(`Unknown AI service type: ${type}`);
    }
  }
}

/**
 * AI 服务管理器
 * 统一管理 AI 服务的连接和切换
 */
/**
 * AI 服务管理器
 * 统一管理 AI 服务的连接和切换
 * 
 * 自动选择策略：
 * - OpenClaw 本地 (localhost/127.0.0.1): 使用 OpenClaw 适配器 + HTTP 截图服务
 * - OpenClaw 远程 (其他地址): 使用 Kimi 直连适配器
 */
class AIServiceManager {
  constructor(configManager) {
    this.configManager = configManager;
    this.currentService = null;
    this.unsubscribe = null;
    this.kimiAdapter = null;
    this.isLocalOpenClaw = true;
    console.log('[AIServiceManager] Constructor called, currentService set to null');
  }

  /**
   * 激活 AI 服务（应用启动时调用，有配置则自动连接，无配置则静默等待）
   * 类似于 AdBlock 的 activate() 模式
   */
  async activate() {
    const serviceType = this.configManager.get('serviceType') || 'local';
    let hasConfig = false;

    if (serviceType === 'cloud') {
      hasConfig = !!this.configManager.get('cloud.apiKey');
    } else {
      hasConfig = !!this.configManager.get('local.token');
    }

    if (hasConfig) {
      console.log(`[AIServiceManager] ${serviceType} config found, auto-connecting...`);
      const success = await this.initialize();

      // 触发 toast 提示（使用与现有代码相同的提示信息）
      const serviceName = serviceType === 'cloud' ? 'Siliu AI 云端服务' : 'OpenClaw 本地服务';
      if (success) {
        globalEventBus.emit('ai:toast', {
          message: `已连接到 ${serviceName}`,
          type: 'success'
        });
      } else {
        globalEventBus.emit('ai:toast', {
          message: `连接 ${serviceName} 失败`,
          type: 'error'
        });
      }
      return success;
    } else {
      console.log(`[AIServiceManager] No ${serviceType} config found, waiting for user to configure`);
      return false;
    }
  }

  /**
   * 连接 AI 服务（根据配置的 serviceType 自动选择）
   */
  async connect() {
    return this.initialize();
  }

  /**
   * 检查 OpenClaw 是否为本地地址
   */
  _isLocalOpenClaw(url) {
    if (!url) return true;
    return url.includes('localhost') || 
           url.includes('127.0.0.1') ||
           url.includes('192.168.') ||  // 内网也算本地
           url.includes('10.') ||
           url.includes('172.');
  }

  /**
   * 初始化并连接 AI 服务
   * 根据用户选择的 serviceType 决定使用哪个适配器
   */
  async initialize() {
    const config = this.configManager.get('serviceType') || 'cloud';
    
    console.log(`[AIServiceManager] User selected serviceType: ${config}`);
    
    if (config === 'cloud') {
      // 用户选择了 AI 云 → 使用 Kimi 直连
      console.log('[AIServiceManager] Mode: CLOUD (Kimi Direct)');
      this.isLocalOpenClaw = false;
      return this.connectKimiDirect();
    } else {
      // 用户选择了本地服务 → 使用 OpenClaw
      console.log('[AIServiceManager] Mode: LOCAL (OpenClaw)');
      this.isLocalOpenClaw = true;
      return this.connectLocal();
    }
  }

  /**
   * 连接本地 OpenClaw
   * @param {Object} overrideConfig - 可选，传入配置覆盖文件中的配置
   */
  async connectLocal(overrideConfig = null) {
    console.log('[AIServiceManager] connectLocal() called, currentService:', !!this.currentService);
    console.trace('[AIServiceManager] connectLocal stack trace:');
    
    // 防止重复连接
    if (this._connecting) {
      console.log('[AIServiceManager] Connection already in progress, waiting...');
      while (this._connecting) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.isConnected();
    }

    // 使用传入的配置或从文件读取
    const localConfig = overrideConfig || this.configManager.get('local');

    if (!localConfig?.token) {
      console.log('[AIServiceManager] No local token configured');
      return false;
    }

    if (this.isConnected()) {
      console.log('[AIServiceManager] Already connected');
      return true;
    }

    console.log('[AIServiceManager] Connecting to local OpenClaw:', localConfig.url);
    this._connecting = true;

    try {
      await this.disconnect();
      // 【优化】减少断开连接后的等待时间
      await new Promise(resolve => setTimeout(resolve, 100));

      this.currentService = AIServiceFactory.create('openclaw', localConfig);
      const connectResult = await this.currentService.connect();
      
      console.log('[AIServiceManager] connect() returned:', connectResult, 'currentService.connected:', this.currentService?.connected);
      
      // 检查是否真的连接成功
      if (!this.currentService?.connected) {
        console.log('[AIServiceManager] connect() succeeded but _connected is false, treating as failure');
        // 连接失败，清理并重置实例，防止自动重连
        await this.disconnect();
        return false;
      }
      
      // 触发连接事件
      globalEventBus.emit('ai:connected', { mode: 'openclaw' });
      
      this._applyPendingCallbacks();
      console.log('[AIServiceManager] OpenClaw connected successfully');
      return true;
    } catch (err) {
      console.error('[AIServiceManager] Failed to connect to OpenClaw:', err.message);
      // 连接失败，清理并重置实例，防止自动重连
      await this.disconnect();
      return false;
    } finally {
      this._connecting = false;
    }
  }

  /**
   * 连接 Kimi 直连（绕过 OpenClaw）
   */
  async connectKimiDirect() {
    // 使用 cloud 配置（前端设置页面保存的配置）
    const cloudConfig = this.configManager.get('cloud');

    console.log('[AIServiceManager] connectKimiDirect called with config:', {
      apiEndpoint: cloudConfig?.apiEndpoint,
      hasApiKey: !!cloudConfig?.apiKey,
      model: cloudConfig?.model
    });

    if (!cloudConfig?.apiKey) {
      console.error('[AIServiceManager] No cloud API key configured');
      console.error('[AIServiceManager] Please configure cloud settings in Copilot settings');
      return false;
    }

    console.log('[AIServiceManager] Using cloud AI connection');
    
    try {
      // 根据模型值选择适配器，模型决定使用的 API 格式
      const model = cloudConfig.model || 'kimi-k2.5';
      const isCodingModel = model === 'k2p5' || model === 'k2';
      const isMinimaxModel = model.startsWith('MiniMax-');
      console.log('[AIServiceManager] Model:', model, 'isCodingModel:', isCodingModel, 'isMinimaxModel:', isMinimaxModel);
      
      if (isMinimaxModel) {
        // 使用 MiniMax 适配器（Anthropic 格式）
        const { MinimaxAdapter } = require('./minimax-adapter');
        const minimaxConfig = {
          apiKey: cloudConfig.apiKey,
          baseUrl: cloudConfig.apiEndpoint || 'https://api.minimaxi.com/anthropic',
          model: model
        };
        this.kimiAdapter = new MinimaxAdapter(minimaxConfig);
        console.log('[AIServiceManager] Using MiniMax adapter with Anthropic format');
      } else if (isCodingModel) {
        // 使用 Kimi Coding 适配器（Anthropic 格式）
        const { KimiCodingAdapter } = require('./kimi-coding-adapter');
        const codingConfig = {
          apiKey: cloudConfig.apiKey,
          baseUrl: cloudConfig.apiEndpoint || 'https://api.kimi.com/coding',
          model: model
        };
        this.kimiAdapter = new KimiCodingAdapter(codingConfig);
        console.log('[AIServiceManager] Using Kimi Coding adapter with Anthropic format');
      } else {
        // 使用普通 Kimi 适配器（OpenAI 格式）
        const { KimiAdapter } = require('./kimi-adapter');
        let baseUrl = cloudConfig.apiEndpoint || 'https://api.moonshot.cn/v1';
        baseUrl = baseUrl.replace('wss://', 'https://');
        const kimiConfig = {
          apiKey: cloudConfig.apiKey,
          baseUrl: baseUrl,
          model: model
        };
        this.kimiAdapter = new KimiAdapter(kimiConfig);
        console.log('[AIServiceManager] Using standard Kimi adapter with OpenAI format');
      }
      
      // 测试连接
      const connected = await this.kimiAdapter.checkConnection();
      if (connected) {
        console.log('[AIServiceManager] Cloud AI connected successfully');
        
        // 触发连接事件
        globalEventBus.emit('ai:connected', { mode: 'kimi' });
        
        // 应用待处理的消息回调
        this._applyPendingCallbacks();
        
        return true;
      } else {
        console.error('[AIServiceManager] Cloud AI connection failed');
        this.kimiAdapter = null;
        return false;
      }
    } catch (err) {
      console.error('[AIServiceManager] Failed to connect to cloud AI:', err.message);
      return false;
    }
  }

  /**
   * 断开当前连接
   * @param {boolean} silent - 是否静默断开（不发送 toast）
   */
  async disconnect(silent = false) {
    console.log('[AIServiceManager] disconnect called, silent:', silent, 'currentService:', this.currentService?.constructor?.name, 'kimiAdapter:', !!this.kimiAdapter);
    
    if (this.currentService) {
      console.log('[AIServiceManager] Calling currentService.disconnect()');
      await this.currentService.disconnect(silent);
      console.log('[AIServiceManager] currentService.disconnect() completed');
      this.currentService = null;
    }
    
    if (this.kimiAdapter) {
      console.log('[AIServiceManager] Calling kimiAdapter.disconnect()');
      await this.kimiAdapter.disconnect(silent);
      console.log('[AIServiceManager] kimiAdapter.disconnect() completed');
      this.kimiAdapter = null;
    }
    
    // 重置所有回调的 applied 状态，以便重新订阅到新服务
    if (this._pendingMessageCallbacks) {
      for (const wrappedCallback of this._pendingMessageCallbacks) {
        wrappedCallback.applied = false;
        if (wrappedCallback.unsubscribe) {
          wrappedCallback.unsubscribe();
          wrappedCallback.unsubscribe = null;
        }
      }
    }
  }

  /**
   * 发送消息
   * 自动根据模式选择发送方式
   */
  async sendMessage(message, options = {}) {
    const text = typeof message === 'string' ? message : message.text || message;
    
    if (this.isLocalOpenClaw && this.currentService) {
      // 本地模式：通过 OpenClaw
      return this.currentService.sendMessage(text, options);
    } else if (this.kimiAdapter) {
      // 远程模式：直连 Kimi
      return this.kimiAdapter.sendMessage(text, options);
    } else {
      throw new Error('No AI service connected');
    }
  }

  /**
   * 发送多模态消息（带图片）
   * 自动根据模式选择发送方式
   */
  async sendMultimodalMessage(text, attachments, options = {}) {
    // 【调试日志】打印发送前的信息
    console.log(`\n========== [DEBUG] AIServiceManager.sendMultimodalMessage ==========`);
    console.log(`Mode: ${this.isLocalOpenClaw ? 'Local (OpenClaw)' : 'Cloud (Kimi Direct)'}`);
    console.log(`Has currentService: ${!!this.currentService}`);
    console.log(`Has kimAdapter: ${!!this.kimiAdapter}`);
    console.log(`Text length: ${text.length} chars`);
    console.log(`Attachments count: ${attachments?.length || 0}`);
    if (attachments?.length > 0) {
      attachments.forEach((att, i) => {
        console.log(`  Attachment[${i}]: mime=${att.mime}, hasPath=${!!att.path}, hasUrl=${!!att.url}, hasData=${!!att.data}`);
      });
    }
    console.log('========== [DEBUG] End sendMultimodalMessage Header ==========\n');

    if (this.isLocalOpenClaw && this.currentService) {
      // 本地模式：通过 OpenClaw 发送
      console.log('[AIServiceManager] Sending to OpenClaw (local mode)');
      return this.currentService.sendMessage(text, {
        ...options,
        attachments
      });
    } else if (this.kimiAdapter) {
      // 远程模式：直连 Kimi，转换 attachments 格式
      // Kimi API 使用 Base64，需要读取文件内容
      const fs = require('fs').promises;
      const images = await Promise.all(
        attachments.map(async (att) => {
          if (att.path) {
            // 本地文件，读取为 Base64
            const buffer = await fs.readFile(att.path);
            return {
              mimeType: att.mime,
              data: buffer.toString('base64')
            };
          } else if (att.data) {
            // 已经是 Base64
            return {
              mimeType: att.mime,
              data: att.data
            };
          }
          return null;
        })
      );
      
      console.log(`[AIServiceManager] Sending to Kimi Direct, converted ${images.filter(Boolean).length} images to base64`);
      return this.kimiAdapter.sendMultimodalMessage(
        text,
        images.filter(Boolean),
        options
      );
    } else {
      throw new Error('No AI service connected');
    }
  }

  /**
   * 获取历史记录
   */
  async getHistory(limit = 50) {
    if (!this.currentService) {
      throw new Error('No AI service connected');
    }
    if (this.currentService.getHistory) {
      return this.currentService.getHistory(limit);
    }
    return { history: [] };
  }

  /**
   * 监听消息（支持延迟订阅）
   * 自动根据模式选择监听对象
   */
  onMessage(callback) {
    // 如果已连接（本地 OpenClaw 模式）
    if (this.currentService) {
      return this.currentService.onMessage(callback);
    }

    // 如果已连接（Kimi 直连模式）
    if (this.kimiAdapter) {
      return this.kimiAdapter.onMessage(callback);
    }

    // 如果未连接，保存回调，连接后自动生效
    this._pendingMessageCallbacks = this._pendingMessageCallbacks || [];

    // 包装回调，标记为未处理
    const wrappedCallback = {
      callback,
      applied: false,
      unsubscribe: null,
      unsubscribeConnect: null
    };

    this._pendingMessageCallbacks.push(wrappedCallback);

    // 监听连接事件，连接后自动订阅
    wrappedCallback.unsubscribeConnect = globalEventBus.on('ai:connected', () => {
      const service = this.currentService || this.kimiAdapter;
      if (service) {
        // 如果已经应用过，先取消旧订阅
        if (wrappedCallback.applied && wrappedCallback.unsubscribe) {
          wrappedCallback.unsubscribe();
        }
        // 重新订阅到新服务
        wrappedCallback.unsubscribe = service.onMessage(callback);
        wrappedCallback.applied = true;
      }
    });

    // 返回取消订阅函数
    return () => {
      // 如果已经应用到服务，取消服务订阅
      if (wrappedCallback.applied && wrappedCallback.unsubscribe) {
        wrappedCallback.unsubscribe();
      }
      // 取消连接事件监听
      if (wrappedCallback.unsubscribeConnect) {
        wrappedCallback.unsubscribeConnect();
      }
      // 从待处理列表移除
      const index = this._pendingMessageCallbacks?.indexOf(wrappedCallback);
      if (index > -1) {
        this._pendingMessageCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * 应用待处理的消息回调
   * 连接成功后调用，将待处理的回调应用到当前服务
   */
  _applyPendingCallbacks() {
    if (!this._pendingMessageCallbacks?.length) return;
    
    const service = this.currentService || this.kimiAdapter;
    if (!service) return;

    console.log(`[AIServiceManager] Applying ${this._pendingMessageCallbacks.length} pending callbacks`);
    
    for (const wrappedCallback of this._pendingMessageCallbacks) {
      // 如果已经应用过，先取消旧订阅
      if (wrappedCallback.applied && wrappedCallback.unsubscribe) {
        wrappedCallback.unsubscribe();
      }
      // 重新订阅到新服务
      wrappedCallback.unsubscribe = service.onMessage(wrappedCallback.callback);
      wrappedCallback.applied = true;
    }
  }

  /**
   * 获取当前服务
   */
  getCurrentService() {
    return this.currentService;
  }

  /**
   * 获取当前连接状态和模式信息
   * 用于前端显示正确的连接状态
   */
  getConnectionInfo() {
    let info;
    console.log('[AIServiceManager] getConnectionInfo check:', {
      isLocalOpenClaw: this.isLocalOpenClaw,
      hasKimiAdapter: !!this.kimiAdapter,
      hasCurrentService: !!this.currentService
    });
    
    if (this.isLocalOpenClaw === false && this.kimiAdapter) {
      // 远程模式：直连 Kimi
      info = {
        mode: 'kimi',
        connected: true,
        name: 'Kimi',
        displayName: 'Kimi K2.5',
        isLocal: false
      };
    } else if (this.currentService) {
      // 本地模式：通过 OpenClaw
      const connected = this.currentService.connected || false;
      info = {
        mode: 'openclaw',
        connected: connected,
        name: 'OpenClaw',
        displayName: connected ? 'OpenClaw 已连接' : 'OpenClaw 未连接',
        isLocal: true
      };
    } else {
      // 未连接
      info = {
        mode: 'none',
        connected: false,
        name: 'None',
        displayName: '未连接',
        isLocal: true
      };
    }
    console.log('[AIServiceManager] getConnectionInfo result:', info);
    return info;
  }

  /**
   * 检查是否已连接
   */
  isConnected() {
    return (this.isLocalOpenClaw === false && this.kimiAdapter) || 
           (this.currentService?.connected || false);
  }

  /**
   * 获取服务名称
   */
  getServiceName() {
    return this.currentService?.name || 'none';
  }
}

module.exports = {
  BaseAIService,
  OpenClawAdapter,
  CloudAIAdapter,
  AIServiceFactory,
  AIServiceManager
};
