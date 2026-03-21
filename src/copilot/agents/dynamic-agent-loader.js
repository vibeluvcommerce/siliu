/**
 * DynamicAgentLoader - 动态加载 YAML/JSON 配置的 Agent
 * 
 * 功能：
 * 1. 从 workspace/agents/ 目录加载配置文件
 * 2. 自动扫描 .yaml/.yml/.json 文件
 * 3. 文件变化时热重载（无需重启应用）
 * 4. 提供保存/删除 Agent 配置的接口
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const chokidar = require('chokidar');
const { ConfigurableAgent } = require('./configurable-agent');
const { registry } = require('./agent-registry');

class DynamicAgentLoader {
  constructor(workspaceManager) {
    this.workspaceManager = workspaceManager;
    this.agentsDir = null;
    this.watcher = null;
    this.loadedAgents = new Map(); // filePath -> agentId
  }

  /**
   * 初始化加载器
   */
  async initialize() {
    // 确定 Agent 配置目录
    this.agentsDir = path.join(this.workspaceManager.workspaceBase, 'agents');
    
    // 确保目录存在
    await this._ensureDirectory();
    
    console.log('[DynamicAgentLoader] Agents directory:', this.agentsDir);
    
    // 加载所有已有配置
    await this._loadAllAgents();
    
    // 设置文件监听（热重载）
    this._setupWatcher();
    
    console.log('[DynamicAgentLoader] Initialized, watching for changes...');
  }

  /**
   * 确保目录存在
   */
  async _ensureDirectory() {
    try {
      await fs.access(this.agentsDir);
    } catch {
      await fs.mkdir(this.agentsDir, { recursive: true });
      console.log('[DynamicAgentLoader] Created agents directory:', this.agentsDir);
    }
  }

  /**
   * 加载所有 Agent 配置文件
   */
  async _loadAllAgents() {
    try {
      const files = await fs.readdir(this.agentsDir);
      const configFiles = files.filter(f => 
        f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json')
      );
      
      console.log(`[DynamicAgentLoader] Found ${configFiles.length} config files`);
      
      for (const file of configFiles) {
        await this._loadAgent(file);
      }
    } catch (err) {
      console.error('[DynamicAgentLoader] Failed to load agents:', err);
    }
  }

  /**
   * 加载单个 Agent 配置文件
   */
  async _loadAgent(filename) {
    const filePath = path.join(this.agentsDir, filename);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      
      // 解析配置
      let config;
      if (filename.endsWith('.json')) {
        config = JSON.parse(content);
      } else {
        config = yaml.load(content);
      }
      
      // 验证配置
      const validation = ConfigurableAgent.validateConfig(config);
      if (!validation.valid) {
        console.error(`[DynamicAgentLoader] Invalid config in ${filename}:`, validation.errors);
        return;
      }
      
      // 记录源文件
      config._sourceFile = filename;
      
      // 检查是否为内置 Agent（bilibili、taobao 等）
      const existingAgent = registry.get(config.metadata.id);
      const isBuiltIn = existingAgent && !existingAgent.config?._sourceFile;
      
      if (isBuiltIn) {
        console.log(`[DynamicAgentLoader] YAML config overrides built-in agent: ${config.metadata.id}`);
      }
      
      // 创建 Agent 实例
      const agent = new ConfigurableAgent(config);
      
      // 如果之前有同名 Agent，先注销
      if (registry.has(agent.id)) {
        registry.unregister(agent.id);
      }
      
      // 注册到注册表
      registry.register(agent);
      
      // 记录已加载
      this.loadedAgents.set(filePath, agent.id);
      
      console.log(`[DynamicAgentLoader] Loaded agent: ${agent.id} from ${filename}`);
      
    } catch (err) {
      console.error(`[DynamicAgentLoader] Failed to load ${filename}:`, err.message);
    }
  }

  /**
   * 卸载（注销）一个 Agent
   */
  _unloadAgent(filename) {
    const filePath = path.join(this.agentsDir, filename);
    const agentId = this.loadedAgents.get(filePath);
    
    if (agentId) {
      registry.unregister(agentId);
      this.loadedAgents.delete(filePath);
      console.log(`[DynamicAgentLoader] Unloaded agent: ${agentId}`);
    }
  }

  /**
   * 重新加载 Agent
   */
  async _reloadAgent(filename) {
    console.log(`[DynamicAgentLoader] Reloading ${filename}...`);
    this._unloadAgent(filename);
    await this._loadAgent(filename);
  }

  /**
   * 设置文件监听（热重载）
   */
  _setupWatcher() {
    console.log('[DynamicAgentLoader] Setting up watcher for:', this.agentsDir);
    
    this.watcher = chokidar.watch(this.agentsDir, {
      ignored: /(^|[\/\\])\../, // 忽略隐藏文件
      persistent: true,
      depth: 1,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    });

    this.watcher
      .on('add', (filePath) => {
        const filename = path.basename(filePath);
        console.log(`[DynamicAgentLoader] Watcher: add event - ${filename}`);
        if (this._isConfigFile(filename)) {
          console.log(`[DynamicAgentLoader] File added: ${filename}`);
          this._loadAgent(filename);
        } else {
          console.log(`[DynamicAgentLoader] Ignored non-config file: ${filename}`);
        }
      })
      .on('change', (filePath) => {
        const filename = path.basename(filePath);
        console.log(`[DynamicAgentLoader] Watcher: change event - ${filename}`);
        if (this._isConfigFile(filename)) {
          console.log(`[DynamicAgentLoader] File changed: ${filename}`);
          this._reloadAgent(filename);
        }
      })
      .on('unlink', (filePath) => {
        const filename = path.basename(filePath);
        console.log(`[DynamicAgentLoader] Watcher: unlink event - ${filename}`);
        if (this._isConfigFile(filename)) {
          console.log(`[DynamicAgentLoader] File removed: ${filename}`);
          this._unloadAgent(filename);
        }
      })
      .on('error', err => {
        console.error('[DynamicAgentLoader] Watcher error:', err);
      })
      .on('ready', () => {
        console.log('[DynamicAgentLoader] Watcher ready, watching:', this.agentsDir);
      });
  }

  /**
   * 检查是否是配置文件
   */
  _isConfigFile(filename) {
    return filename.endsWith('.yaml') || 
           filename.endsWith('.yml') || 
           filename.endsWith('.json');
  }

  /**
   * 保存 Agent 配置
   * @param {Object} config - Agent 配置对象
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async saveAgent(config) {
    try {
      // 验证配置
      const validation = ConfigurableAgent.validateConfig(config);
      if (!validation.valid) {
        return { success: false, error: validation.errors.join('; ') };
      }

      const filename = `${config.metadata.id}.yaml`;
      const filePath = path.join(this.agentsDir, filename);

      // 清理内部字段，保留所有必要数据
      const cleanConfig = {
        metadata: {
          ...config.metadata,
          updatedAt: new Date().toISOString()
        }
      };
      
      // 添加 sites 配置（新格式，支持多站点多页面）
      if (config.sites) {
        cleanConfig.sites = config.sites;
      }
      
      // 兼容旧格式
      if (config.domains) cleanConfig.domains = config.domains;
      if (config.coordinates) cleanConfig.coordinates = config.coordinates;
      if (config.knowledge) cleanConfig.knowledge = config.knowledge;
      if (config.behavior) cleanConfig.behavior = config.behavior;

      // 转换为 YAML
      const yamlContent = yaml.dump(cleanConfig, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        sortKeys: false
      });

      // 写入文件
      await fs.writeFile(filePath, yamlContent, 'utf-8');

      console.log(`[DynamicAgentLoader] Saved agent: ${config.metadata.id}`);
      return { success: true };
    } catch (err) {
      console.error('[DynamicAgentLoader] Failed to save agent:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * 删除 Agent 配置
   * @param {string} agentId - Agent ID
   */
  async deleteAgent(agentId) {
    try {
      const filename = `${agentId}.yaml`;
      const filePath = path.join(this.agentsDir, filename);

      // 检查文件是否存在
      await fs.access(filePath);
      
      // 删除文件
      await fs.unlink(filePath);
      
      // 注销 Agent（watcher 会自动处理，但这里立即处理）
      this._unloadAgent(filename);

      console.log(`[DynamicAgentLoader] Deleted agent: ${agentId}`);
      return { success: true };
    } catch (err) {
      if (err.code === 'ENOENT') {
        return { success: false, error: 'Agent configuration file not found' };
      }
      return { success: false, error: err.message };
    }
  }

  /**
   * 获取所有用户自定义 Agent 列表
   */
  getUserAgents() {
    return Array.from(this.loadedAgents.values()).map(id => {
      const agent = registry.get(id);
      return agent ? agent.getDisplayInfo() : null;
    }).filter(Boolean);
  }

  /**
   * 获取 Agent 配置内容（用于编辑器）
   */
  async getAgentConfig(agentId) {
    const filename = `${agentId}.yaml`;
    const filePath = path.join(this.agentsDir, filename);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return { success: true, content };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * 停止监听
   */
  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}

module.exports = { DynamicAgentLoader };
