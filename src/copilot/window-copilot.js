/**
 * WindowCopilot - 绑定到特定窗口的 Copilot 实例
 *
 * 每个窗口拥有独立的：
 * - 对话历史
 * - 任务状态
 * - 浏览器操作上下文（绑定到特定窗口的视图）
 */

const { globalEventBus } = require('../core/event-bus');
const { COPILOT_EVENTS, CONTROLLER_EVENTS } = require('../core/events');
const { PromptBuilder } = require('./prompt-builder');
const { LoginDetector } = require('./login-detector');
const { VisualContextManager } = require('./visual-context');
const { ExecutionConfirmation, ConfirmationResult } = require('./execution-confirmation');
const { registry: agentRegistry } = require('./agents');
const { resolveHomePath } = require('../core/path-utils');
const { getExportManager } = require('../core/export-manager');

// 默认配置
const DEFAULT_CONFIG = {
  maxSteps: 50,  // 增加到50步
  timeouts: {
    sendMessage: 10000,
    observePage: 10000,
    operation: 15000
  }
};

class WindowCopilot {
  constructor(options = {}) {
    this.windowId = options.windowId; // 绑定的窗口ID
    this.aiServiceManager = options.aiServiceManager;
    this.core = options.core; // CoreModule，用于获取窗口的视图
    this.configManager = options.configManager;
    this.controller = options.controller; // SiliuController，用于浏览器操作
    this.config = { ...DEFAULT_CONFIG };

    // 初始化提示词构建器
    this.promptBuilder = new PromptBuilder({ maxSteps: this.config.maxSteps });
    
    // 绑定 AgentRegistry
    this.agentRegistry = agentRegistry;

    // 初始化登录检测器
    this.loginDetector = new LoginDetector();

    // 状态
    this.mode = 'chat';
    this.isExecuting = false;
    this.currentTask = null;
    this.stepCount = 0;
    this.memory = { history: [], findings: [] };
    this.unsubscribeAI = null;

    // 对话历史（窗口隔离）
    this.conversationHistory = [];

    // 登录等待计数
    this.loginWaitCount = 0;

    // 跟踪当前是否处于 hover 面板上下文中（用于 hover 后的连续点击保持 hover 状态）
    this._hoverPanelActive = false;
    
    // 跟踪上一步动作名称（用于优化连续操作）
    this._lastAction = null;

    // 初始化视觉上下文管理器（配置延迟到 activate 时）
    this.visualContext = null;

    // 初始化执行确认机制
    this.confirmation = new ExecutionConfirmation({
      mode: options.configManager?.get('copilot.confirmationMode') || 'auto' // auto | manual | hybrid
    });

    // 存储执行上下文（用于截图对比）
    this.executionContext = {
      beforeScreenshot: null,
      afterScreenshot: null,
      lastDecision: null
    };

    // 是否跳过消息订阅（由 CopilotManager 分发）
    this.skipMessageSubscription = options.skipMessageSubscription || false;

    // 任务取消标志
    this._cancelled = false;

    // 加载配置
    this._loadConfig();
  }

  /**
   * 加载配置
   */
  _loadConfig() {
    if (this.configManager) {
      const copilotConfig = this.configManager.get('copilot');
      if (copilotConfig) {
        this.config = { ...this.config, ...copilotConfig };
      }
    }
  }

  /**
   * 获取当前窗口的活动视图 webContents
   */
  getActiveViewWebContents() {
    // 如果是主窗口
    if (this.windowId === 'main') {
      const viewData = this.core?.getActiveView();
      return viewData?.view?.webContents || null;
    }

    // 分离窗口
    let detachedWindow = this.core?.detachedWindows?.get(this.windowId);
    if (!detachedWindow && !isNaN(this.windowId)) {
      detachedWindow = this.core?.detachedWindows?.get(Number(this.windowId));
    }
    if (!detachedWindow) {
      detachedWindow = this.core?.detachedWindows?.get(String(this.windowId));
    }

    const activeView = detachedWindow?.tabManager?.getActiveView();
    return activeView?.view?.webContents || null;
  }

  /**
   * 激活 Copilot
   * 根据 AI 服务配置自动初始化视觉上下文
   */
  async activate() {
    // 初始化视觉上下文管理器（根据 AI 服务模式自动选择）
    if (!this.visualContext) {
      const isLocalOpenClaw = this.aiServiceManager?.isLocalOpenClaw ?? true;

      if (isLocalOpenClaw) {
        // 本地 OpenClaw：启动 HTTP 服务提供截图
        console.log(`[WindowCopilot:${this.windowId}] Local OpenClaw mode - starting screenshot server`);
        this.visualContext = new VisualContextManager({
          transferMode: 'server',
          serverPort: 0  // 随机端口
        });

        // 启动 HTTP 服务
        try {
          const { port, token } = await this.visualContext.startServer();
          console.log(`[WindowCopilot:${this.windowId}] Screenshot server started on port ${port}`);
        } catch (err) {
          console.error(`[WindowCopilot:${this.windowId}] Failed to start screenshot server:`, err);
          // 回退到文件模式
          this.visualContext = new VisualContextManager({ transferMode: 'file' });
        }
      } else {
        // 远程 OpenClaw：直连 Kimi，无需 HTTP 服务
        console.log(`[WindowCopilot:${this.windowId}] Remote mode - using Kimi direct connection`);
        this.visualContext = new VisualContextManager({
          transferMode: 'file'  // 只需保存临时文件，Base64 发送给 Kimi
        });
      }
    }

    if (this.aiServiceManager) {
      this._setupAIMessageHandler();
    }
    this._emitToWindow(COPILOT_EVENTS.ACTIVATED, { windowId: this.windowId });
  }

  /**
   * 设置 AI 消息处理器
   */
  _setupAIMessageHandler() {
    // 如果跳过消息订阅，由 CopilotManager 分发消息
    if (this.skipMessageSubscription) {
      console.log(`[WindowCopilot:${this.windowId}] Skipping direct message subscription`);
      return;
    }

    // 如果已订阅，先取消
    if (this.unsubscribeAI) {
      this.unsubscribeAI();
    }

    // 订阅 AI 消息
    this.unsubscribeAI = this.aiServiceManager.onMessage((data) => {
      this._handleAIMessage(data);
    });
  }

  /**
   * 发送事件到当前窗口（仅当前窗口接收）
   */
  _emitToWindow(eventName, data) {
    // 添加窗口ID标识
    const payload = { ...data, windowId: this.windowId };

    if (this.windowId === 'main') {
      this.core?.sendToRenderer?.(eventName, payload);
      return;
    }

    // 分离窗口 - 尝试数字和字符串两种 key
    let detachedWindow = this.core?.detachedWindows?.get(this.windowId);
    if (!detachedWindow && !isNaN(this.windowId)) {
      detachedWindow = this.core?.detachedWindows?.get(Number(this.windowId));
    }
    if (!detachedWindow) {
      detachedWindow = this.core?.detachedWindows?.get(String(this.windowId));
    }

    detachedWindow?.windowManager?.sendToRenderer?.(eventName, payload);
  }

  /**
   * 发送 OpenClaw 兼容事件到当前窗口
   */
  _emitOpenClawEvent(eventName, data) {
    const payload = { ...data, windowId: this.windowId };

    if (this.windowId === 'main') {
      this.core?.sendToRenderer?.(eventName, payload);
      return;
    }

    // 分离窗口 - 尝试数字和字符串两种 key
    let detachedWindow = this.core?.detachedWindows?.get(this.windowId);
    if (!detachedWindow && !isNaN(this.windowId)) {
      detachedWindow = this.core?.detachedWindows?.get(Number(this.windowId));
    }
    if (!detachedWindow) {
      detachedWindow = this.core?.detachedWindows?.get(String(this.windowId));
    }

    detachedWindow?.windowManager?.sendToRenderer?.(eventName, payload);
  }

  /**
   * 处理 AI 消息
   */
  _handleAIMessage(data) {
    const payload = data.payload || {};

    // 检查消息是否属于当前窗口
    const messageSessionKey = payload.sessionKey || '';
    const expectedSessionKey = `agent:window:${this.windowId}`;

    if (messageSessionKey && messageSessionKey !== expectedSessionKey) {
      return;
    }

    // 发送 openclaw:message 兼容事件
    this._emitOpenClawEvent('openclaw:message', data);

    // 处理 Kimi 直连模式的消息格式 (type: 'message')
    if (data.type === 'message' && payload.message) {
      const text = this._extractText(payload.message);
      if (text) {
        this._handleAIResponse(text);
      }
      return;
    }

    // 处理错误消息
    if (data.type === 'error') {
      const errorMsg = payload.error || '未知错误';
      this._emitToWindow(COPILOT_EVENTS.MESSAGE, {
        text: `AI 服务错误: ${errorMsg}`
      });
      return;
    }

    // 处理 OpenClaw 的流式消息格式
    if (data.event !== 'chat') return;

    if (payload.state === 'delta') {
      const deltaContent = payload.delta || payload.message;
      const text = this._extractText(deltaContent);
      if (text) {
        this._emitToWindow(COPILOT_EVENTS.STREAM, { text });
      }
    } else if (payload.state === 'final' && payload.message) {
      const text = this._extractText(payload.message);
      this._handleAIResponse(text);
    }
  }

  /**
   * 处理 AI 消息（由 CopilotManager 调用）
   */
  handleMessage(data) {
    return this._handleAIMessage(data);
  }

  /**
   * 提取文本内容
   */
  _extractText(message) {
    if (typeof message === 'string') return message;
    if (message.content) {
      if (Array.isArray(message.content)) {
        return message.content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('');
      }
      return message.content;
    }
    return '';
  }

  /**
   * 处理 AI 响应
   */
  async _handleAIResponse(text) {
    // 【取消检查】如果任务被取消，忽略此响应
    if (this._cancelled) {
      console.log(`[WindowCopilot:${this.windowId}] Ignoring AI response, task was cancelled`);
      return;
    }

    // 【调试日志】记录 AI 返回的原始内容
    console.log(`\n========== [DEBUG] AI Response (${this.aiServiceManager?.isLocalOpenClaw ? 'Local' : 'Cloud'}) ==========`);
    console.log(`Mode: ${this.mode}`);
    console.log(`Text length: ${text?.length || 0}`);
    console.log(`Text preview (first 800 chars):`);
    console.log(text?.substring(0, 800) || '(EMPTY)');
    console.log('========== [DEBUG] End AI Response ==========\n');

    // 【再次检查】添加到历史前检查（处理异步到达的情况）
    if (this._cancelled) {
      console.log(`[WindowCopilot:${this.windowId}] Task cancelled before adding to history`);
      return;
    }

    // 添加到对话历史
    this._addToHistory('assistant', text);

    // 【再次检查】处理前检查
    if (this._cancelled) {
      console.log(`[WindowCopilot:${this.windowId}] Task cancelled before processing response`);
      return;
    }

    if (this.mode === 'chat') {
      await this._handleChatResponse(text);
    } else if (this.mode === 'action') {
      await this._handleActionResponse(text);
    }
  }

  /**
   * 添加到对话历史
   */
  _addToHistory(role, content) {
    this.conversationHistory.push({ role, content, timestamp: Date.now() });
    // 限制历史长度
    if (this.conversationHistory.length > 50) {
      this.conversationHistory = this.conversationHistory.slice(-50);
    }
  }

  /**
   * 处理对话模式响应
   */
  async _handleChatResponse(text) {
    // 支持 @action: 和 @siliu: 两种格式
    const actionMatch = text.match(/@(action|siliu):\s*(.+?)(?:\n|$)/);

    if (actionMatch) {
      const chatText = text.split(/@(action|siliu):/)[0].trim();
      if (chatText) {
        this._emitToWindow(COPILOT_EVENTS.MESSAGE, { text: chatText });
      }
      // 使用用户的原始完整任务，而不是 @action: 后面的简短描述
      const userTask = this._getLastUserTask() || actionMatch[2].trim();
      await this._startActionMode(userTask);
    } else {
      this._emitToWindow(COPILOT_EVENTS.MESSAGE, { text });
    }
  }

  /**
   * 获取最后一次用户发送的完整任务
   */
  _getLastUserTask() {
    // 从对话历史中查找最后一条用户消息
    for (let i = this.conversationHistory.length - 1; i >= 0; i--) {
      if (this.conversationHistory[i].role === 'user') {
        return this.conversationHistory[i].content;
      }
    }
    return null;
  }

  /**
   * 获取评论内容（用于智能选择表情）
   * 从对话历史中查找 AI 输入的评论文本
   */
  _getCommentContext() {
    // 从对话历史中查找最后一条 assistant 消息中包含 type 操作的内容
    for (let i = this.conversationHistory.length - 1; i >= 0; i--) {
      const entry = this.conversationHistory[i];
      if (entry.role === 'assistant') {
        // 尝试从 JSON 操作中提取 type 的文本
        const typeMatch = entry.content.match(/"action":\s*"type"[^}]*"text":\s*"([^"]+)"/);
        if (typeMatch) {
          return typeMatch[1];
        }
        // 也尝试匹配其他格式
        const textMatch = entry.content.match(/type.*输入评论|评论.*输入|输入.*"([^"]+)"/);
        if (textMatch) {
          return textMatch[1] || '';
        }
      }
    }
    return '';
  }

  /**
   * 发送用户消息
   */
  async sendMessage(text) {
    console.log(`[WindowCopilot:${this.windowId}] sendMessage called`);
    console.log(`[WindowCopilot:${this.windowId}] aiServiceManager exists:`, !!this.aiServiceManager);
    console.log(`[WindowCopilot:${this.windowId}] Current mode:`, this.mode);
    console.log(`[WindowCopilot:${this.windowId}] isExecuting:`, this.isExecuting);

    const isConnected = this.aiServiceManager?.isConnected();
    console.log(`[WindowCopilot:${this.windowId}] isConnected:`, isConnected);

    if (!isConnected) {
      console.log(`[WindowCopilot:${this.windowId}] Not connected, returning error`);
      this._emitToWindow(COPILOT_EVENTS.MESSAGE, {
        text: 'AI 服务未连接，请先配置并连接。'
      });
      return;
    }

    // 【简化打断】如果正在执行任务，直接取消，让AI判断下一步
    if (this.isExecuting) {
      console.log(`[WindowCopilot:${this.windowId}] Auto-cancelling current task for new message`);
      await this.cancelTask('用户发送新消息');
      // 不再发送默认提示，让AI自己回复
    }

    // 添加到对话历史
    this._addToHistory('user', text);

    // 显示"与AI沟通"状态
    this._emitToWindow(COPILOT_EVENTS.THINKING, {
      text: text,
      windowId: this.windowId
    });

    // 构建带上下文的提示词
    const prompt = this._buildPromptWithContext(text);

    try {
      await this.aiServiceManager.sendMessage(prompt, {
        sessionKey: `agent:window:${this.windowId}`
      });
    } catch (err) {
      console.error(`[WindowCopilot:${this.windowId}] Send failed:`, err);
      this._emitToWindow(COPILOT_EVENTS.MESSAGE, {
        text: `发送失败: ${err.message}`
      });
    }
  }

  /**
   * 切换 Agent
   * @param {string} agentId - Agent ID
   */
  switchAgent(agentId) {
    const success = this.agentRegistry.switchTo(agentId);
    if (success) {
      console.log(`[WindowCopilot:${this.windowId}] Switched to agent: ${agentId}`);
      this._emitToWindow(COPILOT_EVENTS.AGENT_CHANGED, { 
        agentId, 
        agentInfo: this.agentRegistry.getCurrent() 
      });
    }
    return success;
  }

  /**
   * 获取当前 Agent
   */
  getCurrentAgent() {
    return this.agentRegistry.getCurrent();
  }

  /**
   * 构建带意图判断的提示词
   * 改造后：使用 AgentRegistry 构建 Prompt
   */
  _buildPromptWithContext(currentMessage) {
    // 【新】使用 AgentRegistry 构建 Chat Prompt
    const context = {
      userMessage: currentMessage,
      isExecuting: this.isExecuting,
      currentTask: this.currentTask,
      conversationHistory: this.conversationHistory
    };
    
    return this.agentRegistry.buildPrompt('chat', context);
  }

  /**
   * 开始动作模式
   */
  async _startActionMode(task) {
    console.log(`[WindowCopilot:${this.windowId}] Starting action mode:`, task);

    if (!this.aiServiceManager?.isConnected()) {
      console.error(`[WindowCopilot:${this.windowId}] AI not connected`);
      this._emitToWindow(COPILOT_EVENTS.MESSAGE, {
        text: 'AI 服务未连接'
      });
      return;
    }

    this.mode = 'action';
    this.isExecuting = true;
    this.currentTask = task;
    this.stepCount = 0;
    this.memory = { history: [], findings: [] };

    this._emitToWindow(COPILOT_EVENTS.TASK_START, { task, windowId: this.windowId });

    // 显示"与AI沟通"状态
    this._emitToWindow(COPILOT_EVENTS.THINKING, {
      task: task,
      message: '正在分析任务...',
      windowId: this.windowId
    });

    try {
      const observation = await this._observePage();

      // 检查是否成功获取页面
      if (observation.error) {
        this._emitToWindow(COPILOT_EVENTS.MESSAGE, {
          text: `无法获取页面信息: ${observation.error}`
        });
        this._resetState();
        return;
      }

      const prompt = this.promptBuilder.buildActionPrompt(
        task, observation, null, this.stepCount, this.memory?.history
      );

      await this.aiServiceManager.sendMessage(prompt, {
        sessionKey: `agent:window:${this.windowId}`
      });
    } catch (err) {
      this._emitToWindow(COPILOT_EVENTS.MESSAGE, {
        text: `无法启动任务: ${err.message}`
      });
      this._resetState();
    }
  }

  /**
   * 让 shell 窗口失焦，并将焦点转移到 BrowserView
   */
  async _blurShellInput() {
    try {
      // 只让 shell 中的输入框失焦，不要调用 focus() 避免窗口抢焦点
      let shellWebContents;
      if (this.windowId === 'main') {
        shellWebContents = this.core?.window?.webContents;
      } else {
        const detachedWindow = this.core?.detachedWindows?.get(this.windowId) ||
                               this.core?.detachedWindows?.get(Number(this.windowId)) ||
                               this.core?.detachedWindows?.get(String(this.windowId));
        shellWebContents = detachedWindow?.window?.webContents;
      }

      if (shellWebContents) {
        await shellWebContents.executeJavaScript(`
          (function() {
            // 让地址栏失焦
            const addressInput = document.getElementById('address-input');
            if (addressInput) addressInput.blur();
            // 让 Copilot 聊天输入框失焦
            const chatInput = document.getElementById('chat-input');
            if (chatInput) chatInput.blur();
            // 让 body 获取焦点（清除所有输入框焦点）
            document.body && document.body.focus();
          })()
        `);
      }
    } catch (err) {
      // 忽略错误，不影响主流程
      console.log(`[WindowCopilot:${this.windowId}] blurShellInput failed (non-critical):`, err.message);
    }
  }

  /**
   * 获取所有标签页信息
   */
  async _getTabsInfo() {
    try {
      if (!this.core?.tabManager) {
        return [];
      }
      
      const allViews = this.core.tabManager.getAllViews();
      const activeViewId = this.core.tabManager.getActiveViewId();
      
      return allViews.map((view, index) => ({
        index: index,
        id: view.id,
        title: view.title || '无标题',
        url: view.url || '',
        isActive: view.id === activeViewId
      }));
    } catch (err) {
      console.error(`[WindowCopilot:${this.windowId}] Failed to get tabs info:`, err.message);
      return [];
    }
  }

  /**
   * 观察页面状态（增强版 - 获取详细 DOM 信息）
   */
  async _observePage() {
    const webContents = this.getActiveViewWebContents();
    if (!webContents) {
      return { error: '无法获取页面' };
    }

    // 使用 executeJavaScript 在当前窗口的视图中执行
    const withTimeout = (promise, name, timeoutMs) => {
      return Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`${name} timeout`)), timeoutMs)
        )
      ]).catch(err => ({ error: err.message }));
    };

    // 1. 基础页面信息
    const [url, title] = await Promise.all([
      withTimeout(webContents.executeJavaScript('window.location.href'), 'url', 5000),
      withTimeout(webContents.executeJavaScript('document.title'), 'title', 5000)
    ]);

    // 2. 获取可交互元素列表（增强版 - 带完整定位信息和上下文）
    const interactiveElements = await withTimeout(
      webContents.executeJavaScript(`(function() {
        const selectors = [
          // 基础交互元素
          'button', 'a[href]', 'input', 'textarea', 'select', 'label',
          '[role="button"]', '[role="link"]', '[role="menuitem"]', 
          '[onclick]', '[tabindex]:not([tabindex="-1"])',
          
          // 抖音/视频类网站
          '[data-e2e]', '[class*="card"]', '[class*="video"]', '[class*="item"]',
          '[class*="like"]', '[class*="heart"]', '[class*="thumb"]',
          'video', '[class*="player"]', '[class*="shorts"]', '[class*="reels"]',
          
          // 通用可点击元素
          '[class*="btn"]', '[class*="button"]', '[class*="link"]',
          '[class*="clickable"]', '[class*="action"]', '[class*="oper"]',
          
          // 小红书/Instagram等
          '[class*="note"]', '[class*="post"]', '[class*="feed"]', 
          '[class*="content"]', '[class*="article"]',
          
          // 豆瓣/电影类网站
          '[class*="movie"]', '[class*="film"]', '[class*="book"]',
          '[class*="rank"]', '[class*="top"]', '[class*="chart"]',
          
          // 电商类（淘宝/京东/亚马逊等）
          '[class*="product"]', '[class*="goods"]', '[class*="sku"]', 
          '[class*="shop"]', '[class*="store"]', '[class*="price"]',
          '[class*="buy"]', '[class*="cart"]', '[class*="order"]',
          '[class*="search-result"]', '[class*="recommend"]',
          
          // 新闻/博客类
          '[class*="news"]', '[class*="blog"]', '[class*="story"]',
          '[class*="headline"]', '[class*="title"]', '[class*="summary"]',
          '[class*="excerpt"]', 'article', '[class*="media"]',
          
          // 列表/网格类
          'li', '[class*="list-item"]', '[class*="entry"]',
          '[class*="grid-item"]', '[class*="cell"]', '[class*="row"]',
          '[class*="col"]', '[class*="tile"]', '[class*="box"]',
          
          // 导航/菜单
          'nav a', '[class*="nav"]', '[class*="menu"]', '[class*="tab"]',
          '[class*="breadcrumb"]', '[class*="pagination"]', '[class*="pager"]',
          '[class*="dropdown"]', '[class*="sidebar"]', '[class*="header"]',
          
          // 表格数据
          'table', 'tr', 'td', 'th', '[class*="table"]', '[class*="data"]',
          '[class*="cell"]', '[class*="row"]', '[class*="column"]',
          
          // 图片/媒体容器
          'img', 'figure', '[class*="image"]', '[class*="pic"]', 
          '[class*="photo"]', '[class*="gallery"]', '[class*="album"]',
          '[class*="cover"]', '[class*="thumbnail"]', '[class*="avatar"]',
          
          // 评论/互动
          '[class*="comment"]', '[class*="reply"]', '[class*="review"]',
          '[class*="rating"]', '[class*="score"]', '[class*="star"]',
          '[class*="vote"]', '[class*="favorite"]', '[class*="collect"]',
          '[class*="share"]', '[class*="download"]', '[class*="print"]',
          
          // 用户信息
          '[class*="user"]', '[class*="author"]', '[class*="profile"]',
          '[class*="member"]', '[class*="account"]', '[class*="login"]',
          '[class*="register"]', '[class*="signup"]',
          
          // 标签/分类
          '[class*="tag"]', '[class*="category"]', '[class*="label"]',
          '[class*="badge"]', '[class*="chip"]', '[class*="pill"]',
          
          // 时间/日期
          '[class*="time"]', '[class*="date"]', '[class*="datetime"]',
          '[class*="timestamp"]', '[class*="published"]', '[class*="updated"]',
          
          // 加载更多/分页
          '[class*="load-more"]', '[class*="loadmore"]', '[class*="show-more"]',
          '[class*="expand"]', '[class*="collapse"]', '[class*="toggle"]',
          '[class*="next"]', '[class*="prev"]', '[class*="previous"]',
          '[class*="first"]', '[class*="last"]'
        ];
        const elements = [];
        const seen = new Set();
        const elementMap = new Map(); // 用于快速查找索引

        // 获取完整 DOM 路径
        function getFullPath(el) {
          if (!el) return '';
          const path = [];
          let current = el;
          while (current && current.nodeType === 1 && current.tagName !== 'BODY') {
            let tag = current.tagName.toLowerCase();
            if (current.id) {
              path.unshift('#' + current.id);
              break;
            } else if (current.className) {
              const className = current.className.split(/\s+/).filter(c => c).join('.');
              if (className) tag += '.' + className;
            }
            path.unshift(tag);
            current = current.parentElement;
          }
          return path.join(' > ');
        }

        function getXPath(el) {
          if (!el) return '';
          if (el.id) return '//' + el.tagName.toLowerCase() + '[@id="' + el.id + '"]'];
          let path = '';
          let current = el;
          while (current && current.nodeType === 1) {
            let tag = current.tagName.toLowerCase();
            let index = 1;
            let sibling = current.previousElementSibling;
            while (sibling) {
              if (sibling.tagName.toLowerCase() === tag) index++;
              sibling = sibling.previousElementSibling;
            }
            path = '/' + tag + '[' + index + ']' + path;
            current = current.parentElement;
          }
          return path;
        }

        function getSelector(el) {
          if (el.id) return '#' + el.id;
          if (el.className) {
            const classes = el.className.split(/\s+/).filter(x => x);
            // 优先选择稳定的类名（不包含随机字符串）
            const stableClass = classes.find(c => 
              !/[a-f0-9]{8,}/i.test(c) && // 排除 hash 类名
              c.length > 3 &&              // 排除太短
              !/^\d+$/.test(c)            // 排除纯数字
            );
            if (stableClass) return el.tagName.toLowerCase() + '.' + stableClass;
            // 回退到第一个类名
            if (classes[0]) return el.tagName.toLowerCase() + '.' + classes[0];
          }
          return el.tagName.toLowerCase();
        }

        function getElementSignature(el) {
          const tag = el.tagName.toLowerCase();
          const text = (el.innerText || el.textContent || '').trim().substring(0, 30);
          const placeholder = el.placeholder || '';
          const ariaLabel = el.getAttribute('aria-label') || '';
          return { tag, text, placeholder, ariaLabel };
        }

        // 第一遍：收集所有元素基础信息
        document.querySelectorAll(selectors.join(',')).forEach((el, idx) => {
          if (seen.has(el)) return;
          seen.add(el);
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

          let text = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
            ? (el.placeholder || el.value || '')
            : (el.innerText || el.textContent || el.getAttribute('aria-label') || '');
          text = text.trim().substring(0, 50);

          const elementInfo = {
            index: idx,
            tag: el.tagName.toLowerCase(),
            type: el.type || '',
            text: text,
            selector: getSelector(el),
            xpath: getXPath(el),
            path: getFullPath(el),
            id: el.id || '',
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
            disabled: el.disabled,
            // 增强信息
            visible: true,
            placeholder: el.placeholder || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            role: el.getAttribute('role') || '',
            dataTestId: el.getAttribute('data-testid') || el.getAttribute('data-e2e') || '',
            className: el.className || '',
            // 表单相关
            name: el.name || '',
            value: el.tagName === 'INPUT' ? (el.value || '') : '',
            // 计算样式（用于判断可交互性）
            cursor: style.cursor,
            pointerEvents: style.pointerEvents
          };
          
          elements.push(elementInfo);
          elementMap.set(el, idx);
        });

        // 第二遍：添加相邻元素信息（用于相对定位）
        elements.forEach((info, idx) => {
          // 查找原始 DOM 元素
          const el = document.querySelectorAll(selectors.join(','))[idx];
          if (!el) return;

          // 获取可见的相邻元素
          const getVisibleNeighbor = (direction) => {
            const allElements = Array.from(document.querySelectorAll(selectors.join(',')));
            const currentIdx = allElements.indexOf(el);
            if (currentIdx === -1) return null;
            
            const neighbors = [];
            // 上方元素
            if (direction === 'above' || direction === 'nearby') {
              for (let i = currentIdx - 1; i >= 0; i--) {
                const neighbor = allElements[i];
                const neighborRect = neighbor.getBoundingClientRect();
                const neighborStyle = window.getComputedStyle(neighbor);
                if (neighborStyle.display === 'none' || neighborStyle.visibility === 'hidden') continue;
                
                const sig = getElementSignature(neighbor);
                neighbors.push({
                  index: elementMap.get(neighbor),
                  ...sig,
                  distance: Math.abs(rect.y - neighborRect.y)
                });
                if (neighbors.length >= 2) break;
              }
            }
            // 下方元素
            if (direction === 'below' || direction === 'nearby') {
              for (let i = currentIdx + 1; i < allElements.length; i++) {
                const neighbor = allElements[i];
                const neighborRect = neighbor.getBoundingClientRect();
                const neighborStyle = window.getComputedStyle(neighbor);
                if (neighborStyle.display === 'none' || neighborStyle.visibility === 'hidden') continue;
                
                const sig = getElementSignature(neighbor);
                neighbors.push({
                  index: elementMap.get(neighbor),
                  ...sig,
                  distance: Math.abs(neighborRect.y - rect.y)
                });
                if (neighbors.length >= 4) break;
              }
            }
            return neighbors.slice(0, 3); // 最多3个相邻元素
          };

          const rect = el.getBoundingClientRect();
          info.neighbors = {
            above: getVisibleNeighbor('above'),
            below: getVisibleNeighbor('below')
          };
        });

        return elements.slice(0, 50);
      })()`),
      'elements', 10000
    );

    const pageInfo = {
      url: url || '',
      title: title || '无法获取标题',
      elements: Array.isArray(interactiveElements) ? interactiveElements : []
    };

    // 检测登录状态
    const loginStatus = this.loginDetector.detect(pageInfo);
    if (loginStatus.needsLogin && loginStatus.confidence > 0.6) {
      this._emitToWindow(COPILOT_EVENTS.LOGIN_REQUIRED, {
        message: loginStatus.message,
        platform: loginStatus.platform
      });
    }
    pageInfo.loginStatus = loginStatus;

    // 检测页面是否有登录/扫码提示
    const hasLoginHint = await withTimeout(
      webContents.executeJavaScript(`
        (function() {
          const text = document.body.innerText;
          const loginKeywords = ['登录', '扫码', '二维码', '请登录', '请先登录', '授权', '请扫码'];
          return loginKeywords.some(k => text.includes(k));
        })()
      `),
      'loginCheck', 3000
    );
    pageInfo.hasLoginHint = !!hasLoginHint;

    // 【新增】获取页面完整 HTML（截断到 10000 字符）
    try {
      const htmlResult = await withTimeout(
        webContents.executeJavaScript(`
          (function() {
            const html = document.documentElement.outerHTML;
            return html.substring(0, 10000) + (html.length > 10000 ? '\n... [HTML 截断，总长度: ' + html.length + ']' : '');
          })()
        `),
        'html', 5000
      );
      pageInfo.html = typeof htmlResult === 'string' ? htmlResult : String(htmlResult || '');
    } catch (e) {
      pageInfo.html = '';
    }

    // 【新】使用当前 Agent 处理页面观察（优化元素提取）
    const processedPageInfo = this.agentRegistry.processObservation(pageInfo);

    return processedPageInfo;
  }

  /**
   * 视觉 + DOM 观察（截图 + 页面信息）
   * 自动根据 AI 服务模式选择传输方式
   */
  async _observePageVisual() {
    const webContents = this.getActiveViewWebContents();
    if (!webContents) {
      return { error: '无法获取页面' };
    }

    try {
      // 1. 先获取 DOM 信息和视口尺寸
      const domInfo = await this._observePage();
      
      // 【关键】获取实际视口尺寸，用于坐标校准
      const viewportInfo = await webContents.executeJavaScript(`
        (function() {
          return {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
            scrollX: window.scrollX,
            scrollY: window.scrollY
          };
        })()
      `);
      
      console.log(`[WindowCopilot:${this.windowId}] Viewport: ${viewportInfo.width}x${viewportInfo.height}, DPR: ${viewportInfo.devicePixelRatio}`);

      // 2. 清理之前的截图
      if (this.currentScreenshot) {
        if (this.currentScreenshot.path) {
          await this.visualContext.cleanup(this.currentScreenshot.path);
        }
        this.currentScreenshot = null;
      }

      // 3. 根据 AI 服务模式捕获截图
      const isLocalOpenClaw = this.aiServiceManager?.isLocalOpenClaw ?? true;
      let screenshot;

      if (isLocalOpenClaw) {
        // 本地 OpenClaw：使用 HTTP 服务提供截图
        console.log(`[WindowCopilot:${this.windowId}] Capturing screenshot for local OpenClaw`);
        screenshot = await this.visualContext.captureAndServe(webContents);
        console.log(`[WindowCopilot:${this.windowId}] Screenshot served at: ${screenshot.url}`);
      } else {
        // 远程模式：保存为临时文件，稍后会读取为 Base64 发送给 Kimi
        console.log(`[WindowCopilot:${this.windowId}] Capturing screenshot for Kimi direct`);
        screenshot = await this.visualContext.captureToFile(webContents);
        console.log(`[WindowCopilot:${this.windowId}] Screenshot saved: ${screenshot.width}x${screenshot.height}`);
      }

      // 【关键】保存视口信息用于坐标校准
      screenshot.viewport = viewportInfo;
      this.currentScreenshot = screenshot;

      // 【关键】获取所有标签页信息，供 AI 参考
      const tabsInfo = await this._getTabsInfo();
      
      return {
        ...domInfo,
        screenshot,
        hasVisual: true,
        viewport: viewportInfo,  // 传递给 AI 作为坐标参考
        tabs: tabsInfo  // 标签页信息
      };
    } catch (err) {
      console.error(`[WindowCopilot:${this.windowId}] Visual observation failed:`, err);
      // 回退到纯 DOM 模式
      return this._observePage();
    }
  }

  /**
   * 获取当前窗口的 TabManager
   */
  _getCurrentTabManager() {
    if (this.windowId === 'main') {
      return this.core?.tabManager;
    }

    // 分离窗口
    let detachedWindow = this.core?.detachedWindows?.get(this.windowId);
    if (!detachedWindow && !isNaN(this.windowId)) {
      detachedWindow = this.core?.detachedWindows?.get(Number(this.windowId));
    }
    if (!detachedWindow) {
      detachedWindow = this.core?.detachedWindows?.get(String(this.windowId));
    }

    return detachedWindow?.tabManager || this.core?.tabManager;
  }

  /**
   * 获取当前窗口的活动视图 webContents
   */
  getActiveViewWebContents() {
    // 使用当前窗口的 TabManager
    const tabManager = this._getCurrentTabManager();
    const activeView = tabManager?.getActiveView();
    return activeView?.view?.webContents || null;
  }

  /**
   * 执行操作（使用 SiliuController）
   */
  async _executeStep(decision) {
    // 【取消检查】如果任务被取消，立即退出
    if (this._cancelled) {
      console.log(`[WindowCopilot:${this.windowId}] Step execution cancelled`);
      return { success: false, error: '任务已取消', cancelled: true };
    }

    console.log(`[WindowCopilot:${this.windowId}] _executeStep: ${decision.action}, controller exists: ${!!this.controller}`);

    const actionNames = {
      navigate: '导航',
      click: '点击',
      type: '输入',
      scroll: '滚动',
      screenshot: '截图',
      get_content: '获取内容',
      yes: '确认',
      no: '重试'
    };
    const actionName = actionNames[decision.action] || decision.action;
    const stepNum = this.stepCount + 1;

    // 优先使用 SiliuController（支持 CDP/JS 双模式 + Toast）
    if (this.controller) {
      let stepResult;
      let actualMode = 'JS';

      // 发送步骤开始事件（触发 toast 显示当前操作）
      // 确保 description 不为空
      const actionNames = {
        navigate: '正在导航到网站页面',
        click: '点击页面元素',
        type: '正在输入文本',
        scroll: '正在滚动查看页面',
        wheel: '正在滚动滚轮',
        wait: '等待中',
        press: '按键中',
        screenshot: '正在获取页面截图',
        get_content: '正在读取页面内容',
        yes: '确认继续',
        no: '取消操作'
      };
      const defaultDesc = actionNames[decision.action] || `正在执行: ${decision.action}`;
      const description = decision.description || decision.reason || defaultDesc;
      
      this._emitToWindow(COPILOT_EVENTS.STEP_START, {
        step: stepNum,
        action: decision.action,
        description,
        mode: 'CDP'
      });

      // 保存原始方法引用
      const originalGetActiveWebContents = this.controller._getActiveWebContents.bind(this.controller);
      const originalGetActiveTargetId = this.controller._getActiveTargetId?.bind(this.controller);
      const originalEnsureCDP = this.controller._ensureCDPConnectedToActive?.bind(this.controller);

      try {
        // 临时覆盖 controller 的方法
        this.controller._getActiveWebContents = () => {
          return this.getActiveViewWebContents();
        };

        this.controller._getActiveTargetId = async () => {
          const activeView = this._getCurrentTabManager()?.getActiveView();
          if (!activeView?.view?.webContents) {
            return null;
          }

          const wc = activeView.view.webContents;
          const wcUrl = wc.getURL();

          try {
            const targets = await this.controller.cdpController.cdp.listTargets();
            let target = targets.find(t => t.url === wcUrl && t.type === 'page');
            if (!target) {
              const title = wc.getTitle();
              target = targets.find(t => t.title === title && t.type === 'page');
            }
            if (!target) {
              target = targets.find(t => !t.url.includes('devtools') && t.type === 'page');
            }
            return target?.id || null;
          } catch (err) {
            console.error('[WindowCopilot] Failed to get active target:', err.message);
            return null;
          }
        };

        // 覆盖 _ensureCDPConnectedToActive 以确保它使用我们覆盖的 _getActiveTargetId
        this.controller._ensureCDPConnectedToActive = async () => {
          if (!this.controller.cdpController?.cdp) {
            return false;
          }

          try {
            // 使用覆盖后的 _getActiveTargetId
            const targetId = await this.controller._getActiveTargetId();
            if (!targetId) {
              console.log('[WindowCopilot] No active target found');
              return false;
            }

            // 如果已经连接到正确的 target，直接返回
            if (this.controller.cdpController.cdp.targetId === targetId && this.controller.cdpController.isConnected) {
              console.log('[WindowCopilot] CDP already connected to correct target:', targetId);
              return true;
            }

            // 需要重新连接
            console.log('[WindowCopilot] Switching CDP to target:', targetId);

            // 断开当前连接
            this.controller.cdpController.cdp.disconnect();

            // 连接到新的 target
            await this.controller.cdpController.cdp.connect(targetId);

            console.log('[WindowCopilot] CDP switched successfully');
            return true;
          } catch (err) {
            console.error('[WindowCopilot] Failed to switch CDP target:', err.message);
            return false;
          }
        };

        // 强制重新连接 CDP 到当前活动标签页
        const switched = await this.controller._ensureCDPConnectedToActive();
        console.log(`[WindowCopilot:${this.windowId}] CDP switch result:`, switched);

        // ===== 执行前验证 =====
        if (decision.action === 'click' || decision.action === 'type') {
          const target = decision.target?.selector || decision.selector || decision.target;
          if (target && target.type !== 'coordinate' && target.x === undefined) {
            console.log(`[WindowCopilot:${this.windowId}] Pre-execution verification for ${decision.action}...`);
            const verifyResult = await this._verifyElementBeforeAction(target, decision.action);
            
            if (!verifyResult.exists) {
              console.log(`[WindowCopilot:${this.windowId}] Element not found, trying alternative strategies...`);
              const alternative = await this._findAlternativeTarget(target, decision);
              
              if (alternative) {
                console.log(`[WindowCopilot:${this.windowId}] Found alternative target:`, alternative);
                // 更新 decision 使用替代目标
                if (decision.target) {
                  decision.target = alternative;
                } else {
                  decision.selector = alternative.selector || alternative.xpath;
                }
              } else {
                console.error(`[WindowCopilot:${this.windowId}] No alternative found for target:`, target);
                // 发送失败事件，让 AI 有机会重试
                this._emitToWindow(COPILOT_EVENTS.STEP_START, {
                  step: stepNum,
                  action: decision.action,
                  description: `${description} (目标元素不存在)`,
                  mode: 'JS'
                });
                return { success: false, error: `目标元素不存在且找不到替代: ${JSON.stringify(target)}`, needRetry: true };
              }
            } else if (verifyResult.exists && !verifyResult.visible) {
              console.log(`[WindowCopilot:${this.windowId}] Element exists but not visible, attempting to scroll into view...`);
              await this._scrollElementIntoView(target);
            }
          }
        }
        // ======================

        switch (decision.action) {
          case 'navigate': {
            console.log(`[WindowCopilot:${this.windowId}] Calling controller.navigate...`);
            const { result, mode } = await this.controller.navigate(decision.url);
            console.log(`[WindowCopilot:${this.windowId}] navigate returned mode: ${mode}`);
            stepResult = result;
            actualMode = mode;
            // 智能等待页面加载
            await this._smartWait('navigate');
            break;
          }
          case 'goBack': {
            console.log(`[WindowCopilot:${this.windowId}] Calling controller.goBack...`);
            const { result, mode } = await this.controller.goBack();
            console.log(`[WindowCopilot:${this.windowId}] goBack returned mode: ${mode}`);
            stepResult = result;
            actualMode = mode;
            await this._smartWait('navigate');
            break;
          }
          case 'goForward': {
            console.log(`[WindowCopilot:${this.windowId}] Calling controller.goForward...`);
            const { result, mode } = await this.controller.goForward();
            console.log(`[WindowCopilot:${this.windowId}] goForward returned mode: ${mode}`);
            stepResult = result;
            actualMode = mode;
            await this._smartWait('navigate');
            break;
          }
          case 'switchTab': {
            console.log(`[WindowCopilot:${this.windowId}] Calling controller.switchTab...`);
            const { result, mode } = await this.controller.switchTab(decision.index);
            console.log(`[WindowCopilot:${this.windowId}] switchTab returned mode: ${mode}`);
            stepResult = result;
            actualMode = mode;
            await this._smartWait('navigate');
            break;
          }
          case 'click': {
            console.log(`[WindowCopilot:${this.windowId}] Calling controller.click...`);

            // 【注意】点击下拉菜单时不能 blur，否则 hover 状态会丢失
            // 只在非坐标点击（selector 点击）且可能是输入框时 blur
            const isCoordinateClick = decision.target?.type === 'coordinate' || (decision.target?.x !== undefined && decision.target?.y !== undefined);
            const isAddressBar = decision.selector?.includes('address') ||
                                 decision.selector?.includes('url') ||
                                 decision.selector?.includes('omnibox');
            
            if (!isCoordinateClick && !isAddressBar) {
              // 点击前先让 shell 窗口的输入框失焦，避免焦点冲突
              await this._blurShellInput();
            } else if (isCoordinateClick) {
              console.log(`[WindowCopilot:${this.windowId}] Coordinate click, skipping blur to preserve hover state`);
            }

            // 支持坐标点击（视觉驱动）
            if (isCoordinateClick) {
              const { x, y } = decision.target;
              
              console.log(`[WindowCopilot:${this.windowId}] Clicking at coordinate: (${x}, ${y})`);
              
              // 【关键】如果当前处于 hover 面板上下文中，点击要保持 hover 状态（使用 JS 点击）
              const preserveHover = this._hoverPanelActive;
              if (preserveHover) {
                console.log(`[WindowCopilot:${this.windowId}] Preserving hover state for panel click`);
              }
              
              const { result, mode } = await this.controller.clickAt(x, y, preserveHover);
              stepResult = result;
              actualMode = mode;
              
              // 【关键】连续点击时保持 hover 面板状态，直到执行其他类型操作
            } else {
              // 传统 selector 点击
              const selector = decision.target?.selector || decision.selector;
              
              // 【关键】如果处于 hover 面板上下文中，使用 JS 点击保持 hover 状态
              const preserveHover = this._hoverPanelActive;
              if (preserveHover) {
                console.log(`[WindowCopilot:${this.windowId}] Preserving hover state for selector click`);
              }
              
              const { result, mode } = await this.controller.click(selector, { preserveHover });
              console.log(`[WindowCopilot:${this.windowId}] click returned mode: ${mode}`);
              stepResult = result;
              actualMode = mode;
            }
            // 智能等待页面响应
            await this._smartWait('click');
            break;
          }
          case 'hover': {
            console.log(`[WindowCopilot:${this.windowId}] Calling controller.hover...`);
            await this._blurShellInput();

            // 支持坐标 hover
            if (decision.target?.type === 'coordinate' || (decision.target?.x !== undefined && decision.target?.y !== undefined)) {
              const { x, y } = decision.target;
              console.log(`[WindowCopilot:${this.windowId}] Hover at coordinate: (${x}, ${y})`);
              const viewportInfo = this.executionContext?.lastObservation?.viewport;
              const { result, mode } = await this.controller.hoverAt(x, y, viewportInfo);
              stepResult = result;
              actualMode = mode;
            } else {
              // selector hover
              const selector = decision.target?.selector || decision.selector;
              const { result, mode } = await this.controller.hover(selector);
              console.log(`[WindowCopilot:${this.windowId}] hover returned mode: ${mode}`);
              stepResult = result;
              actualMode = mode;
            }
            await this._smartWait('hover');
            
            // 【关键】进入 hover 面板上下文，后续连续点击都会保持 hover 状态
            this._hoverPanelActive = true;
            
            // 【关键】hover 后给 AI 提示下拉菜单的位置
            if (stepResult.success) {
              stepResult.message = '悬停成功。如果下拉菜单出现，通常在头像/按钮下方（y坐标比头像大0.05-0.15）。请先截图确认下拉菜单位置再点击。';
            }
            break;
          }
          case 'select': {
            // 支持 selector 或 target（坐标）方式
            const selector = decision.selector || decision.target;
            const option = decision.option;
            const selectOptions = decision.options || {}; // 支持 { method: 'hover-wheel' } 等选项
            
            console.error(`[SELECT_DEBUG] selector=${JSON.stringify(selector)}, option=${option}, options=${JSON.stringify(selectOptions)}`);
            
            if (!selector) {
              console.error(`[SELECT_DEBUG] Missing selector/target`);
              stepResult = { success: false, error: 'Missing selector or target for select action' };
              actualMode = 'JS';
              break;
            }
            
            try {
              const selectResult = await this.controller.select(selector, option, selectOptions);
              console.error(`[SELECT_DEBUG] Result: ${JSON.stringify(selectResult)}`);
              stepResult = selectResult;
              actualMode = selectResult?.mode || 'CDP';
              
              // 如果失败，给 AI 提示
              if (!selectResult?.success) {
                stepResult.message = `选择失败: ${selectResult?.error || '未知错误'}。可用选项: ${selectResult?.availableOptions?.map(o => o.text || o.value).join(', ') || '无法获取'}`;
              }
            } catch (err) {
              console.error(`[SELECT_DEBUG] Exception: ${err.message}`);
              stepResult = { success: false, error: err.message };
              actualMode = 'JS';
            }
            
            await this._smartWait('select');
            break;
          }
          case 'selectAll': {
            const selectAllTarget = decision.target || decision.selector;
            console.log(`[WindowCopilot:${this.windowId}] selectAll: target=${JSON.stringify(selectAllTarget)}`);
            
            try {
              // 直接调用 controller.selectAll，它会处理点击和全选
              const result = await this.controller.selectAll(selectAllTarget);
              stepResult = result;
              actualMode = result?.mode || 'CDP';
              
              // 标记上一步是全选，这样下一步 type 会跳过点击和清空
              this._lastAction = 'selectAll';
            } catch (err) {
              console.error(`[WindowCopilot:${this.windowId}] selectAll failed:`, err.message);
              stepResult = { success: false, error: err.message };
              actualMode = 'JS';
            }
            
            await this._smartWait('press');
            break;
          }
          case 'upload': {
            const uploadSelector = decision.selector || decision.target;
            let filePath = decision.filePath || decision.file;
            
            // 解析 ~ 路径
            if (filePath) {
              filePath = resolveHomePath(filePath);
            }
            
            console.log(`[WindowCopilot:${this.windowId}] upload: selector=${JSON.stringify(uploadSelector)}, file=${filePath}`);
            
            if (!filePath) {
              stepResult = { success: false, error: 'Missing filePath for upload' };
              actualMode = 'JS';
            } else {
              try {
                // 【智能检测】如果路径是文件夹，自动扫描并选择表情
                const fs = require('fs');
                const isDirectory = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory();
                
                if (isDirectory) {
                  console.log(`[WindowCopilot:${this.windowId}] upload: detected folder path, auto-selecting emoji...`);
                  
                  // 1. 获取评论内容（从对话历史或上一步 type 的内容）
                  const context = this._getCommentContext();
                  console.log(`[WindowCopilot:${this.windowId}] upload: comment context="${context}"`);
                  
                  // 2. 智能选择表情
                  const selectResult = await this.controller.selectEmojiByContext(filePath, context);
                  
                  if (selectResult.success && selectResult.selectedFile) {
                    filePath = selectResult.selectedFile;
                    console.log(`[WindowCopilot:${this.windowId}] upload: auto-selected ${filePath} (emotion: ${selectResult.emotion})`);
                    stepResult = { 
                      success: true, 
                      selectedFile: filePath, 
                      emotion: selectResult.emotion,
                      message: `智能选择了 ${selectResult.emotion} 表情: ${filePath.split('/').pop()}`
                    };
                  } else {
                    throw new Error(`无法从文件夹选择表情: ${selectResult.error || '没有匹配的文件'}`);
                  }
                }
                
                // 3. 执行上传
                const { result, mode } = await this.controller.upload(uploadSelector || null, filePath);
                stepResult = { ...stepResult, ...result };
                actualMode = mode;
              } catch (err) {
                console.error(`[WindowCopilot:${this.windowId}] upload failed:`, err.message);
                stepResult = { success: false, error: err.message };
                actualMode = 'JS';
              }
            }
            
            await this._smartWait('type');
            break;
          }
          case 'file:list': {
            const folderPath = decision.folderPath || decision.path;
            const extensions = decision.extensions || ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
            
            console.log(`[WindowCopilot:${this.windowId}] file:list: path=${folderPath}, extensions=${extensions.join(',')}`);
            
            if (!folderPath) {
              stepResult = { success: false, error: 'Missing folderPath for file:list' };
              actualMode = 'JS';
            } else {
              try {
                const result = await this.controller.listFiles(folderPath, { extensions });
                stepResult = result;
                actualMode = 'JS';
                
                // 将结果保存到上下文中供后续使用
                if (result.success) {
                  this._lastFileList = result.files;
                  stepResult.message = `找到 ${result.files.length} 个文件: ${result.files.map(f => f.split('/').pop()).join(', ')}`;
                }
              } catch (err) {
                console.error(`[WindowCopilot:${this.windowId}] file:list failed:`, err.message);
                stepResult = { success: false, error: err.message };
                actualMode = 'JS';
              }
            }
            break;
          }
          case 'file:selectByContext': {
            const folderPath = decision.folderPath || decision.path;
            const context = decision.context || decision.text;
            
            console.log(`[WindowCopilot:${this.windowId}] file:selectByContext: path=${folderPath}, context=${context?.substring(0, 50)}...`);
            
            if (!folderPath || !context) {
              stepResult = { success: false, error: 'Missing folderPath or context for file:selectByContext' };
              actualMode = 'JS';
            } else {
              try {
                const result = await this.controller.selectEmojiByContext(folderPath, context);
                stepResult = result;
                actualMode = 'JS';
                
                if (result.success) {
                  stepResult.message = `根据情绪「${result.emotion}」选择了: ${result.selectedFile.split('/').pop()}`;
                }
              } catch (err) {
                console.error(`[WindowCopilot:${this.windowId}] file:selectByContext failed:`, err.message);
                stepResult = { success: false, error: err.message };
                actualMode = 'JS';
              }
            }
            break;
          }
          case 'download': {
            // download 操作采用类似 upload 的方式：
            // 1. AI 先 click 点击下载链接触发保存对话框
            // 2. download 操作准备保存路径，拦截器自动填充并确认
            const downloadPath = decision.downloadPath || decision.filePath || decision.path;
            const sourceUrl = decision.sourceUrl || decision.url || decision.href;
            
            console.log(`[WindowCopilot:${this.windowId}] download: preparing download path=${downloadPath || '(default)'}, sourceUrl=${sourceUrl || '(none)'}`);
            
            try {
              const result = await this.controller.download(downloadPath || null, sourceUrl || null);
              stepResult = result;
              actualMode = result.mode || 'SYSTEM';
            } catch (err) {
              console.error(`[WindowCopilot:${this.windowId}] download failed:`, err.message);
              stepResult = { success: false, error: err.message };
              actualMode = 'SYSTEM';
            }
            
            await this._smartWait('click');
            break;
          }
          case 'type': {
            console.log(`[WindowCopilot:${this.windowId}] Calling controller.type...`);

            // 检测是否是地址栏输入
            const isAddressBar = decision.selector?.includes('address') ||
                                 decision.selector?.includes('url') ||
                                 decision.selector?.includes('omnibox') ||
                                 decision.description?.includes('地址栏') ||
                                 decision.description?.includes('address bar');

            if (isAddressBar) {
              // 地址栏输入：通过 shell 窗口的 webContents 执行 JS 设置地址栏值
              console.log(`[WindowCopilot:${this.windowId}] Detected address bar input, using shell.executeJavaScript`);
              try {
                // 获取 shell 窗口的 webContents
                let shellWebContents;
                if (this.windowId === 'main') {
                  shellWebContents = this.core?.window?.webContents;
                } else {
                  const detachedWindow = this.core?.detachedWindows?.get(this.windowId) ||
                                         this.core?.detachedWindows?.get(Number(this.windowId)) ||
                                         this.core?.detachedWindows?.get(String(this.windowId));
                  shellWebContents = detachedWindow?.window?.webContents;
                }

                if (shellWebContents) {
                  // 在 shell 窗口中设置地址栏值
                  await shellWebContents.executeJavaScript(`
                    (function() {
                      const input = document.getElementById('address-input');
                      if (input) {
                        input.value = '${decision.text.replace(/'/g, "\\'")}';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        return true;
                      }
                      return false;
                    })()
                  `);
                  stepResult = { success: true };
                  actualMode = 'JS';
                } else {
                  throw new Error('无法获取 shell 窗口');
                }
              } catch (err) {
                console.error(`[WindowCopilot:${this.windowId}] Address bar input failed:`, err);
                stepResult = { success: false, error: err.message };
                actualMode = 'JS';
              }
            } else if (decision.target?.type === 'coordinate' || (decision.target?.x !== undefined && decision.target?.y !== undefined)) {
              // 使用坐标点击输入框获取焦点，然后输入（支持显式type标记或隐式x/y坐标）
              
              // 检查上一步是否全选，如果是则跳过点击
              const skipClick = this._lastAction === 'selectAll';
              console.log(`[WindowCopilot:${this.windowId}] Type at coordinate, skipClick=${skipClick}`);
              
              if (!skipClick) {
                // 先让 shell 输入框失焦，避免焦点冲突
                await this._blurShellInput();

                const { x, y } = decision.target;
                
                // 【关键】如果处于 hover 面板上下文中，使用 JS 点击保持 hover 状态
                const preserveHover = this._hoverPanelActive;
                if (preserveHover) {
                  console.log(`[WindowCopilot:${this.windowId}] Preserving hover state for type operation`);
                }
                
                const { result: clickResult, mode: clickMode } = await this.controller.clickAt(x, y, preserveHover);
                if (!clickResult.success) {
                  stepResult = { success: false, error: '坐标点击失败' };
                  actualMode = 'JS';
                  await this._smartWait('type');
                  break;
                }
                // 等待一下确保焦点已获取
                await this._sleep(100);
              }
              
              // 使用 activeElement 输入（不依赖 selector）
              // 【关键】如果处于 hover 面板上下文中，使用 JS 输入
              const { result: typeResult, mode: typeMode } = await this.controller.typeActive(decision.text, { 
                preserveHover: this._hoverPanelActive 
              });
              stepResult = typeResult;
              actualMode = typeMode;
              
              // 重置标志
              this._lastAction = null;
            } else {
              // 普通网页输入框（使用 selector）
              // 先让 shell 输入框失焦
              await this._blurShellInput();

              // 检查上一步是否全选，如果是则跳过点击和清空
              const skipClick = this._lastAction === 'selectAll';
              console.log(`[WindowCopilot:${this.windowId}] Type with selector, skipClick=${skipClick}`);
              
              // 【关键】如果处于 hover 面板上下文中，使用 JS 输入方式
              const preserveHover = this._hoverPanelActive;
              if (preserveHover) {
                console.log(`[WindowCopilot:${this.windowId}] Using JS type with preserveHover`);
              }
              
              const { result, mode } = await this.controller.type(decision.selector, decision.text, { 
                skipClick, 
                clear: !skipClick, // 如果跳过了全选，则不清空（因为已经全选了）
                preserveHover // 传递 hover 保持标志
              });
              console.log(`[WindowCopilot:${this.windowId}] type returned mode: ${mode}`);
              stepResult = result;
              actualMode = mode;
              
              // 重置标志
              this._lastAction = null;
            }
            // 智能等待输入完成
            await this._smartWait('type');
            break;
          }
          case 'scroll': {
            const { result, mode } = await this.controller.scroll(decision.direction, decision.amount);
            stepResult = result;
            actualMode = mode;
            // 智能等待滚动完成
            await this._smartWait('scroll');
            break;
          }
          case 'wheel': {
            // 支持在指定坐标位置滚动（用于下拉框选项区域滚动）
            const coordinate = decision.target || null;
            const { result, mode } = await this.controller.wheel(decision.direction, decision.amount, coordinate);
            stepResult = result;
            actualMode = mode;
            // 智能等待视频切换动画
            await this._smartWait('wheel');
            break;
          }
          case 'wait': {
            const { result, mode } = await this.controller.wait(decision.ms || 1000);
            stepResult = result;
            actualMode = mode;
            break;
          }
          case 'press': {
            const { result: pressResult, mode: pressMode } = await this.controller.press(decision.key);
            console.log(`[WindowCopilot:${this.windowId}] press returned mode: ${pressMode}`);
            stepResult = pressResult;
            actualMode = pressMode;
            // 智能等待按键响应（如 Enter 提交表单）
            await this._smartWait('press');
            break;
          }
          case 'screenshot': {
            const { result, mode } = await this.controller.screenshot();
            stepResult = result;
            actualMode = mode;
            break;
          }
          case 'get_content': {
            const { result, mode } = await this.controller.getContent();
            stepResult = result;
            actualMode = mode;
            break;
          }
          case 'yes':
          case 'no': {
            // yes/no 是确认操作，不需要实际执行，直接返回成功
            stepResult = { success: true, confirmStatus: decision.action };
            actualMode = 'JS';
            break;
          }
          case 'collect': {
            // 数据采集：将当前页面数据写入缓存
            const exportManager = getExportManager();
            
            // 如果没有活跃任务，自动创建一个新任务
            if (!this._currentExportTaskId) {
              this._currentExportTaskId = await exportManager.startExport({
                format: 'excel',  // 默认格式
                filename: decision.filename || `export-${Date.now()}`
              });
              console.log(`[WindowCopilot:${this.windowId}] Auto-started export task: ${this._currentExportTaskId}`);
            }
            
            try {
              const result = await exportManager.collectBatch(
                this._currentExportTaskId,
                decision.content
              );
              stepResult = { 
                success: true, 
                batchIndex: result.batchIndex,
                message: `已采集第 ${result.batchIndex + 1} 批数据（累计 ${result.batchIndex + 1} 次采集）`
              };
              actualMode = 'JS';
            } catch (err) {
              console.error(`[WindowCopilot:${this.windowId}] collect failed:`, err.message);
              stepResult = { success: false, error: err.message };
              actualMode = 'JS';
            }
            break;
          }
          case 'export': {
            // 【可选】手动触发导出（通常不需要，done 时会自动导出）
            const exportManager = getExportManager();
            
            if (this._currentExportTaskId) {
              try {
                const result = await exportManager.finalizeExport(this._currentExportTaskId);
                stepResult = { 
                  success: true, 
                  path: result.path,
                  status: result.status,
                  message: `已导出到: ${result.path}`
                };
                // 注意：不清理 _currentExportTaskId，因为可能还需要继续采集
              } catch (err) {
                console.error(`[WindowCopilot:${this.windowId}] export failed:`, err.message);
                // 如果已经导出过了，提示成功
                if (err.message.includes('already exported')) {
                  stepResult = { 
                    success: true, 
                    message: '数据已导出'
                  };
                } else {
                  stepResult = { success: false, error: err.message };
                }
              }
            } else {
              // 没有活跃任务，可能是已经导出过了
              stepResult = { 
                success: true, 
                message: '没有待导出的数据（可能已自动导出）'
              };
            }
            actualMode = 'JS';
            break;
          }
          default:
            stepResult = { success: false, error: `未知操作: ${decision.action}` };
        }

        // 【关键】非 click/hover/type 操作会退出 hover 面板上下文
        // 允许在 hover 面板内连续点击或输入文本
        if (decision.action !== 'click' && decision.action !== 'hover' && decision.action !== 'type') {
          if (this._hoverPanelActive) {
            console.log(`[WindowCopilot:${this.windowId}] Exiting hover panel context after ${decision.action}`);
            this._hoverPanelActive = false;
          }
        }

        // 如果实际模式和预期不同，发送更新事件
        if (actualMode !== 'CDP') {
          const fallbackNames = {
            navigate: '正在导航到网站页面',
            click: '点击页面元素',
            type: '正在输入文本',
            scroll: '正在滚动查看页面',
            wheel: '正在滚动滚轮',
            wait: '等待中',
            press: '按键中',
            screenshot: '正在获取页面截图',
            get_content: '正在读取页面内容',
            yes: '确认继续',
            no: '取消操作'
          };
          this._emitToWindow(COPILOT_EVENTS.STEP_START, {
            step: stepNum,
            action: decision.action,
            description: decision.description || decision.reason || fallbackNames[decision.action] || `正在执行: ${decision.action}`,
            mode: actualMode === 'JS' ? 'JS' : 'CDP'
          });
        }

        // ===== 执行后验证 =====
        if (stepResult?.success && (decision.action === 'click' || decision.action === 'type' || decision.action === 'navigate')) {
          console.log(`[WindowCopilot:${this.windowId}] Post-execution verification...`);
          const verified = await this._verifyExecutionResult(decision, stepResult);
          if (!verified.success) {
            console.warn(`[WindowCopilot:${this.windowId}] Post-execution verification failed:`, verified.reason);
            return {
              success: false,
              error: `执行后验证失败: ${verified.reason}`,
              needRetry: true,
              originalResult: stepResult
            };
          }
        }
        // ======================

        return stepResult || { success: true };
      } catch (err) {
        // 发送步骤更新事件（失败时使用 JS 模式）
        this._emitToWindow(COPILOT_EVENTS.STEP_START, {
          step: stepNum,
          action: decision.action,
          description: `${decision.description || ''} 失败: ${err.message}`,
          mode: 'JS'
        });
        return { success: false, error: err.message };
      } finally {
        // 恢复原始方法
        this.controller._getActiveWebContents = originalGetActiveWebContents;
        if (originalGetActiveTargetId) {
          this.controller._getActiveTargetId = originalGetActiveTargetId;
        }
        if (originalEnsureCDP) {
          this.controller._ensureCDPConnectedToActive = originalEnsureCDP;
        }
      }
    }

    // 回退：直接使用 webContents
    const webContents = this.getActiveViewWebContents();
    if (!webContents) {
      // 发送步骤开始事件（无页面可用）
      this._emitToWindow(COPILOT_EVENTS.STEP_START, {
        step: stepNum,
        action: decision.action,
        description: '无法获取页面',
        mode: 'JS'
      });
      return { success: false, error: '无法获取页面' };
    }

    // 发送步骤开始事件（使用 JS 模式）- 在操作前发送
    const jsActionNames = {
      navigate: '正在导航到网站页面',
      click: '点击页面元素',
      type: '正在输入文本',
      upload: '上传文件',
      selectAll: '全选文本',
      scroll: '正在滚动查看页面',
      wheel: '正在滚动滚轮',
      wait: '等待中',
      press: '按键中',
      screenshot: '正在获取页面截图',
      get_content: '正在读取页面内容',
      yes: '确认继续',
      no: '取消操作'
    };
    const defaultDescJS = jsActionNames[decision.action] || `正在执行: ${decision.action}`;
    this._emitToWindow(COPILOT_EVENTS.STEP_START, {
      step: stepNum,
      action: decision.action,
      description: decision.description || decision.reason || defaultDescJS,
      mode: 'JS'
    });

    try {
      switch (decision.action) {
        case 'navigate':
          await webContents.loadURL(decision.url);
          return { success: true };

        case 'click':
          await webContents.executeJavaScript(`
            document.querySelector(${JSON.stringify(decision.selector)})?.click()
          `);
          return { success: true };

        case 'hover':
          await webContents.executeJavaScript(`
            (function() {
              const el = document.querySelector(${JSON.stringify(decision.selector)});
              if (el) {
                el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                el.classList.add('hover');
              }
            })()
          `);
          return { success: true };

        case 'select':
          const selectResult = await webContents.executeJavaScript(`
            (function() {
              const select = document.querySelector(${JSON.stringify(decision.selector)});
              if (!select) return { success: false, error: 'Select not found' };
              const option = '${decision.option}';
              let target = Array.from(select.options).find(opt => opt.value === option || opt.text.includes(option));
              if (target) {
                select.value = target.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                return { success: true };
              }
              return { success: false, error: 'Option not found' };
            })()
          `);
          return selectResult || { success: false };

        case 'selectAll':
          await webContents.executeJavaScript(`
            (function() {
              const el = document.activeElement;
              if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
                el.select();
              } else if (el && el.isContentEditable) {
                const range = document.createRange();
                range.selectNodeContents(el);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
              } else {
                document.execCommand('selectAll');
              }
              return true;
            })()
          `);
          return { success: true };

        case 'upload':
          // JS Fallback 无法直接上传文件，返回错误
          return { success: false, error: 'File upload requires CDP mode' };

        case 'type':
          await webContents.executeJavaScript(`
            const el = document.querySelector(${JSON.stringify(decision.selector)});
            if (el) { el.value = ${JSON.stringify(decision.text)}; el.dispatchEvent(new Event('input')); }
          `);
          return { success: true };

        case 'scroll':
          const direction = decision.direction === 'up' ? -1 : 1;
          const amount = decision.amount || 500;
          await webContents.executeJavaScript(`
            window.scrollBy(0, ${direction * amount})
          `);
          return { success: true };

        case 'wheel':
          const wheelDeltaY = decision.direction === 'up' ? -(decision.amount || 800) : (decision.amount || 800);
          await webContents.executeJavaScript(`
            (function() {
              // 触发 WheelEvent
              const wheelEvent = new WheelEvent('wheel', {
                deltaY: ${wheelDeltaY},
                deltaMode: 0,
                bubbles: true,
                cancelable: true
              });
              document.dispatchEvent(wheelEvent);
              // 同时 scroll
              window.scrollBy({ top: ${wheelDeltaY}, behavior: 'smooth' });
            })()
          `);
          return { success: true };

        case 'wait':
          await this._sleep(decision.ms || 1000);
          return { success: true };

        case 'press':
          await webContents.executeJavaScript(`
            (function() {
              const el = document.activeElement || document.body;
              const key = '${decision.key || 'Enter'}';

              // 触发 keydown
              el.dispatchEvent(new KeyboardEvent('keydown', {
                key: key,
                code: key,
                bubbles: true
              }));

              // 触发 keypress
              el.dispatchEvent(new KeyboardEvent('keypress', {
                key: key,
                bubbles: true
              }));

              // 触发 keyup
              el.dispatchEvent(new KeyboardEvent('keyup', {
                key: key,
                code: key,
                bubbles: true
              }));

              // 如果是 Enter 且是表单，尝试提交
              if (key === 'Enter' && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
                const form = el.closest('form');
                if (form) form.dispatchEvent(new Event('submit', { bubbles: true }));
              }

              return true;
            })()
          `);
          return { success: true };

        case 'screenshot':
          const image = await webContents.capturePage();
          return {
            success: true,
            dataUrl: image.toDataURL(),
            width: image.getSize().width,
            height: image.getSize().height
          };

        case 'get_content':
          const pageContent = await webContents.executeJavaScript(`
            document.body.innerText.substring(0, 3000)
          `);
          return { success: true, content: pageContent };

        case 'yes':
        case 'no':
          // yes/no 是确认操作，直接返回成功
          return { success: true, confirmStatus: decision.action };

        default:
          return { success: false, error: `未知操作: ${decision.action}` };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * 处理动作模式响应
   */
  async _handleActionResponse(text) {
    const decision = this._parseDecision(text);

    if (!decision) {
      // 解析失败时继续尝试，不轻易放弃
      if (this.stepCount >= 20) {
        await this._finishAction('任务结束（多次尝试后仍无法解析AI响应）');
        return;
      }
      
      // 【关键】把解析失败的原始响应反馈给AI
      await this._continueAction({
        success: false,
        error: '无法解析AI响应',
        rawResponse: text,
        message: `无法解析你的响应。请确保输出有效的JSON格式，例如：
{"action": "click", "selector": "button", "description": "点击登录按钮"}

你刚才的响应是：
${text.substring(0, 500)}

请重新输出正确的格式。`
      });
      return;
    }

    if (decision.action === 'done' || decision.action === 'finish') {
      await this._finishAction(decision.summary || '任务完成');
      return;
    }

    // 【处理 yes/no 步骤确认】
    if (decision.action === 'yes' || decision.action === 'no') {
      console.log(`[WindowCopilot] Step confirmed: ${decision.action}`);

      // 更新最后一步的确认状态（不增加步数计数）
      const lastStep = this.memory.history[this.memory.history.length - 1];
      if (lastStep) {
        lastStep.confirmStatus = decision.action;
      }

      // 发送步骤结果事件
      this._emitToWindow(COPILOT_EVENTS.STEP_RESULT, {
        step: this.stepCount,
        action: decision.action,
        success: decision.action === 'yes',
        confirmed: true
      });

      // 继续下一步
      await this._continueAction({
        success: decision.action === 'yes',
        confirmStatus: decision.action
      });
      return;
    }

    if (this.stepCount >= 100) {
      await this._finishAction(`已达到最大尝试次数（100步），任务未能完成。建议：1) 检查页面是否加载正常 2) 尝试刷新页面后重新开始`);
      return;
    }

    // 执行前截图（用于对比）
    const webContents = this.getActiveViewWebContents();
    if (webContents) {
      try {
        const beforeImage = await webContents.capturePage();
        this.executionContext.beforeScreenshot = {
          data: beforeImage.toDataURL(),
          size: beforeImage.getSize()
        };
      } catch (e) {
        console.log('[WindowCopilot] Failed to capture before screenshot');
      }
    }

    this.executionContext.lastDecision = decision;

    // 执行操作
    const result = await this._executeStep(decision);

    // 发送执行结果给前端
    this._emitToWindow(COPILOT_EVENTS.STEP_RESULT, {
      step: this.stepCount + 1,
      action: decision.action,
      success: result.success,
      error: result.error
    });

    // 构建详细的反馈信息
    let feedbackMessage;
    if (result.success) {
      feedbackMessage = `步骤 ${this.stepCount + 1} (${decision.action}) 执行完成。请查看页面状态，输出 yes 确认继续，或 no 重试，或输出其他操作。`;
    } else {
      // 【关键】执行失败时，提供详细的错误信息
      feedbackMessage = `步骤 ${this.stepCount + 1} (${decision.action}) 执行失败。\n\n错误详情：${result.error || '未知错误'}\n\n你尝试的操作：${JSON.stringify(decision, null, 2)}\n\n请分析失败原因，调整策略后重试。可以：\n1. 使用不同的选择器或坐标\n2. 先截图查看当前页面状态\n3. 尝试其他方法完成目标`;
    }

    // 等待 AI 输出 yes（成功）或 no（失败）来确认
    this.stepCount++;
    this.memory.history.push({
      step: this.stepCount,
      decision,
      result,
      executed: true,
      confirmStatus: null  // 等待确认，将在 AI 响应 yes/no 后更新
    });

    // 构建提示词让 AI 判断这一步是否成功
    await this._continueAction({
      success: result.success,
      result: result,
      message: feedbackMessage,
      decision: decision  // 传递决策信息用于错误分析
    });
  }

  /**
   * 继续动作模式（视觉驱动）
   */
  async _continueAction(previousResult) {
    // 【取消检查】如果任务被取消，立即退出
    if (this._cancelled) {
      console.log(`[WindowCopilot:${this.windowId}] Task was cancelled, stopping execution`);
      return;
    }

    try {
      // 如果上一步失败，等待一下让页面稳定
      if (previousResult && !previousResult.success) {
        console.log(`[WindowCopilot:${this.windowId}] Previous step failed, waiting 1s before retry...`);
        await this._sleep(1000);
      }

      // 【取消检查】等待后再次检查
      if (this._cancelled) {
        console.log(`[WindowCopilot:${this.windowId}] Task was cancelled during wait`);
        return;
      }

      // 使用视觉 + DOM 观察
      const observation = await this._observePageVisual();

      // 【取消检查】观察后检查是否被取消
      if (this._cancelled) {
        console.log(`[WindowCopilot:${this.windowId}] Task was cancelled after observation`);
        return;
      }

      // 【关键】保存观察结果用于后续坐标校准
      if (observation.viewport) {
        this.executionContext = this.executionContext || {};
        this.executionContext.lastObservation = observation;
        console.log(`[WindowCopilot:${this.windowId}] Saved viewport info for coordinate calibration: ${observation.viewport.width}x${observation.viewport.height}`);
      }

      // 检查登录状态
      if (observation.loginStatus?.needsLogin) {
        this.loginWaitCount++;
        console.log(`[WindowCopilot:${this.windowId}] Login required, wait count: ${this.loginWaitCount}`);
        
        if (this.loginWaitCount > 3) {
          // 超过3次等待，结束任务
          await this._finishAction('任务结束：用户未完成登录/验证操作');
          return;
        }
        
        // 在 observation 中记录等待次数，供 AI 参考
        observation.loginWaitCount = this.loginWaitCount;
      } else if (observation.loginStatus?.isLoggedIn) {
        // 已登录，重置计数
        this.loginWaitCount = 0;
      }

      // 检查是否卡在同一页面（没有进展）
      if (previousResult && !previousResult.success && previousResult.samePage) {
        console.log(`[WindowCopilot:${this.windowId}] Detected stuck on same page, suggesting scroll...`);
        observation.isStuck = true;
      }

      // 【取消检查】构建提示词前检查
      if (this._cancelled) {
        console.log(`[WindowCopilot:${this.windowId}] Task was cancelled before building prompt`);
        return;
      }

      // 构建视觉提示词
      console.log(`[DEBUG] About to call buildVisualActionPrompt with:`);
      console.log(`  currentTask: ${this.currentTask?.substring(0, 50)}...`);
      console.log(`  observation.url: ${observation?.url}`);
      console.log(`  observation has screenshot: ${!!observation?.screenshot}`);
      console.log(`  previousResult exists: ${!!previousResult}`);
      console.log(`  stepCount: ${this.stepCount}`);
      console.log(`  history length: ${this.memory?.history?.length || 0}`);

      const prompt = this.promptBuilder.buildVisualActionPrompt(
        this.currentTask,
        observation,
        previousResult,
        this.stepCount,
        this.memory?.history
      );

      // 【调试日志】打印完整提示词
      console.log(`\n========== [DEBUG] Prompt Info (${this.aiServiceManager?.isLocalOpenClaw ? 'Local' : 'Cloud'}) ==========`);
      console.log(`prompt type: ${typeof prompt}`);
      console.log(`prompt value: ${JSON.stringify(prompt, null, 2)?.substring(0, 500)}`);
      console.log(`prompt has text: ${!!prompt?.text}`);
      console.log(`prompt text length: ${prompt?.text?.length || 0}`);
      console.log(`prompt hasVisual: ${prompt?.hasVisual}`);
      console.log(`observation has screenshot: ${!!observation?.screenshot}`);
      console.log(`observation url: ${observation?.url}`);
      console.log(`observation elements count: ${observation?.elements?.length || 0}`);
      console.log('========== [DEBUG] Prompt text preview (first 500 chars): ==========');
      console.log(prompt?.text?.substring(0, 500) || '(EMPTY)');
      console.log('========== [DEBUG] End Prompt Info ==========\n');

      // 如果有截图，使用多模态发送
      if (observation.screenshot) {
        let attachment;

        // 根据 AI 服务模式选择 attachment 格式
        const isLocalOpenClaw = this.aiServiceManager?.isLocalOpenClaw ?? true;

        if (isLocalOpenClaw) {
          // 本地模式：使用 HTTP URL
          attachment = this.visualContext.toServerAttachment(observation.screenshot);
          console.log(`[WindowCopilot:${this.windowId}] Using local HTTP URL: ${attachment.url}`);
        } else {
          // 远程模式：使用文件路径（AIServiceManager 会读取为 Base64）
          attachment = this.visualContext.toAttachment(observation.screenshot);
          console.log(`[WindowCopilot:${this.windowId}] Using file path for Kimi`);
        }

        // 【调试日志】打印 attachment 信息
        console.log(`\n========== [DEBUG] Attachment Info ==========`);
        console.log(JSON.stringify(attachment, null, 2));
        console.log('========== [DEBUG] End Attachment ==========\n');

        await this.aiServiceManager.sendMultimodalMessage(
          prompt.text,
          [attachment],
          { sessionKey: `agent:window:${this.windowId}` }
        );
      } else {
        // 回退到纯文本
        await this.aiServiceManager.sendMessage(prompt.text, {
          sessionKey: `agent:window:${this.windowId}`
        });
      }
    } catch (err) {
      console.error(`[WindowCopilot:${this.windowId}] Continue failed:`, err);

      // 出错时尝试重试，不要轻易结束
      if (this.stepCount < 50) {
        console.log(`[WindowCopilot:${this.windowId}] Retrying after error...`);
        await this._sleep(2000);
        await this._continueAction({
          success: false,
          error: `系统错误: ${err.message}，请重试`
        });
      } else {
        this._emitToWindow(COPILOT_EVENTS.MESSAGE, {
          text: `无法继续任务: ${err.message}`
        });
        this._resetState();
      }
    }
  }

  /**
   * 完成动作模式
   */
  async _finishAction(summary) {
    if (!this.isExecuting) return;

    // 【自动导出】如果还有未导出的采集数据，先完成导出
    if (this._currentExportTaskId) {
      try {
        const exportManager = getExportManager();
        const result = await exportManager.finalizeExport(this._currentExportTaskId);
        summary += `\n\n📊 数据已导出到: ${result.path}`;
      } catch (err) {
        console.error(`[WindowCopilot:${this.windowId}] Auto-export failed:`, err.message);
        // 如果已经导出过了，不报错
        if (err.message.includes('already exported')) {
          const exportManager = getExportManager();
          const status = await exportManager.getStatus(this._currentExportTaskId);
          if (status?.exportPath) {
            summary += `\n\n📊 数据已导出到: ${status.exportPath}`;
          }
        } else {
          summary += `\n\n⚠️ 导出失败: ${err.message}`;
        }
      }
      this._currentExportTaskId = null;
    }

    this.isExecuting = false;
    this.mode = 'chat';

    this._emitToWindow(COPILOT_EVENTS.TASK_FINISH, {
      message: summary,
      steps: this.stepCount,
      windowId: this.windowId
    });

    this._emitToWindow(COPILOT_EVENTS.MESSAGE, {
      text: `任务完成！\n\n${summary}\n\n共执行了 ${this.stepCount} 步。`
    });
  }

  /**
   * 解析 AI 决策
   */
  _parseDecision(text) {
    if (!text || typeof text !== 'string') {
      console.log('[WindowCopilot] _parseDecision: text is empty or not string');
      return null;
    }

    let cleaned = text.trim();
    console.log(`[WindowCopilot] _parseDecision: raw text length=${cleaned.length}, preview="${cleaned.substring(0, 100)}..."`);

    // 1. 【优先】使用平衡括号匹配法提取所有完整 JSON 对象
    const jsonObjects = this._extractJSONObjects(cleaned);
    for (const jsonStr of jsonObjects) {
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.action) {
          console.log(`[WindowCopilot] _parseDecision: extracted JSON with action=${parsed.action}`);
          return parsed;
        }
      } catch (err) {
        continue;
      }
    }

    // 2. 尝试从代码块中提取
    const codeBlockMatch = cleaned.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1].trim());
        if (parsed.action) {
          console.log(`[WindowCopilot] _parseDecision: extracted from code block, action=${parsed.action}`);
          return parsed;
        }
      } catch (err) {
        console.log(`[WindowCopilot] _parseDecision: code block parse failed, ${err.message}`);
      }
    }

    // 3. 移除 HTML 标签后再次尝试
    cleaned = cleaned.replace(/<[^>]+>/g, '');
    const jsonObjects2 = this._extractJSONObjects(cleaned);
    for (const jsonStr of jsonObjects2) {
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.action) {
          console.log(`[WindowCopilot] _parseDecision: extracted JSON (cleaned), action=${parsed.action}`);
          return parsed;
        }
      } catch (err) {
        continue;
      }
    }

    // 4. 【容错】尝试从自然语言中提取操作
    const naturalLanguageMatch = this._extractActionFromNaturalLanguage(cleaned);
    if (naturalLanguageMatch) {
      console.log(`[WindowCopilot] _parseDecision: extracted from natural language, action=${naturalLanguageMatch.action}`);
      return naturalLanguageMatch;
    }

    console.log('[WindowCopilot] _parseDecision: failed to parse any action');
    return null;
  }

  /**
   * 从文本中提取完整的 JSON 对象（支持嵌套）
   */
  _extractJSONObjects(text) {
    const results = [];
    let depth = 0;
    let start = -1;

    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        if (depth === 0) {
          start = i;
        }
        depth++;
      } else if (text[i] === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          results.push(text.substring(start, i + 1));
          start = -1;
        }
      }
    }

    return results;
  }

  /**
   * 【新增】从自然语言中提取操作（容错机制 - 严格限制）
   * ⚠️ 仅用于无法解析JSON时的最后手段，且绝不提取 done 操作（避免提前结束任务）
   */
  _extractActionFromNaturalLanguage(text) {
    // 【严格限制】如果文本中包含JSON格式（花括号），说明AI试图输出JSON但格式不对
    // 此时不应使用容错机制，而应让解析失败，提示AI重新输出
    if (text.includes('{') && text.includes('}')) {
      console.log('[WindowCopilot] _extractActionFromNaturalLanguage: text contains JSON-like braces, skipping');
      return null;
    }

    // 【绝不提取 done】任务完成必须由明确的 JSON {"action": "done"} 触发
    // 避免把"任务已完成"、"页面加载成功"等描述性文字误判为结束指令

    // 纯自然语言时，尝试提取具体操作（仅 navigate/click/type/scroll）
    // 检查是否包含 "navigate" 或 "打开" + URL
    const urlMatch = text.match(/(?:打开|访问|导航到|navigate to)\s*[:：]?\s*(https?:\/\/[^\s]+)/i);
    if (urlMatch) {
      return { action: 'navigate', url: urlMatch[1], description: '导航到URL（从自然语言提取）' };
    }

    // 检查是否包含 "click" 或 "点击"
    const clickMatch = text.match(/(?:点击|click|选择)\s*[:：]?\s*["']?([^"'\n]+)["']?/i);
    if (clickMatch) {
      return { action: 'click', selector: clickMatch[1].trim(), description: '点击元素（从自然语言提取）' };
    }

    // 检查是否包含 "type" 或 "输入"
    const typeMatch = text.match(/(?:输入|type|填写)\s*[:：]?\s*["']([^"']+)["']\s*(?:到|in|into)?\s*["']?([^"'\n]*)["']?/i);
    if (typeMatch) {
      return { action: 'type', selector: typeMatch[2].trim() || 'input', text: typeMatch[1], description: '输入文本（从自然语言提取）' };
    }

    // 检查是否包含 "scroll" 或 "滚动"
    const scrollMatch = text.match(/(?:滚动|scroll|向下滚动|向上滚动)/i);
    if (scrollMatch) {
      const direction = /向上|up/i.test(text) ? 'up' : 'down';
      return { action: 'scroll', direction, amount: 500, description: '滚动页面（从自然语言提取）' };
    }

    return null;
  }

  /**
   * 执行前验证元素存在性和可见性
   * @param {string|object} target - 选择器或目标对象
   * @param {string} action - 操作类型
   * @returns {Promise<{exists: boolean, visible: boolean, element?: object}>}
   */
  async _verifyElementBeforeAction(target, action) {
    const webContents = this.getActiveViewWebContents();
    if (!webContents) {
      return { exists: false, visible: false };
    }

    const selector = typeof target === 'string' ? target : (target.selector || target.xpath);
    if (!selector) {
      return { exists: true, visible: true }; // 无选择器时跳过验证（如坐标）
    }

    try {
      const result = await webContents.executeJavaScript(`
        (function() {
          try {
            const el = document.querySelector(${JSON.stringify(selector)}) ||
                      document.evaluate(${JSON.stringify(selector)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (!el) return { exists: false };
            
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            const isVisible = rect.width > 0 && rect.height > 0 &&
                             style.display !== 'none' &&
                             style.visibility !== 'hidden' &&
                             style.opacity !== '0';
            
            return {
              exists: true,
              visible: isVisible,
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              text: el.innerText?.substring(0, 50) || el.textContent?.substring(0, 50) || ''
            };
          } catch (e) {
            return { exists: false, error: e.message };
          }
        })()
      `);
      
      return result || { exists: false };
    } catch (err) {
      console.error(`[WindowCopilot:${this.windowId}] Verification failed:`, err);
      return { exists: false, error: err.message };
    }
  }

  /**
   * 查找替代目标（当原目标不存在时）
   * @param {string|object} originalTarget - 原始目标
   * @param {object} decision - 决策对象
   * @returns {Promise<object|null>} 替代目标或 null
   */
  async _findAlternativeTarget(originalTarget, decision) {
    const webContents = this.getActiveViewWebContents();
    if (!webContents) return null;

    const originalSelector = typeof originalTarget === 'string' ? originalTarget : originalTarget.selector;
    const originalText = decision.description || '';

    try {
      // 策略1: 尝试用文本内容匹配
      if (originalText && originalText.length > 2) {
        const textMatch = await webContents.executeJavaScript(`
          (function() {
            const keywords = ${JSON.stringify(originalText.split(/\s+/).filter(w => w.length >= 2))};
            const elements = Array.from(document.querySelectorAll('button, a, input, [role="button"], [class*="btn"]'));
            
            for (const el of elements) {
              const text = (el.innerText || el.textContent || el.placeholder || el.value || '').toLowerCase();
              const matched = keywords.some(kw => text.includes(kw.toLowerCase()));
              if (matched) {
                return {
                  selector: el.id ? '#' + el.id : el.className ? el.tagName.toLowerCase() + '.' + el.className.split(/\s+/)[0] : el.tagName.toLowerCase(),
                  text: (el.innerText || el.textContent || '').substring(0, 50),
                  strategy: 'text-match'
                };
              }
            }
            return null;
          })()
        `);
        if (textMatch) return textMatch;
      }

      // 策略2: 尝试 XPath 替代
      if (originalSelector && originalSelector.startsWith('#')) {
        const id = originalSelector.slice(1);
        const xpathResult = await webContents.executeJavaScript(`
          (function() {
            const el = document.getElementById(${JSON.stringify(id)});
            if (el) {
              const xpath = '//' + el.tagName.toLowerCase() + '[@id="' + id + '"]';
              return { selector: xpath, strategy: 'xpath-id' };
            }
            return null;
          })()
        `);
        if (xpathResult) return xpathResult;
      }

      // 策略3: 根据 action 类型找通用替代
      if (decision.action === 'click') {
        const genericButton = await webContents.executeJavaScript(`
          (function() {
            // 找第一个可见的可点击按钮
            const buttons = Array.from(document.querySelectorAll('button:not([disabled]), a[href], [role="button"], [onclick]'));
            const visible = buttons.find(b => {
              const rect = b.getBoundingClientRect();
              const style = window.getComputedStyle(b);
              return rect.width > 0 && rect.height > 0 &&
                     style.display !== 'none' && style.visibility !== 'hidden';
            });
            if (visible) {
              return {
                selector: visible.tagName.toLowerCase() + (visible.className ? '.' + visible.className.split(/\s+/)[0] : ''),
                text: (visible.innerText || visible.textContent || '').substring(0, 30),
                strategy: 'generic-button'
              };
            }
            return null;
          })()
        `);
        if (genericButton) return genericButton;
      }

      return null;
    } catch (err) {
      console.error(`[WindowCopilot:${this.windowId}] Find alternative failed:`, err);
      return null;
    }
  }

  /**
   * 滚动元素到可视区域
   * @param {string|object} target - 选择器或目标对象
   */
  async _scrollElementIntoView(target) {
    const webContents = this.getActiveViewWebContents();
    if (!webContents) return;

    const selector = typeof target === 'string' ? target : (target.selector || target.xpath);
    if (!selector) return;

    try {
      await webContents.executeJavaScript(`
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)}) ||
                    document.evaluate(${JSON.stringify(selector)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (el && el.scrollIntoView) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return true;
          }
          return false;
        })()
      `);
      // 等待滚动完成
      await this._sleep(500);
    } catch (err) {
      console.error(`[WindowCopilot:${this.windowId}] Scroll into view failed:`, err);
    }
  }

  /**
   * 执行后验证操作结果
   * @param {object} decision - 决策对象
   * @param {object} result - 执行结果
   * @returns {Promise<{success: boolean, reason?: string}>}
   */
  async _verifyExecutionResult(decision, result) {
    const webContents = this.getActiveViewWebContents();
    if (!webContents) {
      return { success: false, reason: '无法获取页面' };
    }

    try {
      switch (decision.action) {
        case 'navigate': {
          // 验证 URL 是否变化
          const currentUrl = await webContents.executeJavaScript('window.location.href');
          const expectedUrl = decision.url;
          if (currentUrl === expectedUrl || currentUrl.includes(expectedUrl.replace(/^https?:\/\//, ''))) {
            return { success: true };
          }
          // URL 不同，检查是否是重定向
          if (currentUrl !== this.executionContext?.lastObservation?.url) {
            return { success: true }; // URL 变了，接受为成功
          }
          return { success: false, reason: '页面未跳转' };
        }

        case 'click': {
          // 等待短暂时间让页面响应
          await this._sleep(300);
          // 验证：检查页面是否有变化（URL、DOM 变化）
          const currentUrl = await webContents.executeJavaScript('window.location.href');
          const lastUrl = this.executionContext?.lastObservation?.url;
          
          if (currentUrl !== lastUrl) {
            return { success: true }; // 页面跳转，点击有效
          }
          
          // 检查是否有弹窗或新元素出现
          const hasNewElements = await webContents.executeJavaScript(`
            (function() {
              // 检查常见的弹窗或反馈元素
              const dialogs = document.querySelectorAll('[role="dialog"], .modal, .popup, [class*="toast"], [class*="notification"]');
              if (dialogs.length > 0) return true;
              
              // 检查是否有视觉反馈（如 loading 状态）
              const loadings = document.querySelectorAll('[class*="loading"], [class*="spin"], [class*="progress"]');
              if (loadings.length > 0) return true;
              
              return false;
            })()
          `);
          
          if (hasNewElements) {
            return { success: true };
          }
          
          // 点击可能没有明显视觉反馈，保守认为成功
          return { success: true };
        }

        case 'type': {
          // 验证输入值是否正确设置
          await this._sleep(200);
          const target = decision.target?.selector || decision.selector;
          if (!target) return { success: true };
          
          const actualValue = await webContents.executeJavaScript(`
            (function() {
              const el = document.querySelector(${JSON.stringify(target)});
              if (!el) return null;
              return el.value || el.innerText || '';
            })()
          `);
          
          const expectedText = decision.text || '';
          if (actualValue === expectedText || actualValue.includes(expectedText)) {
            return { success: true };
          }
          
          // 部分匹配也接受
          if (expectedText.length > 0 && actualValue.length > 0) {
            return { success: true };
          }
          
          return { success: false, reason: '输入值验证失败' };
        }

        default:
          return { success: true };
      }
    } catch (err) {
      console.error(`[WindowCopilot:${this.windowId}] Post-execution verification error:`, err);
      return { success: true }; // 验证出错时保守返回成功
    }
  }

  /**
   * 重置状态
   */
  _resetState() {
    this.mode = 'chat';
    this.isExecuting = false;
    this.currentTask = null;
    this.stepCount = 0;
    this.memory = { history: [], findings: [] };
    this.loginWaitCount = 0;
    this._cancelled = false;
  }

  /**
   * 取消当前任务
   * @param {string} reason - 取消原因
   */
  async cancelTask(reason = '用户取消') {
    if (!this.isExecuting) {
      console.log(`[WindowCopilot:${this.windowId}] No task to cancel`);
      return false;
    }

    console.log(`[WindowCopilot:${this.windowId}] Cancelling task: ${reason}`);
    
    // 先设置取消标志（必须在重置状态之前）
    this._cancelled = true;

    // 发送取消事件（供前端显示状态）
    this._emitToWindow(COPILOT_EVENTS.TASK_CANCELLED, {
      reason,
      task: this.currentTask,
      stepCount: this.stepCount
    });

    // 重置状态（但保持 _cancelled 为 true 一段时间，确保旧流程退出）
    const wasCancelled = this._cancelled;
    this._resetState();
    // 重新设置取消标志，确保正在执行的异步操作能检测到
    this._cancelled = wasCancelled;
    
    // 500ms 后再清除取消标志，给旧流程足够时间退出
    setTimeout(() => {
      this._cancelled = false;
      console.log(`[WindowCopilot:${this.windowId}] Cancel flag cleared`);
    }, 500);

    return true;
  }

  /**
   * 映射内部模式为显示模式
   * CDP -> CDP
   * JS -> JS
   *
   * Note: SYSTEM/KM 模式已移除，避免与用户抢鼠标
   */
  _mapModeToDisplay(mode) {
    if (!mode) return 'JS';

    // 只支持 CDP 和 JS 模式
    if (mode === 'CDP' || mode === 'JS') {
      return mode;
    }

    // 其他情况默认返回 JS
    return 'JS';
  }

  /**
   * 睡眠等待
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 智能等待 - 根据操作类型和页面状态动态等待
   * @param {string} actionType - 操作类型 (navigate/click/type/scroll/screenshot)
   * @param {object} options - 可选配置
   * @returns {Promise<void>}
   */
  async _smartWait(actionType, options = {}) {
    const baseWait = {
      navigate: 500,     // 导航后等待页面加载
      click: 250,        // 点击后等待响应
      hover: 250,        // hover后等待下拉菜单/Tooltip显示
      select: 150,       // 选择后等待页面响应
      type: 100,         // 输入后短暂等待
      scroll: 400,       // 滚动后等待内容加载
      wheel: 500,        // 滚轮切换视频等待动画
      screenshot: 0,     // 截图无需等待
      press: 400,        // 按键后等待（如 Enter 提交）
      wait: 500          // 默认等待
    };

    const waitTime = options.ms || baseWait[actionType] || 500;

    // 如果是导航操作，额外检查页面加载状态
    if (actionType === 'navigate') {
      console.log(`[WindowCopilot:${this.windowId}] Smart wait for navigation...`);
      await this._waitForPageLoad(options);
      return;
    }

    // 如果是点击操作，检查页面是否开始响应（如 URL 变化、loading 出现）
    if (actionType === 'click') {
      const startTime = Date.now();
      const initialUrl = await this.getActiveViewWebContents()?.executeJavaScript('window.location.href').catch(() => '');

      await this._sleep(waitTime);

      // 检查是否有变化迹象
      const currentUrl = await this.getActiveViewWebContents()?.executeJavaScript('window.location.href').catch(() => initialUrl);
      if (currentUrl !== initialUrl) {
        console.log(`[WindowCopilot:${this.windowId}] Page navigated after click, extending wait...`);
        await this._sleep(1000); // 页面跳转，额外等待
      }
      return;
    }

    // 普通等待
    console.log(`[WindowCopilot:${this.windowId}] Smart wait: ${actionType} = ${waitTime}ms`);
    await this._sleep(waitTime);
  }

  /**
   * 等待页面加载完成
   * @param {object} options - 配置
   */
  async _waitForPageLoad(options = {}) {
    const webContents = this.getActiveViewWebContents();
    if (!webContents) {
      await this._sleep(options.ms || 2000);
      return;
    }

    const maxWait = options.maxWait || 10000; // 最大等待 10 秒
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      try {
        const loadState = await webContents.executeJavaScript(`
          (function() {
            return {
              readyState: document.readyState,
              loading: document.querySelectorAll('[class*="loading"], [class*="spinner"], [class*="skeleton"]').length,
              hasContent: document.body.innerText.length > 100
            };
          })()
        `);

        // 页面完成加载且有内容
        if (loadState.readyState === 'complete' && loadState.hasContent) {
          // 如果没有 loading 元素，认为加载完成
          if (loadState.loading === 0) {
            console.log(`[WindowCopilot:${this.windowId}] Page loaded in ${Date.now() - startTime}ms`);
            return;
          }
        }

        await this._sleep(200);
      } catch (e) {
        await this._sleep(500);
      }
    }

    console.log(`[WindowCopilot:${this.windowId}] Page load timeout, continuing...`);
  }

  /**
   * 等待特定元素出现（用于动态内容）
   * @param {string} selector - CSS 选择器
   * @param {number} timeout - 超时时间
   * @returns {Promise<boolean>}
   */
  async _waitForElement(selector, timeout = 5000) {
    const webContents = this.getActiveViewWebContents();
    if (!webContents) return false;

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const exists = await webContents.executeJavaScript(`
          !!document.querySelector(${JSON.stringify(selector)})
        `);
        if (exists) {
          console.log(`[WindowCopilot:${this.windowId}] Element ${selector} appeared in ${Date.now() - startTime}ms`);
          return true;
        }
        await this._sleep(200);
      } catch (e) {
        await this._sleep(200);
      }
    }

    return false;
  }

  /**
   * 等待页面稳定（无网络请求、无 DOM 变化）
   * @param {number} stabilityTime - 稳定时间
   * @param {number} timeout - 总超时
   * @returns {Promise<void>}
   */
  async _waitForStability(stabilityTime = 500, timeout = 5000) {
    const webContents = this.getActiveViewWebContents();
    if (!webContents) {
      await this._sleep(stabilityTime);
      return;
    }

    const startTime = Date.now();
    let lastDomHash = '';
    let stableSince = 0;

    while (Date.now() - startTime < timeout) {
      try {
        const currentHash = await webContents.executeJavaScript(`
          (function() {
            // 计算 DOM 内容的简单 hash
            const text = document.body ? document.body.innerText.substring(0, 1000) : '';
            let hash = 0;
            for (let i = 0; i < text.length; i++) {
              hash = ((hash << 5) - hash) + text.charCodeAt(i);
              hash = hash & hash;
            }
            return hash;
          })()
        `);

        if (currentHash === lastDomHash) {
          if (stableSince === 0) {
            stableSince = Date.now();
          } else if (Date.now() - stableSince >= stabilityTime) {
            console.log(`[WindowCopilot:${this.windowId}] Page stable after ${Date.now() - startTime}ms`);
            return;
          }
        } else {
          stableSince = 0;
          lastDomHash = currentHash;
        }

        await this._sleep(100);
      } catch (e) {
        await this._sleep(200);
      }
    }

    console.log(`[WindowCopilot:${this.windowId}] Stability timeout, continuing...`);
  }

  /**
   * 用户继续（登录后继续）
   */
  onUserContinue() {
    if (this.mode === 'action' && this.isExecuting) {
      this._continueAction({ success: true, resumed: true });
    }
  }

  /**
   * 停用
   */
  deactivate() {
    if (this.unsubscribeAI) {
      this.unsubscribeAI();
      this.unsubscribeAI = null;
    }
    this._resetState();
    this._emitToWindow(COPILOT_EVENTS.DEACTIVATED, { windowId: this.windowId });
  }
}

module.exports = { WindowCopilot };
