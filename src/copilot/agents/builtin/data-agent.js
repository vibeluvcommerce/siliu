/**
 * DataAgent - 数据采集专用 Agent
 * 
 * 适用场景：
 * - 网页数据抓取
 * - 表格导出
 * - 批量信息收集
 * - 自动化数据录入
 */

const { BaseAgent } = require('../base-agent');

class DataAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      id: 'data',
      name: '数据采集',
      icon: 'chart-bar',                // Phosphor 图标
      color: '#34A853',                 // 绿色渐变
      colorEnd: '#5BB974',
      description: '专业的网页数据采集和自动化工具',
      ...options
    });
  }

  /**
   * 数据采集特有领域知识
   */
  getDomainKnowledge() {
    return `【数据采集最佳实践】

【列表页采集】
- 先滚动加载全部内容（如果需要）
- 观察列表项的 DOM 结构，找到规律
- 提取：标题、链接、价格、时间等字段
- 注意分页：寻找"下一页"按钮或页码

【表格采集】
- table 标签是最常见的数据表格
- 表头通常是 thead > tr > th
- 数据行在 tbody > tr > td
- 注意合并单元格（colspan/rowspan）

【详情页采集】
- 从列表页获取所有详情页链接
- 逐个打开详情页提取完整信息
- 完成后返回列表页或关闭详情页
- 记得保存每个页面的数据

【数据保存】
- 少量数据：直接输出到对话
- 大量数据：建议保存为文件
- 支持格式：JSON、CSV、Markdown 表格

【反爬虫应对】
- 适当添加随机延迟（1-3秒）
- 遇到验证码暂停，请求用户协助
- 如果被封IP，建议降低采集频率`;
  }
}

module.exports = { DataAgent };
