// src/copilot/execution-confirmation.js
// 执行确认机制 - 验证每步操作的效果

const { globalEventBus } = require('../core/event-bus');
const { COPILOT_EVENTS } = require('../core/events');

// 确认结果类型
const ConfirmationResult = {
  SUCCESS: 'success',      // 执行成功，继续下一步
  FAILURE: 'failure',      // 执行失败，需要重试或调整
  UNCERTAIN: 'uncertain',  // 结果不确定，需要更多信息
  NEED_USER: 'need_user'   // 需要用户介入
};

class ExecutionConfirmation {
  constructor(options = {}) {
    this.mode = options.mode || 'auto';  // 'auto' | 'manual' | 'hybrid'
    this.timeout = options.timeout || 30000;  // 等待确认超时时间
    this.similarityThreshold = options.similarityThreshold || 0.9;  // 截图相似度阈值
  }

  /**
   * 执行确认流程
   * @param {Object} decision - AI决策
   * @param {Object} result - 执行结果
   * @param {Object} context - 执行上下文
   * @returns {Promise<{status: string, analysis: string, suggestion: string}>}
   */
  async confirm(decision, result, context) {
    console.log(`[ExecutionConfirmation] Confirming: ${decision.action}`);

    // 1. 基本执行结果检查
    if (!result.success) {
      return {
        status: ConfirmationResult.FAILURE,
        analysis: `执行失败: ${result.error}`,
        suggestion: '检查错误原因，可能需要调整策略或等待页面加载',
        result: result
      };
    }

    // 2. 根据模式选择确认方式
    switch (this.mode) {
      case 'manual':
        return await this._manualConfirm(decision, result, context);
      case 'hybrid':
        return await this._hybridConfirm(decision, result, context);
      case 'auto':
      default:
        return await this._autoConfirm(decision, result, context);
    }
  }

  /**
   * 自动确认 - 截图对比分析
   */
  async _autoConfirm(decision, result, context) {
    // 等待页面稳定
    await this._sleep(1000);

    // 截图对比（如果有前后截图）
    let changeDetected = true;
    
    if (context.beforeScreenshot && context.afterScreenshot) {
      // 简单的截图对比（检查是否有变化）
      changeDetected = await this._compareScreenshots(
        context.beforeScreenshot, 
        context.afterScreenshot
      );
    }

    // 根据操作类型判断预期效果
    const expectedOutcome = this._getExpectedOutcome(decision);
    
    if (!changeDetected && decision.action !== 'wait') {
      return {
        status: ConfirmationResult.UNCERTAIN,
        analysis: '页面可能没有变化，需要进一步验证',
        suggestion: '截图对比未检测到明显变化，建议AI重新分析当前状态',
        result: result,
        screenshots: {
          before: context.beforeScreenshot,
          after: context.afterScreenshot
        }
      };
    }

    return {
      status: ConfirmationResult.SUCCESS,
      analysis: `执行成功: ${decision.action}`,
      suggestion: '继续下一步',
      result: result
    };
  }

  /**
   * 人工确认 - 等待用户点击确认
   */
  async _manualConfirm(decision, result, context) {
    // 发送确认请求到前端
    const confirmPromise = new Promise((resolve) => {
      this._pendingConfirmation = resolve;
      
      // 通过事件总线发送确认请求
      globalEventBus.emit('copilot:confirm-request', {
        decision: decision,
        result: result,
        message: `请确认: ${decision.description || decision.action}`,
        screenshot: context.afterScreenshot
      });
    });

    // 设置超时
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Confirmation timeout')), this.timeout);
    });

    try {
      const userResponse = await Promise.race([confirmPromise, timeoutPromise]);
      
      return {
        status: userResponse.confirmed ? ConfirmationResult.SUCCESS : ConfirmationResult.FAILURE,
        analysis: userResponse.confirmed ? '用户确认执行成功' : '用户标记执行失败',
        suggestion: userResponse.confirmed ? '继续下一步' : '根据用户反馈调整策略',
        result: result,
        userResponse: userResponse
      };
    } catch (err) {
      // 超时，自动继续
      return {
        status: ConfirmationResult.SUCCESS,
        analysis: '执行完成（确认超时，自动继续）',
        suggestion: '继续下一步',
        result: result
      };
    }
  }

  /**
   * 混合确认 - 自动 + 异常时人工
   */
  async _hybridConfirm(decision, result, context) {
    // 先自动确认
    const autoResult = await this._autoConfirm(decision, result, context);
    
    // 如果自动确认不确定或失败，转为人工确认
    if (autoResult.status === ConfirmationResult.UNCERTAIN || 
        autoResult.status === ConfirmationResult.FAILURE) {
      console.log('[ExecutionConfirmation] Auto uncertain, switching to manual');
      return await this._manualConfirm(decision, result, context);
    }
    
    return autoResult;
  }

  /**
   * 处理用户确认响应
   */
  handleUserConfirmation(response) {
    if (this._pendingConfirmation) {
      this._pendingConfirmation(response);
      this._pendingConfirmation = null;
    }
  }

  /**
   * 获取预期操作结果
   */
  _getExpectedOutcome(decision) {
    const outcomes = {
      'click': '页面导航或元素状态变化',
      'type': '输入框内容更新',
      'scroll': '页面滚动位置变化',
      'navigate': '页面完全刷新',
      'wait': '等待时间结束',
      'screenshot': '截图完成'
    };
    return outcomes[decision.action] || '未知操作';
  }

  /**
   * 简单截图对比（检查是否有变化）
   * 实际实现可以使用图像哈希或像素对比
   */
  async _compareScreenshots(before, after) {
    // 简化实现：比较文件大小
    if (before.size && after.size) {
      const sizeDiff = Math.abs(before.size - after.size) / before.size;
      return sizeDiff > 0.05;  // 大小变化超过5%认为有变化
    }
    return true;  // 默认认为有变化
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { 
  ExecutionConfirmation, 
  ConfirmationResult 
};
