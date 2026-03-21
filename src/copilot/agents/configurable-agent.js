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
          // 保留原始 URL，供 AI 匹配使用
          url: coord.url,
          viewportX: coord.viewportX ?? 0,
          viewportY: coord.viewportY ?? 0,
          scrollX: coord.scrollX ?? 0,
          scrollY: coord.scrollY ?? 0,
          viewportWidth: coord.viewportWidth,
          viewportHeight: coord.viewportHeight,
          description: coord.description,
          tag: coord.tag,
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
      parts.push('【预置坐标配置 - 全局概览】');
      parts.push(`本 Agent 包含 ${structuredSites.length} 个网站的预置坐标，每个坐标包含原始 URL 信息。`);
      parts.push('系统会自动根据当前页面 URL 匹配最合适的坐标。\n');
      
      for (const site of structuredSites) {
        // 计算该网站的坐标数量
        const coordCount = site.pages.reduce((sum, p) => sum + p.coordinates.length, 0);
        parts.push(`▸ ${site.domain} (${coordCount} 个坐标)`);
        
        // 页面级别
        for (const page of site.pages) {
          if (page.coordinates.length === 0) continue;
          
          parts.push(`  📄 路径: ${page.match || '/'}`);
          
          // 坐标列表（简洁版，包含滚动信息）
          for (const coord of page.coordinates) {
            let coordInfo = `     • ${coord.name}: (${coord.viewportX.toFixed(3)}, ${coord.viewportY.toFixed(3)})`;
            // 如果有滚动，添加标记
            const hasScroll = (coord.scrollX && coord.scrollX !== 0) || (coord.scrollY && coord.scrollY !== 0);
            if (hasScroll) {
              coordInfo += ` [滚动: ${coord.scrollX ?? 0}, ${coord.scrollY ?? 0}]`;
            }
            parts.push(coordInfo);
          }
          parts.push('');
        }
      }
      
      // 添加坐标使用指南
      parts.push('【坐标使用指南】');
      parts.push('1. 匹配逻辑：系统会自动对比当前 URL 与预置坐标的原始 URL');
      parts.push('2. 匹配规则：域名必须相同，路径相同或前缀匹配');
      parts.push('3. 坐标格式：{"type": "coordinate", "x": 0.302, "y": 0.522}');
      parts.push('4. 滚动注意：如果坐标标记了[滚动:x,y]，说明记录时页面已滚动');
      parts.push('   - 当前页面滚动位置应与记录时相近，坐标才准确');
      parts.push('   - 如果滚动位置差异大，建议重新定位元素');
      parts.push('5. 优先使用：匹配度高的坐标会在【当前页面可用的预置坐标】中列出');
      parts.push('6. 失效处理：如果坐标失效，结合 screenshot 重新定位元素');
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
    
    // 2.1 性格与能力（支持字符串或对象格式）
    const personality = typeof knowledge === 'string' ? knowledge : knowledge.personality;
    if (personality) {
      parts.push('【Agent 性格与能力】');
      parts.push(personality);
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
    const currentUrl = url.toLowerCase();
    let matchedCoords = [];
    let matchDetails = [];
    
    // 遍历所有坐标，找出 URL 匹配的
    for (const site of this.config.sites) {
      for (const page of site.pages || []) {
        for (const coord of page.coordinates || []) {
          if (!coord.url) continue;
          
          const coordUrl = coord.url.toLowerCase();
          
          try {
            const currentUrlObj = new URL(currentUrl);
            const coordUrlObj = new URL(coordUrl);
            
            // 计算 URL 相似度：域名相同 + 路径相似
            const currentHostname = currentUrlObj.hostname;
            const coordHostname = coordUrlObj.hostname;
            
            // 只匹配同域名的坐标
            if (currentHostname !== coordHostname) continue;
            
            const currentPath = currentUrlObj.pathname;
            const coordPath = coordUrlObj.pathname;
            
            // 路径相同或当前路径以坐标路径开头（适用于子页面）
            const isPathMatch = currentPath === coordPath || 
                               currentPath.startsWith(coordPath + '/');
            
            if (isPathMatch) {
              const matchType = currentPath === coordPath ? '完全匹配' : '前缀匹配';
              matchedCoords.push({
                ...coord,
                _matchScore: currentPath === coordPath ? 2 : 1,
                _matchType: matchType
              });
            }
          } catch (e) {
            // URL 解析失败，跳过
            continue;
          }
        }
      }
    }
    
    // 按匹配分数排序
    matchedCoords.sort((a, b) => b._matchScore - a._matchScore);
    
    if (matchedCoords.length > 0) {
      parts.push('【当前页面可用的预置坐标】');
      parts.push(`找到 ${matchedCoords.length} 个匹配的预置坐标，已按匹配度排序：`);
      parts.push('');
      
      for (const coord of matchedCoords) {
        parts.push(`  • ${coord.name}: (${coord.viewportX?.toFixed(3) ?? 0}, ${coord.viewportY?.toFixed(3) ?? 0})`);
        parts.push(`    匹配类型: ${coord._matchType}`);
        if (coord.description) {
          parts.push(`    说明: ${coord.description}`);
        }
        if (coord.tag) {
          parts.push(`    元素类型: ${coord.tag}`);
        }
        // 添加滚动信息，帮助 AI 理解坐标记录时的页面状态
        const hasScroll = (coord.scrollX && coord.scrollX !== 0) || (coord.scrollY && coord.scrollY !== 0);
        if (hasScroll) {
          parts.push(`    记录时滚动: scrollX=${coord.scrollX ?? 0}, scrollY=${coord.scrollY ?? 0}`);
          parts.push(`    ⚠️ 注意: 此坐标记录时页面有滚动，使用前请检查当前页面滚动位置`);
        }
        parts.push(`    使用: {"type": "coordinate", "x": ${coord.viewportX?.toFixed(3) ?? 0}, "y": ${coord.viewportY?.toFixed(3) ?? 0}}`);
        parts.push('');
      }
    }
    
    return parts.join('\n');
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
    
    // 添加坐标匹配指南
    const matchingGuide = this.config.sites ? `
【坐标匹配指南】
当前页面: ${observation?.url || '未知'}
预置坐标总数: ${this.config.sites.reduce((sum, s) => sum + (s.pages?.reduce((pSum, p) => pSum + (p.coordinates?.length || 0), 0) || 0), 0)} 个
匹配逻辑: 域名相同 && (路径相同 || 路径前缀匹配)
` : '';
    
    if (currentCoords) {
      return baseSection + matchingGuide + '\n' + currentCoords;
    } else if (this.config.sites) {
      // 有预置坐标但当前页面不匹配
      return baseSection + matchingGuide + `
【预置坐标提示】
当前页面 URL 与所有预置坐标都不匹配。
可用预置坐标网站: ${this.config.sites.map(s => s.domain).join(', ')}
建议: 导航到上述网站使用预置坐标，或手动操作。
`;
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
