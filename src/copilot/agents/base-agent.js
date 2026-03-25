/**
 * BaseAgent - 所有 Agent 的基类
 * 
 * 设计目标：
 * 1. 提供统一的 Prompt 构建接口
 * 2. 支持分层扩展（基础层 → 领域层 → 场景层）
 * 3. 向后兼容原有 PromptBuilder 调用方式
 * 
 * 扩展指南：
 * - 覆盖 getDomainKnowledge() 添加特定网站知识
 * - 覆盖 processObservation() 优化元素提取
 * - 覆盖 getElementGuides() 添加元素定位提示
 */

class BaseAgent {
  constructor(options = {}) {
    // 基础信息（子类必须覆盖）
    this.id = options.id || 'base';
    this.name = options.name || '基础代理';
    this.icon = options.icon || 'robot';           // Phosphor 图标名称
    this.color = options.color || '#1A73E8';       // 图标背景色（渐变起点）
    this.colorEnd = options.colorEnd || '#4285F4'; // 图标背景色（渐变终点）
    this.description = options.description || '通用浏览器自动化能力';
    
    // 配置（可选覆盖）
    this.config = {
      maxSteps: 100,
      observeTimeout: 10000,
      maxElements: 25,      // 最大元素数量
      maxHistorySteps: 20,  // 历史记录显示步数
      ...options
    };
  }
  
  /**
   * 获取 Agent 展示信息
   * 用于 UI 渲染
   */
  getDisplayInfo() {
    return {
      id: this.id,
      name: this.name,
      icon: this.icon,           // Phosphor 图标名，如 'robot'
      color: this.color,         // 渐变起点色
      colorEnd: this.colorEnd,   // 渐变终点色
      description: this.description,
      isBuiltIn: true            // 内置 Agent
    };
  }

  // ============================================================
  // 1. 基础 Prompt 组件（子类可覆盖）
  // ============================================================

  /**
   * 系统角色定义 - 基础层
   * 描述 AI 的身份和核心职责
   */
  getSystemPrompt() {
    return `你是 Siliu Browser 的 AI Copilot，可以通过 CDP 控制浏览器完成自动化任务。

你的职责：
1. 理解用户的整体目标
2. 自主规划每一步操作
3. 根据执行结果调整策略
4. 确认任务完成后结束

【工作区目录】
所有用户数据存储在 ~/.siliu/workspace/ 目录下（~ 表示用户主目录）：
- 截图: ~/.siliu/workspace/screenshots/     (AI 操作截图、页面截图)
- 上传: ~/.siliu/workspace/auto-files/uploads/  (AI 准备上传的文件)
- 下载: ~/.siliu/workspace/auto-files/downloads/ (AI 控制下载的文件)
- 导出: ~/.siliu/workspace/exports/         (PDF、图片、数据等导出文件)`;
  }

  /**
   * 操作定义 - 基础层
   * 返回所有可用操作的定义
   */
  getActionSchema() {
    return {
      navigate: { 
        params: ['url'], 
        desc: '导航到指定URL',
        example: { action: 'navigate', url: 'google.com', description: '打开 Google 首页' }
      },
      click: { 
        params: ['selector|target'], 
        desc: '点击元素，支持坐标 {type:"coordinate",x:0.5,y:0.3}',
        example: { action: 'click', target: { type: 'coordinate', x: 0.5, y: 0.3 }, description: '点击搜索框' }
      },
      hover: { 
        params: ['selector|target'], 
        desc: '鼠标悬停（触发下拉菜单等），支持坐标',
        example: { action: 'hover', selector: '.dropdown-menu', description: '悬停显示下拉菜单' }
      },
      type: { 
        params: ['selector|target', 'text'], 
        desc: '在输入框输入文本，支持坐标或selector',
        example: { action: 'type', target: { type: 'coordinate', x: 0.5, y: 0.3 }, text: 'iPhone', description: '输入搜索关键词' }
      },
      upload: { 
        params: ['target', 'filePath'], 
        desc: '上传本地文件，filePath使用绝对路径',
        example: { action: 'upload', target: { type: 'coordinate', x: 0.5, y: 0.8 }, filePath: 'D:/images/photo.jpg', description: '上传本地图片' }
      },
      select: { 
        params: ['selector', 'option'], 
        desc: '选择下拉框选项，option可以是value、text或index',
        example: { action: 'select', selector: 'select[name="country"]', option: 'China', description: '选择国家为中国' }
      },
      selectAll: { 
        params: ['target'], 
        desc: '全选文本框内容（Ctrl+A），用于复制或替换',
        example: { action: 'selectAll', target: { type: 'coordinate', x: 0.5, y: 0.3 }, description: '全选搜索框内容' }
      },
      press: { 
        params: ['key'], 
        desc: '按键（Enter/Backspace/Delete/Tab/Escape/ArrowDown等）',
        example: { action: 'press', key: 'Enter', description: '按回车提交搜索' }
      },
      scroll: { 
        params: ['direction', 'amount'], 
        desc: '滚动页面（普通网页）',
        example: { action: 'scroll', direction: 'down', amount: 500, description: '向下滚动页面' }
      },
      wheel: { 
        params: ['direction', 'amount'], 
        desc: '滚轮事件（抖音/视频类网站推荐）',
        example: { action: 'wheel', direction: 'down', amount: 800, description: '滚轮切换视频' }
      },
      screenshot: { 
        params: [], 
        desc: '截图查看页面状态',
        example: { action: 'screenshot', description: '截图查看当前状态' }
      },
      wait: { 
        params: ['ms'], 
        desc: '等待一段时间（毫秒）',
        example: { action: 'wait', ms: 1000, description: '等待页面加载' }
      },
      yes: { 
        params: [], 
        desc: '步骤确认：当前步骤已完成/成功',
        example: { action: 'yes', description: '步骤执行成功' }
      },
      no: { 
        params: [], 
        desc: '步骤确认：当前步骤失败/需要重试',
        example: { action: 'no', description: '步骤执行失败，需要重试' }
      },
      collect: {
        params: ['content', 'batchIndex', 'hasMore'],
        desc: '采集数据批次，用于导出',
        example: { action: 'collect', content: { type: 'table', data: { headers: ['商品', '价格'], rows: [['iPhone', 5999]] } }, batchIndex: 0, hasMore: true, description: '采集第1页数据' }
      },
      export: {
        params: ['format', 'filename'],
        desc: '触发数据导出（可选，系统会自动导出）',
        example: { action: 'export', format: 'excel', filename: '商品数据', description: '导出采集的数据' }
      },
      done: { 
        params: ['summary'], 
        desc: '【最终完成】整个任务全部完成，输出总结',
        example: { action: 'done', summary: '任务完成总结' }
      }
    };
  }

  /**
   * 执行流程和规则 - 基础层
   * 描述操作的基本流程和约束
   */
  getRulesPrompt() {
    return `【执行流程】
1. 分析当前任务：要完成什么？已完成了什么？
2. 判断下一步：需要执行什么操作？
3. 执行操作：输出 navigate/click/type/scroll 等
4. 步骤确认：执行后输出 yes（成功）或 no（失败）
5. 继续循环：直到整个任务完成
6. 最终完成：所有子任务都完成后，输出 done

【重要规则】
- 每执行一步操作后，必须输出 yes 确认成功
- 如果操作失败，输出 no，我会让你重试
- 只有整个任务全部完成，才能使用 done
- 【强制】无论已执行多少步，都不允许自主结束任务
- 禁止提前使用 done 结束任务

【坐标系统】
- 使用 0-1 的相对坐标（百分比）
- 左上角为 (0, 0)，右下角为 (1, 1)
- 精度 0.1 即可，无需精确到 0.01
- 坐标格式: {"type": "coordinate", "x": 0.5, "y": 0.3}

【通用等待策略】
- 导航后：wait 500-2000ms
- 点击后：wait 300-500ms
- 输入后：wait 200ms
- 滚动后：wait 500ms
- 不确定时：screenshot 查看状态

【登录和验证码处理】
- 如果页面需要登录/扫码/验证码，使用 wait 操作等待用户完成
- 不要尝试自动输入账号密码或破解验证码
- 等待时间：第1次20秒 → 第2次90秒 → 第3次180秒
- 超过3次仍未登录则结束任务`;
  }

  /**
   * 操作示例 - 基础层
   * 提供具体的 JSON 输出示例
   */
  getExamplesPrompt() {
    const schema = this.getActionSchema();
    const examples = Object.values(schema)
      .filter(s => s.example)
      .map(s => `执行操作: ${JSON.stringify(s.example)}`)
      .join('\n');
    
    return `【输出格式示例】
${examples}
步骤确认: {"action": "yes", "description": "步骤执行成功"} 或 {"action": "no", "description": "步骤执行失败"}
最终完成: {"action": "done", "summary": "任务完成总结"}

【强制要求】
- 每个操作必须包含 description 字段，且不能为空
- description 应该清晰描述正在做什么，例如:"点击搜索按钮"、"输入用户名"、"向下滚动"等
- 不允许输出空的 description，这是必填字段

【注意】
- type 操作可以使用 target（坐标）或 selector（CSS选择器）
- 如果不确定选择器，优先使用坐标点击输入框，然后输入文本
- press 支持：Enter、Backspace、Delete、Tab、Escape、方向键
- selectAll 支持：使用 Ctrl+A 全选文本框内容，配合 type 可替换原有内容
- upload 支持上传本地文件，filePath 使用绝对路径（如 "D:/images/photo.jpg"）
- 【重要】抖音/视频类网站请使用 wheel 而非 scroll 来切换视频
- 输入错误时可使用 press + Backspace 删除后重新输入

【数据导出指南】
如需导出网页数据（表格、列表等），使用 collect 操作分批采集：

1. 表格数据格式：
   {"action": "collect", "content": {"type": "table", "data": {"headers": ["商品", "价格"], "rows": [["iPhone", 5999]]}}, "batchIndex": 0, "hasMore": true}

2. 列表数据格式：
   {"action": "collect", "content": {"type": "list", "data": {"items": ["item1", "item2"]}}, "batchIndex": 0, "hasMore": true}

3. 图片字段格式（自动下载插入）：
   rows 中可以包含 {"type": "image", "url": "https://...", "alt": "描述"}

4. 多页采集：
   - 每页输出一个 collect，batchIndex 递增
   - 最后一页设置 hasMore: false
   - 系统会自动合并所有批次并导出

5. 导出格式：
   - excel: 支持图片嵌入
   - csv: 图片转为 URL 文本
   - json: 原始数据结构
   - pdf: 生成报告文档
   - png: 生成图表图片

6. 超时处理：
   - 180秒无新数据自动导出已采集部分
   - 使用 export action 可手动提前触发导出`;
  }

  /**
   * 元素定位指南 - 基础层
   * 子类可覆盖以提供特定网站的定位技巧
   */
  getElementGuides() {
    return `【元素定位指南】
- 优先使用元素的索引 [n] 配合 xpath
- 或使用完整路径，如: {"xpath": "//button[1]"}
- 不确定时可用坐标: {"target": {"type": "coordinate", "x": 0.5, "y": 0.3}}
- 相对位置: 通过 ↑ ↓ 标识的相邻元素辅助定位`;
  }

  /**
   * 领域特定知识 - 需要子类覆盖
   * 这是 Agent 的核心扩展点
   */
  getDomainKnowledge() {
    // 子类覆盖此方法添加特定网站知识
    return '';
  }

  // ============================================================
  // 2. Prompt 构建方法（通常不需要覆盖）
  // ============================================================

  /**
   * 构建完整的 Action Prompt
   * 
   * 调用方式兼容：
   * 1. Agent 风格: buildActionPrompt({task, observation, previousResult, stepCount, history})
   * 2. 旧风格: buildActionPrompt(task, observation, previousResult, stepCount, history)
   */
  buildActionPrompt(contextOrTask, observation, previousResult, stepCount, history) {
    // 统一参数处理
    const context = this._normalizeArguments(contextOrTask, observation, previousResult, stepCount, history);
    
    console.log(`[${this.id}] buildActionPrompt: task="${context.task?.substring(0, 30)}...", elements=${context.observation?.elements?.length || 0}, history=${context.history?.length}`);
    
    // 按顺序组装 Prompt
    const parts = [
      this.getSystemPrompt(),
      this._buildActionHelp(),
      this.getRulesPrompt(),
      this.getExamplesPrompt(),
      this.getElementGuides(),
      this.getDomainKnowledge(), // 子类特定知识
      this._buildTaskContext(context)
    ];
    
    return parts.filter(p => p && p.trim()).join('\n\n');
  }

  /**
   * 构建视觉增强的 Action Prompt
   * 添加截图信息和视觉辅助
   */
  buildVisualActionPrompt(contextOrTask, observation, previousResult, stepCount, history) {
    const context = this._normalizeArguments(contextOrTask, observation, previousResult, stepCount, history);
    
    // 构建基础 Prompt
    const basePrompt = this.buildActionPrompt(context);
    
    // 如果没有截图，返回基础 Prompt
    if (!context.observation?.screenshot) {
      return { text: basePrompt };
    }

    // 添加视觉辅助信息
    const visualGuide = this._buildVisualGuide(context.observation);
    
    return {
      text: basePrompt + visualGuide,
      hasVisual: true
    };
  }

  /**
   * 构建 Chat Prompt（对话模式）
   */
  buildChatPrompt(userMessage) {
    return `${this.getSystemPrompt()}

当前模式: 对话

用户: ${userMessage}

如果需要操作浏览器，请在回复后加上：
@action: 具体操作描述

否则直接回复用户。`;
  }

  // ============================================================
  // 3. 观察数据处理方法（子类可覆盖）
  // ============================================================

  /**
   * 预处理页面观察数据
   * 子类可以覆盖此方法优化元素提取或过滤
   */
  processObservation(observation) {
    // 基础层不过滤，原样返回
    return observation;
  }

  /**
   * 格式化元素列表用于 Prompt
   * 子类可覆盖以自定义元素显示格式
   */
  formatElements(elements) {
    if (!elements || elements.length === 0) {
      return '暂无元素信息';
    }

    const lines = elements.slice(0, this.config.maxElements).map((e, i) => {
      const parts = [`[${i}] ${e.tag}`];
      
      // 文本内容
      if (e.text) parts.push(`"${e.text.substring(0, 30)}"`);
      else if (e.placeholder) parts.push(`placeholder:"${e.placeholder.substring(0, 20)}"`);
      else if (e.ariaLabel) parts.push(`aria:"${e.ariaLabel.substring(0, 20)}"`);
      
      // 标识
      if (e.id) parts.push(`#${e.id}`);
      else if (e.className) parts.push(`.${e.className.split(' ')[0]}`);
      
      // 类型
      if (e.type && e.type !== 'text') parts.push(`type:${e.type}`);
      
      // 位置
      if (e.rect) parts.push(`at:(${Math.round(e.rect.x)},${Math.round(e.rect.y)})`);
      
      // 相邻元素
      if (e.neighbors?.above?.length > 0) {
        parts.push(`↑${e.neighbors.above[0].tag}`);
      }
      if (e.neighbors?.below?.length > 0) {
        parts.push(`↓${e.neighbors.below[0].tag}`);
      }
      
      // 状态
      if (e.disabled) parts.push('[disabled]');
      if (e.cursor === 'pointer') parts.push('[clickable]');
      
      return parts.join(' ');
    });

    return lines.join('\n');
  }

  // ============================================================
  // 4. 辅助方法（通常不需要覆盖）
  // ============================================================

  /**
   * 获取可用操作列表
   */
  getAvailableActions() {
    return Object.keys(this.getActionSchema());
  }

  /**
   * 检查是否支持特定操作
   */
  supportsAction(action) {
    return this.getAvailableActions().includes(action);
  }

  /**
   * 获取 Agent 元信息（用于 UI 显示）
   */
  getMetadata() {
    return {
      id: this.id,
      name: this.name,
      icon: this.icon,
      description: this.description,
      actions: this.getAvailableActions()
    };
  }

  // ============================================================
  // 5. 私有方法（内部使用）
  // ============================================================

  /**
   * 统一参数处理
   */
  _normalizeArguments(contextOrTask, observation, previousResult, stepCount, history) {
    if (typeof contextOrTask === 'object' && contextOrTask !== null && !Array.isArray(contextOrTask)) {
      return {
        task: contextOrTask.task,
        observation: contextOrTask.observation,
        previousResult: contextOrTask.previousResult,
        stepCount: contextOrTask.stepCount || 0,
        history: contextOrTask.history || []
      };
    }
    
    return {
      task: contextOrTask,
      observation: observation,
      previousResult: previousResult,
      stepCount: stepCount || 0,
      history: history || []
    };
  }

  /**
   * 构建操作帮助文本
   */
  _buildActionHelp() {
    const schema = this.getActionSchema();
    const lines = Object.entries(schema).map(([name, config]) => {
      return `- ${name}: ${config.desc}`;
    });
    return `【可用操作】\n${lines.join('\n')}`;
  }

  /**
   * 构建任务上下文（动态部分）
   */
  _buildTaskContext(context) {
    const { task, observation, previousResult, stepCount, history } = context;
    let parts = [];

    // 任务目标
    if (task) {
      parts.push(`【任务目标】\n${task}`);
    }

    // 执行进度
    parts.push(this._buildProgressSection(stepCount, history));

    // 上一步结果
    if (previousResult) {
      parts.push(this._buildResultSection(previousResult));
    }

    // 页面状态
    if (observation) {
      parts.push(this._buildObservationSection(observation));
    }

    parts.push('请分析并输出下一步操作：');
    return parts.join('\n\n');
  }

  /**
   * 构建执行进度部分
   */
  _buildProgressSection(stepCount, history) {
    let section = `【执行进度】\n已完成 ${stepCount} 步`;
    
    if (history && history.length > 0) {
      const recentHistory = history.slice(-this.config.maxHistorySteps);
      const lines = recentHistory.map((h, i) => {
        const globalIndex = history.length - recentHistory.length + i + 1;
        const decision = h.decision || h;
        const action = decision.action || 'unknown';
        
        // 状态图标
        let status;
        if (h.confirmStatus === 'yes') status = '✓';
        else if (h.confirmStatus === 'no') status = '✗';
        else if (h.confirmStatus === null || h.confirmStatus === undefined) status = '⏳';
        else status = '○';
        
        // 详细描述
        let detail = '';
        if (decision.description) {
          detail = ` - ${decision.description}`;
        }
        if (action === 'type' && decision.text) {
          detail += ` ("${decision.text.substring(0, 20)}${decision.text.length > 20 ? '...' : ''}")`;
        }
        if (action === 'click' && decision.target) {
          if (typeof decision.target === 'object' && decision.target.x !== undefined) {
            detail += ` (${decision.target.x.toFixed(2)}, ${decision.target.y.toFixed(2)})`;
          }
        }
        if (action === 'navigate' && decision.url) {
          detail += ` (${decision.url})`;
        }
        
        return `${globalIndex}. ${action}${detail} ${status}`;
      });
      
      section += '\n已执行操作:\n' + lines.join('\n');
    }
    
    return section;
  }

  /**
   * 构建上一步结果部分
   */
  _buildResultSection(previousResult) {
    let section = '【上一步结果】';
    if (previousResult.success) {
      section += '\n执行成功 ✓';
    } else {
      section += '\n执行失败 ✗';
      if (previousResult.error) {
        section += `\n错误: ${previousResult.error}`;
      }
    }
    return section;
  }

  /**
   * 构建页面观察部分
   */
  _buildObservationSection(observation) {
    let parts = [];
    parts.push('【当前页面状态】');
    parts.push(`URL: ${observation.url || 'N/A'}`);
    parts.push(`标题: ${observation.title || 'N/A'}`);
    
    if (observation.loginStatus?.needsLogin) {
      parts.push('⚠️ 注意: 页面需要登录/扫码/验证码');
    }
    
    if (observation.elements?.length === 0) {
      parts.push('注意: 页面可能没有完全加载或没有可交互元素');
    }

    // 元素列表
    parts.push('');
    parts.push('【页面元素】（部分）');
    parts.push(this.formatElements(observation.elements));

    return parts.join('\n');
  }

  /**
   * 构建视觉辅助指南
   */
  _buildVisualGuide(observation) {
    const { screenshot, viewport } = observation;
    const width = screenshot?.width || viewport?.width || 0;
    const height = screenshot?.height || viewport?.height || 0;

    return `

【截图信息】
尺寸: ${width}x${height}

【坐标系统 - 重要】
- 所有坐标使用 0-1 的相对坐标（百分比）
- 左上角为 (0, 0)，右下角为 (1, 1)
- 示例：屏幕中央 = {"x": 0.5, "y": 0.5}
- 示例：右上角按钮 = {"x": 0.9, "y": 0.1}

【视觉辅助】
- 结合截图判断元素位置
- 如元素位置明确，可使用坐标点击: {"target": {"type": "coordinate", "x": 0.5, "y": 0.3}}
- 坐标精度：0.1 精度即可（如 0.5, 0.55），不需要精确到 0.01

【智能等待策略】
- 导航后：使用 wait 500-2000ms 等待页面加载
- 点击后：使用 wait 300-500ms 等待页面响应
- 输入后：使用 wait 200ms 等待输入完成
- 滚动后：使用 wait 500ms 等待内容加载
- 不确定时：使用 screenshot 查看当前状态后再继续

请结合截图分析页面状态，输出下一步操作：`;
  }
}

module.exports = { BaseAgent };
