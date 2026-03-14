/**
 * PromptBuilder - 提示词构建器
 * 
 * 设计目标：
 * 1. 委托给 Agent 系统构建 Prompt
 * 2. 保持向后兼容（无 Agent 时降级）
 * 3. 统一管理视觉增强逻辑
 */

const { registry: agentRegistry } = require('./agents');
const { BaseAgent } = require('./agents/base-agent');

class PromptBuilder {
  constructor(options = {}) {
    this.maxSteps = options.maxSteps || 100;
    // 创建默认 Agent 用于向后兼容
    this.defaultAgent = new BaseAgent({
      id: 'default',
      name: '默认代理',
      description: '兼容模式'
    });
  }

  /**
   * 获取当前 Agent（或默认 Agent）
   */
  _getAgent() {
    return agentRegistry.getCurrent() || this.defaultAgent;
  }

  /**
   * 构建动作模式提示词
   * 
   * @param {string} task - 任务目标
   * @param {object} observation - 页面观察数据
   * @param {object} previousResult - 上一步执行结果
   * @param {number} stepCount - 当前步数
   * @param {array} history - 执行历史
   * @returns {string} 完整 Prompt
   */
  buildActionPrompt(task, observation = null, previousResult = null, stepCount = 0, history = []) {
    const agent = this._getAgent();
    return agent.buildActionPrompt({
      task,
      observation,
      previousResult,
      stepCount,
      history
    });
  }

  /**
   * 构建视觉增强提示词
   * 
   * @returns {object} { text, hasVisual }
   */
  buildVisualActionPrompt(task, observation = null, previousResult = null, stepCount = 0, history = []) {
    const agent = this._getAgent();
    return agent.buildVisualActionPrompt({
      task,
      observation,
      previousResult,
      stepCount,
      history
    });
  }

  /**
   * 构建对话模式提示词
   */
  buildChatPrompt(userMessage) {
    const agent = this._getAgent();
    return agent.buildChatPrompt(userMessage);
  }
}

module.exports = { PromptBuilder };
