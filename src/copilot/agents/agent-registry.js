/**
 * AgentRegistry - Agent 注册表
 * 
 * 功能：
 * 1. 自动加载 builtin 目录下的内置 Agent
 * 2. 支持从 custom 目录动态加载用户自定义 Agent
 * 3. 管理 Agent 切换和生命周期
 */

const fs = require('fs');
const path = require('path');

// 内置 Agent（确保至少有一个可用）
const { GeneralAgent } = require('./builtin/general-agent');
const { DataAgent } = require('./builtin/data-agent');

class AgentRegistry {
  constructor() {
    this.agents = new Map();
    this.currentAgent = null;
    
    // 加载所有 Agent
    this._loadAllAgents();
  }

  /**
   * 加载所有 Agent（builtin + custom）
   */
  _loadAllAgents() {
    // 1. 首先注册内置 Agent（确保基础功能可用）
    this._registerBuiltInAgents();
    
    // 2. 尝试加载 custom 目录下的用户自定义 Agent
    this._loadCustomAgents();
  }

  /**
   * 注册内置 Agent
   */
  _registerBuiltInAgents() {
    // 通用助手（默认）
    this.register(new GeneralAgent());
    
    // 数据采集
    this.register(new DataAgent());
    
    // 注意：B站助手和淘宝助手现在通过 YAML 配置加载
    // 位于 ~/.siliu/workspace/agents/bilibili.yaml 和 taobao.yaml
    
    console.log('[AgentRegistry] Built-in agents registered');
  }

  /**
   * 从 custom 目录加载用户自定义 Agent
   */
  _loadCustomAgents() {
    const customDir = path.join(__dirname, 'custom');
    
    // 确保目录存在
    if (!fs.existsSync(customDir)) {
      console.log('[AgentRegistry] Custom directory not found, skipping');
      return;
    }

    // 读取 custom 目录下的所有 .js 文件
    const files = fs.readdirSync(customDir).filter(f => f.endsWith('.js'));
    
    for (const file of files) {
      try {
        const filePath = path.join(customDir, file);
        const agentModule = require(filePath);
        
        // 查找 Agent 类（假设导出的类名以 Agent 结尾）
        const AgentClass = Object.values(agentModule).find(
          exp => typeof exp === 'function' && exp.name && exp.name.endsWith('Agent')
        );
        
        if (AgentClass) {
          const agent = new AgentClass();
          this.register(agent);
          console.log(`[AgentRegistry] Custom agent loaded: ${agent.id} from ${file}`);
        } else {
          console.warn(`[AgentRegistry] No Agent class found in ${file}`);
        }
      } catch (err) {
        console.error(`[AgentRegistry] Failed to load custom agent from ${file}:`, err.message);
      }
    }
  }

  /**
   * 注册 Agent
   * @param {BaseAgent} agent - Agent 实例
   */
  register(agent) {
    if (!agent || !agent.id) {
      throw new Error('Agent must have an id');
    }
    
    // 检查是否已存在
    if (this.agents.has(agent.id)) {
      console.warn(`[AgentRegistry] Agent ${agent.id} already exists, overwriting`);
    }
    
    this.agents.set(agent.id, agent);
    console.log(`[AgentRegistry] Registered: ${agent.id} (${agent.name})`);
  }

  /**
   * 注销 Agent
   * @param {string} id - Agent ID
   */
  unregister(id) {
    if (this.agents.has(id)) {
      // 如果当前正在使用，先切换到默认
      if (this.currentAgent?.id === id) {
        this.switchTo(this.getDefault().id);
      }
      this.agents.delete(id);
      console.log(`[AgentRegistry] Unregistered: ${id}`);
      return true;
    }
    return false;
  }

  /**
   * 获取 Agent
   * @param {string} id - Agent ID
   * @returns {BaseAgent|null}
   */
  get(id) {
    return this.agents.get(id) || null;
  }

  /**
   * 获取默认 Agent（general 或第一个）
   */
  getDefault() {
    return this.agents.get('general') || this.agents.values().next().value;
  }

  /**
   * 获取当前 Agent
   */
  getCurrent() {
    return this.currentAgent || this.getDefault();
  }

  /**
   * 切换当前 Agent
   * @param {string} id - Agent ID
   * @returns {boolean} 是否切换成功
   */
  switchTo(id) {
    const agent = this.agents.get(id);
    if (!agent) {
      console.warn(`[AgentRegistry] Agent not found: ${id}`);
      return false;
    }

    this.currentAgent = agent;
    console.log(`[AgentRegistry] Switched to: ${agent.id} (${agent.name})`);
    return true;
  }

  /**
   * 根据 URL 自动选择合适的 Agent
   * @param {string} url - 页面 URL
   * @returns {string} 选中的 Agent ID
   */
  autoSelectByUrl(url) {
    if (!url) return this.getDefault().id;
    
    // 1. 首先检查所有 ConfigurableAgent 的 domains 配置
    for (const [id, agent] of this.agents) {
      if (agent.matchesUrl && agent.matchesUrl(url)) {
        console.log(`[AgentRegistry] Auto-selected configurable agent ${id} for URL: ${url}`);
        return id;
      }
    }
    
    // 2. 内置 URL 匹配规则（按优先级）
    const rules = [
      { pattern: /bilibili\.com/, id: 'bilibili' },
      { pattern: /taobao\.com|tmall\.com/, id: 'taobao' },
    ];
    
    for (const rule of rules) {
      if (rule.pattern.test(url)) {
        if (this.has(rule.id)) {
          console.log(`[AgentRegistry] Auto-selected built-in agent ${rule.id} for URL: ${url}`);
          return rule.id;
        }
      }
    }
    
    return this.getDefault().id;
  }

  /**
   * 自动切换（根据 URL）
   * @param {string} url - 页面 URL
   */
  autoSwitch(url) {
    const agentId = this.autoSelectByUrl(url);
    return this.switchTo(agentId);
  }

  /**
   * 获取所有可用的 Agent 列表（用于 UI 渲染）
   * @returns {Array} Agent 展示信息列表
   */
  getAllAgents() {
    return Array.from(this.agents.values()).map(agent => agent.getDisplayInfo());
  }

  /**
   * 获取所有 Agent 的元数据（用于 UI 显示）
   */
  getAllMetadata() {
    return Array.from(this.agents.values()).map(agent => agent.getMetadata());
  }

  /**
   * 检查 Agent 是否存在
   */
  has(id) {
    return this.agents.has(id);
  }

  /**
   * 获取 Agent 数量
   */
  get count() {
    return this.agents.size;
  }

  /**
   * 重新加载自定义 Agent（用于热更新）
   */
  reloadCustomAgents() {
    console.log('[AgentRegistry] Reloading custom agents...');
    
    // 保存当前 Agent ID
    const currentId = this.currentAgent?.id;
    
    // 清除所有自定义 Agent（保留 builtin）
    const builtInIds = ['general', 'data']; // 内置 Agent ID 列表（bilibili、taobao 由 YAML 提供）
    for (const [id, agent] of this.agents) {
      if (!builtInIds.includes(id)) {
        this.agents.delete(id);
      }
    }
    
    // 重新加载
    this._loadCustomAgents();
    
    // 恢复之前的选中状态（如果还存在）
    if (currentId && this.has(currentId)) {
      this.switchTo(currentId);
    }
  }

  /**
   * 获取 ConfigurableAgent 列表（YAML 配置的 Agent）
   */
  getConfigurableAgents() {
    return Array.from(this.agents.values())
      .filter(agent => agent.config?._sourceFile)
      .map(agent => agent.getDisplayInfo());
  }

  /**
   * 判断是否为内置 Agent
   */
  isBuiltInAgent(id) {
    const builtInIds = ['general', 'data'];
    return builtInIds.includes(id);
  }

  // ============================================================
  // 代理方法（转发到当前 Agent）
  // ============================================================

  /**
   * 使用当前 Agent 构建 Prompt
   */
  buildPrompt(mode, context) {
    const agent = this.getCurrent();
    
    if (mode === 'chat') {
      return agent.buildChatPrompt(context.userMessage);
    } else if (mode === 'action') {
      return agent.buildActionPrompt(context);
    } else if (mode === 'visual') {
      return agent.buildVisualActionPrompt(context);
    }
    
    throw new Error(`Unknown mode: ${mode}`);
  }

  /**
   * 使用当前 Agent 处理页面观察
   */
  processObservation(observation) {
    const agent = this.getCurrent();
    return agent.processObservation(observation);
  }
}

// 导出单例
const registry = new AgentRegistry();

module.exports = { AgentRegistry, registry };
