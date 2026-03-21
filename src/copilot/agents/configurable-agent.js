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
                // 添加站点和页面上下文信息
                coords[coord.name] = {
                  ...coord,
                  _siteDomain: site.domain,
                  _siteName: site.name,
                  _pageName: page.name,
                  _pageMatch: page.match
                };
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
   * 获取结构化的站点-页面-坐标信息
   */
  getStructuredCoordinates() {
    if (!this.config.sites) return null;
    
    return this.config.sites.map(site => ({
      domain: site.domain,
      name: site.name,
      description: site.description,
      pages: (site.pages || []).map(page => ({
        name: page.name,
        // 兼容旧版 path 字段和新版 match 字段
        match: page.match || page.path,
        description: page.description,
        coordinates: (page.coordinates || []).map(coord => ({
          name: coord.name,
          viewportX: coord.viewportX ?? 0,
          viewportY: coord.viewportY ?? 0,
          scrollX: coord.scrollX ?? 0,
          scrollY: coord.scrollY ?? 0,
          viewportWidth: coord.viewportWidth,
          viewportHeight: coord.viewportHeight,
          description: coord.description,
          action: coord.action || 'click',
          selector: coord.selector
        }))
      }))
    }));
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
    
    console.log(`[ConfigurableAgent:${this.id}] Building domain knowledge...`);
    
    // 1. 预置坐标（结构化输出）
    const structuredSites = this.getStructuredCoordinates();
    const flatCoords = this.getPresetCoordinates();
    console.log(`[ConfigurableAgent:${this.id}] Found ${Object.keys(flatCoords).length} preset coordinates in ${structuredSites?.length || 0} sites`);
    
    if (structuredSites && structuredSites.length > 0) {
      parts.push('【预置坐标配置 - 按网站/页面组织】');
      parts.push('以下坐标已按网站和页面分类，请根据当前 URL 选择对应的坐标使用：\n');
      
      for (const site of structuredSites) {
        // 网站级别信息
        parts.push(`▸ 网站: ${site.name || site.domain}`);
        parts.push(`  域名: ${site.domain}`);
        if (site.description) {
          parts.push(`  说明: ${site.description}`);
        }
        parts.push('');
        
        // 页面级别
        for (const page of site.pages) {
          if (page.coordinates.length === 0) continue;
          
          parts.push(`  📄 页面: ${page.name}`);
          if (page.match) {
            parts.push(`     URL匹配: ${page.match}`);
          }
          if (page.description) {
            parts.push(`     说明: ${page.description}`);
          }
          parts.push('');
          
          // 坐标列表
          for (const coord of page.coordinates) {
            parts.push(`     • ${coord.name}:`);
            parts.push(`       坐标: (${coord.viewportX.toFixed(3)}, ${coord.viewportY.toFixed(3)})`);
            parts.push(`       操作: ${coord.action}`);
            if (coord.description) {
              parts.push(`       用途: ${coord.description}`);
            }
            // 技术细节（可选，帮助调试）
            if (coord.scrollY !== 0 || coord.scrollX !== 0) {
              parts.push(`       [记录时滚动: ${coord.scrollX}, ${coord.scrollY}]`);
            }
            if (coord.selector) {
              parts.push(`       [备选选择器: ${coord.selector}]`);
            }
          }
          parts.push('');
        }
      }
      
      // 添加坐标使用指南
      parts.push('【坐标使用指南】');
      parts.push('1. 首先判断当前页面 URL 匹配哪个网站的域名');
      parts.push('2. 然后根据页面特征（如路径、标题）确定当前页面类型');
      parts.push('3. 使用该页面下标记的坐标进行自动化操作');
      parts.push('4. 坐标格式: {"type": "coordinate", "x": 0.302, "y": 0.522}');
      parts.push('5. 如果坐标失效，可使用对应的 CSS 选择器作为备选');
      parts.push('');
    } else if (Object.keys(flatCoords).length > 0) {
      // 兼容旧格式：扁平化输出
      parts.push('【预置坐标配置】');
      parts.push('以下坐标可直接使用，提高操作准确性：\n');
      
      for (const [name, info] of Object.entries(flatCoords)) {
        const action = info.action || 'click';
        parts.push(`- ${name}:`);
        const vx = info.viewportX ?? 0;
        const vy = info.viewportY ?? 0;
        parts.push(`  视口坐标: (${vx.toFixed(3)}, ${vy.toFixed(3)})`);
        if (info.scrollX !== undefined || info.scrollY !== undefined) {
          parts.push(`  记录时滚动位置: scrollX=${info.scrollX ?? 0}, scrollY=${info.scrollY ?? 0}`);
        }
        if (info.viewportWidth !== undefined || info.viewportHeight !== undefined) {
          parts.push(`  记录时视口尺寸: ${info.viewportWidth ?? 'unknown'}x${info.viewportHeight ?? 'unknown'}`);
        }
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
    
    // 2.1 性格与能力（新版格式）
    if (knowledge.personality) {
      parts.push('【Agent 性格与能力】');
      parts.push(knowledge.personality);
      parts.push('');
    }
    
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

    const result = parts.join('\n');
    console.log(`[ConfigurableAgent:${this.id}] Generated domain knowledge (${result.length} chars)`);
    console.log(`[ConfigurableAgent:${this.id}] Knowledge preview:`, result.substring(0, 200) + '...');
    return result;
  }

  /**
   * 获取元素定位指南（覆盖基类方法）
   */
  getElementGuides() {
    const structuredSites = this.getStructuredCoordinates();
    const flatCoords = this.getPresetCoordinates();
    
    if ((structuredSites?.length || 0) === 0 && Object.keys(flatCoords).length === 0) {
      return super.getElementGuides();
    }

    const hasStructure = (structuredSites?.length || 0) > 0;

    return `【元素定位指南】
${hasStructure ? `1. 坐标已按【网站 → 页面】层级组织，请先判断当前页面所属的网站和页面类型
2. 在对应页面下查找可用的预置坐标
3. 坐标格式: {"type": "coordinate", "x": 0.5, "y": 0.3} (值为 0-1 的相对坐标)
4. 如果页面不匹配或坐标失效，可使用 CSS 选择器作为备选
5. 不确定时可用 screenshot 查看当前页面状态，或询问用户当前所在页面` 
: `1. 优先使用预置坐标（已在【预置坐标配置】中定义）
2. 坐标格式: {"type": "coordinate", "x": 0.5, "y": 0.3}
3. 如坐标失效，可尝试 CSS 选择器作为备选
4. 不确定时可用 screenshot 查看当前页面状态`}`;
  }

  /**
   * 获取当前 URL 匹配的预置坐标信息（用于 AI 提示词）
   * @param {string} url - 当前页面 URL
   * @returns {string} 格式化后的坐标信息
   */
  getCurrentPageCoordinatesInfo(url) {
    if (!url || !this.config.sites) return '';
    
    const parts = [];
    let matchFound = false;
    
    for (const site of this.config.sites) {
      // 检查域名是否匹配
      if (!site.domain || !url.includes(site.domain)) continue;
      
      for (const page of site.pages || []) {
        // 检查页面是否匹配（使用 match 或 path）
        const matchPattern = page.match || page.path;
        if (!matchPattern) continue;
        
        // 检查 URL 是否匹配页面模式
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const isMatch = matchPattern === '/$' 
          ? pathname === '/' || pathname === ''
          : pathname.includes(matchPattern.replace(/\*/g, ''));
        
        if (!isMatch && matchPattern !== '*') continue;
        
        matchFound = true;
        parts.push('【当前页面匹配的预置坐标】');
        parts.push(`网站: ${site.name || site.domain}`);
        parts.push(`页面: ${page.name || '未命名页面'}`);
        parts.push(`匹配模式: ${matchPattern}`);
        parts.push('');
        
        if (page.coordinates && page.coordinates.length > 0) {
          parts.push('本页可用坐标:');
          for (const coord of page.coordinates) {
            parts.push(`  • ${coord.name}: (${coord.viewportX?.toFixed(3) ?? 0}, ${coord.viewportY?.toFixed(3) ?? 0})`);
            if (coord.description) {
              parts.push(`    用途: ${coord.description}`);
            }
          }
        } else {
          parts.push('本页暂无预置坐标');
        }
        parts.push('');
        break; // 找到第一个匹配的页面即可
      }
      
      if (matchFound) break;
    }
    
    return matchFound ? parts.join('\n') : '';
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
   * 构建页面观察部分（覆盖基类，添加当前 URL 匹配的坐标信息）
   */
  _buildObservationSection(observation) {
    // 先获取基类的观察部分
    const baseSection = super._buildObservationSection(observation);
    
    // 添加当前 URL 匹配的坐标信息
    const currentCoords = observation?.url 
      ? this.getCurrentPageCoordinatesInfo(observation.url)
      : '';
    
    if (currentCoords) {
      return baseSection + '\n\n' + currentCoords;
    }
    
    return baseSection;
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
