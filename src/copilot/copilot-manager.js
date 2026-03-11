/**
 * CopilotManager - 管理所有窗口的 Copilot 实例
 * 
 * 职责：
 * - 为每个窗口创建独立的 WindowCopilot
 * - 统一订阅 AI 消息并按 sessionKey 分发到对应窗口
 * - 处理窗口创建/销毁
 */

const { globalEventBus } = require('../core/event-bus');
const { WindowCopilot } = require('./window-copilot');

class CopilotManager {
  constructor(options = {}) {
    this.aiServiceManager = options.aiServiceManager;
    this.core = options.core;
    this.configManager = options.configManager;
    this.controller = options.controller;  // SiliuController
    
    // 窗口ID -> WindowCopilot 映射
    this.copilots = new Map();
    
    // 默认窗口ID
    this.defaultWindowId = 'main';
    
    // AI 消息订阅取消函数
    this.unsubscribeAI = null;
  }

  /**
   * 初始化
   * 注意：不在初始化时创建 Copilot 实例，延迟到用户点击 Copilot 按钮时创建
   */
  async initialize() {
    // 统一订阅 AI 消息
    this._setupMessageRouter();
    // 不自动创建 Copilot，等待用户点击按钮时创建
  }

  /**
   * 设置消息路由器
   */
  _setupMessageRouter() {
    // 取消之前的订阅
    if (this.unsubscribeAI) {
      this.unsubscribeAI();
    }
    
    // 订阅所有 AI 消息
    this.unsubscribeAI = this.aiServiceManager.onMessage((data) => {
      this._routeMessage(data);
    });
  }

  /**
   * 路由消息到对应窗口
   */
  _routeMessage(data) {
    const payload = data.payload || {};
    const sessionKey = payload.sessionKey || '';
    
    // 从 sessionKey 提取窗口ID (格式: agent:window:${windowId})
    let targetWindowId = null;
    if (sessionKey.startsWith('agent:window:')) {
      targetWindowId = sessionKey.replace('agent:window:', '');
    }
    
    // 如果没有匹配的窗口ID，广播到所有窗口
    if (!targetWindowId) {
      for (const [windowId, copilot] of this.copilots) {
        copilot.handleMessage(data);
      }
      return;
    }
    
    // 尝试查找窗口（支持字符串和数字类型的 key）
    let copilot = this.copilots.get(targetWindowId);
    if (!copilot && !isNaN(targetWindowId)) {
      copilot = this.copilots.get(Number(targetWindowId));
    }
    if (!copilot) {
      copilot = this.copilots.get(String(targetWindowId));
    }
    
    if (copilot) {
      copilot.handleMessage(data);
    } else {
      // 广播到所有窗口
      for (const [windowId, c] of this.copilots) {
        c.handleMessage(data);
      }
    }
  }

  /**
   * 为指定窗口创建 Copilot
   */
  async createCopilot(windowId) {
    if (this.copilots.has(windowId)) {
      return this.copilots.get(windowId);
    }

    const copilot = new WindowCopilot({
      windowId,
      aiServiceManager: this.aiServiceManager,
      core: this.core,
      configManager: this.configManager,
      controller: this.controller,  // 传递 SiliuController
      // 不再直接订阅消息，由 CopilotManager 分发
      skipMessageSubscription: true
    });

    await copilot.activate();
    this.copilots.set(windowId, copilot);
    
    return copilot;
  }

  /**
   * 获取指定窗口的 Copilot
   */
  getCopilot(windowId = this.defaultWindowId) {
    return this.copilots.get(windowId);
  }

  /**
   * 销毁指定窗口的 Copilot
   */
  destroyCopilot(windowId) {
    const copilot = this.copilots.get(windowId);
    if (copilot) {
      copilot.deactivate();
      this.copilots.delete(windowId);
    }
  }

  /**
   * 发送消息到指定窗口的 Copilot
   */
  async sendMessage(text, windowId = this.defaultWindowId) {
    const copilot = this.copilots.get(windowId);
    if (!copilot) {
      throw new Error('Copilot not found for this window');
    }
    return copilot.sendMessage(text);
  }

  /**
   * 用户继续（登录后继续）
   */
  onUserContinue(windowId = this.defaultWindowId) {
    const copilot = this.copilots.get(windowId);
    if (copilot) {
      copilot.onUserContinue();
    }
  }

  /**
   * 停用所有 Copilot
   */
  deactivateAll() {
    // 取消消息订阅
    if (this.unsubscribeAI) {
      this.unsubscribeAI();
      this.unsubscribeAI = null;
    }
    
    // 停用所有 copilot
    for (const [windowId, copilot] of this.copilots) {
      copilot.deactivate();
    }
    this.copilots.clear();
  }
}

module.exports = { CopilotManager };
