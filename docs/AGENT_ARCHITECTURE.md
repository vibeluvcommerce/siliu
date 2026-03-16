# Siliu Browser 配置化 Agent 架构设计文档

> 详细描述配置化 Agent 的技术架构、实现方案和集成策略

---

## 一、问题定义

### 1.1 当前架构的问题

**现有 Custom Agent 加载方式：**
```javascript
// src/copilot/agents/agent-registry.js
_loadCustomAgents() {
  const customDir = path.join(__dirname, 'custom');
  const files = fs.readdirSync(customDir).filter(f => f.endsWith('.js'));
  
  for (const file of files) {
    const agentModule = require(filePath);  // ← 需要 JS 代码
    const AgentClass = Object.values(agentModule).find(
      exp => typeof exp === 'function' && exp.name.endsWith('Agent')
    );
    const agent = new AgentClass();  // ← 需要实例化类
    this.register(agent);
  }
}
```

**问题：**
- 用户必须编写 JS 代码
- 需要继承 BaseAgent 类
- 需要理解类继承、模块导出等概念
- **普通用户无法使用**

### 1.2 目标用户能力分层

| 用户类型 | 技术能力 | 使用方式 |
|----------|----------|----------|
| **普通用户** | 零代码 | 可视化编辑器 |
| **进阶用户** | 基础配置 | 直接编辑 YAML |
| **开发者** | 编程能力 | 继承 BaseAgent 编写 JS |

---

## 二、架构设计

### 2.1 新架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                      Agent System                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    AgentRegistry                          │  │
│  │  • 统一注册表（builtin + custom + yaml）                   │  │
│  │  • Agent 生命周期管理                                      │  │
│  │  • 自动切换逻辑                                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                   │
│           ┌──────────────────┼──────────────────┐               │
│           │                  │                  │               │
│           ▼                  ▼                  ▼               │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐   │
│  │  BuiltinAgent   │ │  CustomAgent    │ │ ConfigurableAgent│   │
│  │  (JS 代码)       │ │  (JS 代码)       │ │  (YAML 配置)     │   │
│  │                  │ │                  │ │                  │   │
│  │  官方维护        │ │  用户编写        │ │  用户配置生成     │   │
│  │  功能强大        │ │  需编译知识      │ │  零代码          │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                DynamicAgentLoader                         │  │
│  │  • 从 ~/.siliu/workspace/agents/ 加载 YAML               │  │
│  │  • 文件监听热重载                                          │  │
│  │  • 配置验证                                                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 目录结构变化

**新增文件：**
```
src/copilot/agents/
├── index.js                    # 模块入口（不变）
├── base-agent.js               # Agent 基类（不变）
├── agent-registry.js           # 增强：加载 YAML Agent
├── configurable-agent.js       # 新增：配置化 Agent 类
├── dynamic-agent-loader.js     # 新增：YAML 加载器
├── builtin/                    # 内置 Agent（不变）
└── custom/                     # 自定义 JS Agent（不变）

~/.siliu/workspace/              # 工作区
├── agents/                      # 新增：YAML Agent 配置目录
│   ├── my-bilibili.yaml
│   ├── my-taobao.yaml
│   └── ...
├── screenshots/
├── exports/
└── ...
```

---

## 三、核心类设计

### 3.1 ConfigurableAgent 类

**文件：** `src/copilot/agents/configurable-agent.js`

```javascript
/**
 * ConfigurableAgent - 从 YAML/JSON 配置动态创建的 Agent
 * 
 * 无需编写代码，通过配置文件即可创建功能完整的 Agent
 */

const { BaseAgent } = require('./base-agent');

class ConfigurableAgent extends BaseAgent {
  /**
   * @param {Object} config - YAML/JSON 配置对象
   */
  constructor(config) {
    super({
      id: config.metadata.id,
      name: config.metadata.name,
      icon: config.metadata.icon || 'robot',
      color: config.metadata.color || '#1A73E8',
      colorEnd: config.metadata.colorEnd,
      description: config.metadata.description
    });
    
    this.config = config;
  }

  /**
   * 获取预置坐标配置（供 CoordinateSystem 使用）
   * @returns {Object} 坐标配置对象
   */
  getPresetCoordinates() {
    return this.config.coordinates || {};
  }

  /**
   * 获取领域知识（Prompt 片段）
   * 组装 BaseAgent 的 getDomainKnowledge() 所需内容
   */
  getDomainKnowledge() {
    const parts = [];
    
    // 1. 坐标策略说明
    const coords = this.getPresetCoordinates();
    if (Object.keys(coords).length > 0) {
      parts.push('【预置坐标配置】');
      for (const [name, info] of Object.entries(coords)) {
        parts.push(`- ${name}: (${info.x}, ${info.y}) - ${info.description}`);
      }
    }
    
    // 2. 知识库内容
    const knowledge = this.config.knowledge || {};
    if (knowledge.pageStructure) {
      parts.push('\n【页面结构】\n' + knowledge.pageStructure);
    }
    if (knowledge.workflows) {
      parts.push('\n【常见操作流程】');
      for (const workflow of knowledge.workflows) {
        parts.push(`- ${workflow.name}: ${workflow.steps.join(' → ')}`);
      }
    }
    if (knowledge.antiDetection) {
      parts.push('\n【注意事项】\n' + knowledge.antiDetection);
    }
    
    return parts.join('\n\n');
  }

  /**
   * 获取元素定位指南
   * 覆盖 BaseAgent 的方法，提供坐标优先的策略
   */
  getElementGuides() {
    const coords = this.getPresetCoordinates();
    const guides = [];
    
    for (const [name, info] of Object.entries(coords)) {
      guides.push(
        `- ${name}: 优先使用坐标 (${info.x}, ${info.y})，${info.description}`
      );
    }
    
    // 备选选择器
    const selectors = this.config.selectors || {};
    for (const [name, selector] of Object.entries(selectors)) {
      guides.push(
        `- ${name}: 备选选择器 "${selector}"（坐标失效时使用）`
      );
    }
    
    return guides.join('\n');
  }

  /**
   * 验证当前页面是否匹配此 Agent
   * @param {string} url - 当前页面 URL
   * @returns {Object} {valid, reason}
   */
  validatePage(url) {
    const validation = this.config.validation || {};
    
    // URL 匹配检查
    if (validation.urlPattern) {
      const regex = new RegExp(validation.urlPattern);
      if (!regex.test(url)) {
        return { valid: false, reason: 'URL 不匹配' };
      }
    }
    
    return { valid: true };
  }
}

module.exports = { ConfigurableAgent };
```

### 3.2 DynamicAgentLoader 类

**文件：** `src/copilot/agents/dynamic-agent-loader.js`

```javascript
/**
 * DynamicAgentLoader - 动态加载用户自定义 YAML Agent
 * 
 * 功能：
 * 1. 从 ~/.siliu/workspace/agents/ 加载 YAML/JSON 配置
 * 2. 文件监听热重载（无需重启应用）
 * 3. 配置验证
 * 4. 保存 Agent 配置（供编辑器调用）
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const chokidar = require('chokidar');
const { ConfigurableAgent } = require('./configurable-agent');

class DynamicAgentLoader {
  constructor(workspaceManager) {
    this.workspaceManager = workspaceManager;
    this.agentsDir = null;
    this.watcher = null;
  }

  /**
   * 初始化加载器
   */
  async initialize() {
    // Agent 配置目录: ~/.siliu/workspace/agents/
    this.agentsDir = path.join(
      this.workspaceManager.workspaceBase, 
      'agents'
    );
    
    await this._ensureDirectory();
    await this._loadAllAgents();
    this._setupWatcher();
  }

  /**
   * 确保目录存在
   */
  async _ensureDirectory() {
    try {
      await fs.mkdir(this.agentsDir, { recursive: true });
    } catch (err) {
      console.error('[DynamicAgentLoader] Failed to create directory:', err);
    }
  }

  /**
   * 加载所有 YAML Agent
   */
  async _loadAllAgents() {
    try {
      const files = await fs.readdir(this.agentsDir);
      const configFiles = files.filter(f => 
        f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json')
      );

      for (const file of configFiles) {
        await this._loadAgent(file);
      }
    } catch (err) {
      // 目录为空或不存在，忽略
    }
  }

  /**
   * 加载单个 Agent 配置
   */
  async _loadAgent(filename) {
    const filePath = path.join(this.agentsDir, filename);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const config = filename.endsWith('.json') 
        ? JSON.parse(content)
        : yaml.load(content);

      // 验证配置
      if (!this._validateConfig(config)) {
        console.warn(`[DynamicAgentLoader] Invalid config: ${filename}`);
        return;
      }

      // 创建 ConfigurableAgent
      const agent = new ConfigurableAgent(config);
      
      // 注册到 AgentRegistry
      const { registry } = require('./agent-registry');
      registry.register(agent);
      
      console.log(`[DynamicAgentLoader] Loaded: ${config.metadata.id}`);
      
    } catch (err) {
      console.error(`[DynamicAgentLoader] Failed to load ${filename}:`, err.message);
    }
  }

  /**
   * 验证配置格式
   */
  _validateConfig(config) {
    const required = ['metadata', 'coordinates'];
    return required.every(field => config && config[field]);
  }

  /**
   * 文件监听器（热重载）
   */
  _setupWatcher() {
    this.watcher = chokidar.watch(
      path.join(this.agentsDir, '*.{yaml,yml,json}'),
      { ignoreInitial: true }
    );

    this.watcher
      .on('add', file => this._loadAgent(path.basename(file)))
      .on('change', file => this._reloadAgent(path.basename(file)))
      .on('unlink', file => this._unloadAgent(file));
  }

  /**
   * 重新加载
   */
  async _reloadAgent(filename) {
    const filePath = path.join(this.agentsDir, filename);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const config = yaml.load(content);
      
      const { registry } = require('./agent-registry');
      registry.unregister(config.metadata.id);
      await this._loadAgent(filename);
    } catch (err) {
      console.error(`[DynamicAgentLoader] Failed to reload ${filename}:`, err);
    }
  }

  /**
   * 卸载
   */
  _unloadAgent(filePath) {
    const id = path.basename(filePath, path.extname(filePath));
    const { registry } = require('./agent-registry');
    registry.unregister(id);
    console.log(`[DynamicAgentLoader] Unloaded: ${id}`);
  }

  /**
   * 保存 Agent 配置（供可视化编辑器调用）
   */
  async saveAgent(config) {
    const filename = `${config.metadata.id}.yaml`;
    const filePath = path.join(this.agentsDir, filename);
    const yamlContent = yaml.dump(config, { indent: 2 });
    
    await fs.writeFile(filePath, yamlContent, 'utf-8');
    console.log(`[DynamicAgentLoader] Saved: ${filename}`);
    return { success: true, path: filePath };
  }
}

module.exports = { DynamicAgentLoader };
```

---

## 四、YAML 配置格式规范

### 4.1 完整配置示例

**文件：** `~/.siliu/workspace/agents/my-bilibili.yaml`

```yaml
# Siliu Agent 配置文件
# 保存后自动生效，无需重启应用

apiVersion: siliu.io/v1
kind: Agent
metadata:
  id: my-bilibili                    # 唯一标识（小写+连字符）
  name: 我的B站助手                   # 显示名称
  icon: television                   # Phosphor 图标名
  color: "#FB7299"                   # 主色调
  colorEnd: "#FC8BAB"                # 渐变色（可选）
  description: 针对B站的自定义自动化操作
  author: user123
  version: "1.0.0"
  createdAt: "2026-03-16T10:00:00Z"

# 预置坐标配置（核心）
coordinates:
  searchBox:
    x: 0.52                           # 相对 X 坐标 (0-1)
    y: 0.06                           # 相对 Y 坐标 (0-1)
    description: 顶部搜索输入框
    action: click-and-type            # click / type / hover / click-and-type
    validation:                       # 可选：验证规则
      type: input
      placeholder: search
  
  searchButton:
    x: 0.61
    y: 0.06
    description: 搜索按钮
    action: click
  
  userAvatar:
    x: 0.92
    y: 0.06
    description: 右上角头像菜单
    action: hover
  
  uploadButton:
    x: 0.82
    y: 0.06
    description: 投稿/上传按钮
    action: click

# 领域知识（Prompt 片段）
knowledge:
  pageStructure: |
    【B站页面布局】
    - 顶部导航栏固定高度 64px
    - 搜索框在中央，右侧有搜索按钮
    - 个人头像在右上角，hover 显示下拉菜单
    - 视频列表使用 grid 布局
  
  workflows:
    - name: 搜索视频
      steps:
        - 点击搜索框坐标
        - 输入关键词
        - 点击搜索按钮
        - 等待结果加载
    
    - name: 进入个人中心
      steps:
        - hover 头像坐标
        - 等待下拉菜单出现
        - 点击个人中心
  
  antiDetection: |
    【注意事项】
    - 操作间隔建议 > 2秒
    - 频繁操作会触发验证码
    - 登录状态影响功能可用性

# 验证规则
validation:
  urlPattern: "bilibili\\.com"         # URL 匹配正则
  requiredElements:                   # 必需元素
    - selector: "#nav_searchform"
      description: 顶部搜索栏

# 备选选择器（坐标失效时使用）
selectors:
  videoCards: ".video-card"
  searchInput: "#nav_searchform input"
  searchBtn: ".search-button"
```

### 4.2 配置字段说明

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| **metadata.id** | string | ✅ | 唯一标识，小写字母+数字+连字符 |
| **metadata.name** | string | ✅ | 显示名称 |
| **metadata.icon** | string | ❌ | Phosphor 图标名，默认 robot |
| **metadata.color** | string | ❌ | 主色调 HEX，默认 #1A73E8 |
| **coordinates** | object | ✅ | 预置坐标配置 |
| **knowledge** | object | ❌ | 领域知识 |
| **validation** | object | ❌ | 页面验证规则 |
| **selectors** | object | ❌ | 备选选择器 |

### 4.3 坐标字段说明

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| **x** | number | ✅ | 相对 X 坐标 (0-1) |
| **y** | number | ✅ | 相对 Y 坐标 (0-1) |
| **description** | string | ✅ | 功能描述（供 AI 理解）|
| **action** | string | ✅ | 操作类型：click/type/hover/click-and-type |
| **validation** | object | ❌ | 元素验证规则 |

---

## 五、集成方案

### 5.1 修改 AgentRegistry

**文件：** `src/copilot/agents/agent-registry.js`

在 `_loadCustomAgents()` 后添加 YAML 加载：

```javascript
/**
 * 从 workspace/agents 加载 YAML Agent（新增）
 */
async _loadYamlAgents() {
  const { getWorkspaceManager } = require('../core/workspace-manager');
  const workspace = getWorkspaceManager();
  const agentsDir = path.join(workspace.workspaceBase, 'agents');
  
  if (!fs.existsSync(agentsDir)) return;

  const { ConfigurableAgent } = require('./configurable-agent');
  const yaml = require('js-yaml');
  
  const files = fs.readdirSync(agentsDir).filter(f => 
    f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json')
  );
  
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
      const config = yaml.load(content);
      
      if (config?.metadata?.id && config?.coordinates) {
        const agent = new ConfigurableAgent(config);
        this.register(agent);
      }
    } catch (err) {
      console.error(`[AgentRegistry] Failed to load YAML ${file}:`, err.message);
    }
  }
}
```

### 5.2 修改 app.js 初始化

**文件：** `src/app.js`

在 CopilotManager 初始化后添加：

```javascript
// ⑦ 加载 CopilotManager
console.log('[Siliu] Loading CopilotManager...');
modules.copilot = new CopilotManager({...});
await modules.copilot.initialize();
console.log('[Siliu] CopilotManager ready');

// 【新增】加载用户自定义 YAML Agent
console.log('[Siliu] Loading user agents...');
const { DynamicAgentLoader } = require('./copilot/agents/dynamic-agent-loader');
const agentLoader = new DynamicAgentLoader(modules.core.workspaceManager);
await agentLoader.initialize();
console.log('[Siliu] User agents loaded');
```

### 5.3 添加依赖

**package.json：**

```json
{
  "dependencies": {
    "js-yaml": "^4.1.0",
    "chokidar": "^3.6.0"
  }
}
```

安装：
```bash
npm install js-yaml chokidar
```

---

## 六、坐标计算规范

### 6.1 相对坐标 vs 绝对坐标

```javascript
/**
 * 绝对像素 → 相对坐标 (0-1)
 * 保存时使用
 */
function toRelative(absoluteX, absoluteY, viewportWidth, viewportHeight) {
  return {
    x: parseFloat((absoluteX / viewportWidth).toFixed(4)),
    y: parseFloat((absoluteY / viewportHeight).toFixed(4))
  };
}

/**
 * 相对坐标 → 绝对像素
 * 执行时使用
 */
function toAbsolute(relativeX, relativeY, viewportWidth, viewportHeight) {
  return {
    x: Math.round(relativeX * viewportWidth),
    y: Math.round(relativeY * viewportHeight)
  };
}
```

### 6.2 坐标验证

```javascript
/**
 * 验证坐标配置有效性
 */
function validateCoordinate(coord) {
  const errors = [];
  
  if (coord.x < 0 || coord.x > 1) {
    errors.push(`x 坐标 ${coord.x} 超出范围 (0-1)`);
  }
  if (coord.y < 0 || coord.y > 1) {
    errors.push(`y 坐标 ${coord.y} 超出范围 (0-1)`);
  }
  if (!coord.description) {
    errors.push('缺少 description 描述');
  }
  if (!['click', 'type', 'hover', 'click-and-type'].includes(coord.action)) {
    errors.push(`无效的 action 类型: ${coord.action}`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
```

---

## 七、实施计划

### Phase 1: 基础配置化（Week 1）

| 任务 | 文件 | 工作量 |
|------|------|--------|
| 安装依赖 | package.json | 10 分钟 |
| 创建 ConfigurableAgent | configurable-agent.js | 4 小时 |
| 创建 DynamicAgentLoader | dynamic-agent-loader.js | 6 小时 |
| 集成到 AgentRegistry | agent-registry.js | 2 小时 |
| 集成到 app.js | app.js | 1 小时 |
| 创建示例 YAML | example-agent.yaml | 30 分钟 |

### Phase 2: 测试验证（Week 1 后半周）

- [ ] 单元测试 ConfigurableAgent
- [ ] 集成测试 DynamicAgentLoader
- [ ] 热重载测试
- [ ] 性能测试（大量 Agent 加载）

### Phase 3: 基础编辑器（Week 2）

- [ ] 添加 IPC handlers
- [ ] 创建表单界面（copilot-settings.html）
- [ ] 实现保存/加载功能

### Phase 4: 可视化编辑器（Week 3-4）

- [ ] 创建预览窗口
- [ ] 实现坐标标注
- [ ] 完善编辑器功能

---

*文档基于详细技术讨论整理*
*创建时间：2026-03-16*
