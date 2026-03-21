/**
 * ConfigurableAgent - 从 YAML/JSON 配置加载的 Agent
 * 
 * 支持通过配置文件定义 Agent，无需编写代码：
 * - metadata: 名称、图标、颜色、描述等
 * - coordinates: 预置坐标配置
 * - knowledge: 领域知识（页面结构、常见任务等）
 * - domains: 适用域名（用于自动切换）
 */

const { BaseAgent } = require('./base-agent');

class ConfigurableAgent extends BaseAgent {
  constructor(config) {
    // 从配置中提取基础信息
    const color = config.metadata?.color || '#1A73E8';
    super({
      id: config.metadata?.id,
      name: config.metadata?.name,
      description: config.metadata?.description,
      icon: config.metadata?.icon || 'robot',
      color: color,
      colorEnd: config.metadata?.colorEnd || color, // 如果没有 colorEnd，使用单色
      ...config.behavior
    });
    
    this.config = config;
    this.sourceFile = config._sourceFile; // 配置文件路径（调试用）
  }

  /**
   * 获取 Agent 展示信息（覆盖基类，添加 updatedAt 和 isBuiltIn）
   */
  getDisplayInfo() {
    const baseInfo = super.getDisplayInfo();
    return {
      ...baseInfo,
      updatedAt: this.config.metadata?.updatedAt || null,
      isBuiltIn: false // 可配置 Agent 都是用户创建的
    };
  }

  /**
   * 获取适用域名列表
   */
  getDomains() {
    return this.config.domains || [];
  }

  /**
   * 检查 URL 是否匹配此 Agent
   */
  matchesUrl(url) {
    if (!url || !this.config.domains) return false;
    return this.config.domains.some(domain => url.includes(domain));
  }

  /**
   * 获取预置坐标配置（从 sites 中提取）
   */
  getPresetCoordinates() {
    // 新格式：从 sites 中提取坐标
    if (this.config.sites) {
      const coords = {};
      for (const site of this.config.sites) {
        if (site.pages) {
          for (const page of site.pages) {
            if (page.coordinates) {
              for (const coord of page.coordinates) {
                coords[coord.name] = coord;
              }
            }
          }
        }
      }
      return coords;
    }
    // 兼容旧格式
    return this.config.coordinates || {};
  }

  /**
   * 获取特定坐标的配置
   */
  getCoordinate(name) {
    return this.config.coordinates?.[name];
  }

  /**
   * 构建领域知识（覆盖基类方法）
   */
  getDomainKnowledge() {
    const parts = [];
    
    // 1. 预置坐标
    const coords = this.getPresetCoordinates();
    if (Object.keys(coords).length > 0) {
      parts.push('【预置坐标配置】');
      parts.push('以下坐标可直接使用，提高操作准确性：\n');
      
      for (const [name, info] of Object.entries(coords)) {
        const action = info.action || 'click';
        parts.push(`- ${name}:`);
        // 优先使用 docX/docY，兼容旧格式 x/y
        const x = info.docX ?? info.x ?? 0;
        const y = info.docY ?? info.y ?? 0;
        parts.push(`  坐标: (${x}, ${y})`);
        parts.push(`  描述: ${info.description || '无描述'}`);
        parts.push(`  默认操作: ${action}`);
        if (info.selector) {
          parts.push(`  CSS选择器: ${info.selector}（备用）`);
        }
        parts.push('');
      }
    }

    // 2. 页面结构知识
    const knowledge = this.config.knowledge || {};
    if (knowledge.pageStructure) {
      parts.push('【页面结构】');
      parts.push(knowledge.pageStructure);
      parts.push('');
    }

    // 3. 常见任务
    if (knowledge.commonTasks && Array.isArray(knowledge.commonTasks)) {
      parts.push('【常见任务步骤】');
      knowledge.commonTasks.forEach((task, i) => {
        parts.push(`${i + 1}. ${task}`);
      });
      parts.push('');
    }

    // 4. 反检测提示
    if (knowledge.antiDetection && Array.isArray(knowledge.antiDetection)) {
      parts.push('【反检测建议】');
      knowledge.antiDetection.forEach(tip => {
        parts.push(`- ${tip}`);
      });
      parts.push('');
    }

    // 5. 自定义 Prompt 片段
    if (knowledge.customPrompt) {
      parts.push('【补充说明】');
      parts.push(knowledge.customPrompt);
    }

    return parts.join('\n');
  }

  /**
   * 获取元素定位指南（覆盖基类方法）
   */
  getElementGuides() {
    const coords = this.getPresetCoordinates();
    
    if (Object.keys(coords).length === 0) {
      return super.getElementGuides();
    }

    return `【元素定位指南】
1. 优先使用预置坐标（已在【预置坐标配置】中定义）
2. 坐标格式: {"type": "coordinate", "x": 0.5, "y": 0.3}
3. 如坐标失效，可尝试 CSS 选择器作为备选
4. 不确定时可用 screenshot 查看当前页面状态`;
  }

  /**
   * 获取行为配置
   */
  getBehaviorConfig() {
    return {
      waitAfterNavigate: 2000,
      waitAfterClick: 500,
      waitAfterType: 200,
      waitAfterScroll: 500,
      maxRetry: 3,
      ...this.config.behavior
    };
  }

  /**
   * 获取 Agent 元信息（扩展）
   */
  getMetadata() {
    return {
      ...super.getMetadata(),
      domains: this.getDomains(),
      coordinateCount: Object.keys(this.getPresetCoordinates()).length,
      isConfigurable: true,
      sourceFile: this.sourceFile
    };
  }

  /**
   * 验证配置是否有效
   */
  static validateConfig(config) {
    const errors = [];
    
    if (!config.metadata) {
      errors.push('缺少 metadata 字段');
    } else {
      if (!config.metadata.id) errors.push('metadata.id 必填');
      if (!config.metadata.name) errors.push('metadata.name 必填');
    }

    // ID 格式检查
    if (config.metadata?.id) {
      if (!/^[a-z0-9_-]+$/.test(config.metadata.id)) {
        errors.push('metadata.id 只能包含小写字母、数字、下划线和横线');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

module.exports = { ConfigurableAgent };
