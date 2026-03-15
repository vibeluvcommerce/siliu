/**
 * GeneralAgent - 通用浏览器助手（默认Agent）
 * 
 * 适用场景：
 * - 通用网站自动化
 * - 无需特殊领域知识的任务
 * - 默认 fallback
 */

const { BaseAgent } = require('../base-agent');

class GeneralAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      id: 'general',
      name: '通用助手',
      icon: 'robot',                    // Phosphor 图标
      color: '#1A73E8',                 // 蓝色渐变
      colorEnd: '#4285F4',
      description: '通用浏览器自动化，适用于大多数网站',
      ...options
    });
  }

  /**
   * 通用 Agent 可以添加一些全局最佳实践
   * 这些提示适用于所有网站
   */
  getDomainKnowledge() {
    return `【通用最佳实践】
- 导航到新页面后，先 wait 等待加载完成再操作
- 点击按钮后如果页面变化，先 screenshot 确认新状态
- 输入文本前先确认输入框已获得焦点
- 不确定元素位置时，优先使用 screenshot 查看
- 滚动页面后等待内容加载再执行下一步
- 操作失败后，尝试用不同方式完成目标（如坐标代替 selector）`;
  }
}

module.exports = { GeneralAgent };
