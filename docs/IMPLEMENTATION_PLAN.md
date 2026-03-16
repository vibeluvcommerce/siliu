# Siliu Browser 项目实施计划文档

> 详细实施步骤、开发顺序和里程碑规划

---

## 一、项目里程碑

```
Month 1          Month 2          Month 3          Month 4+
  |                |                |                |
  ├─ Phase 1 ─────┼────────────────┤                |
  │ 基础优化       │                │                |
  │ 配置化Agent    │                │                |
  ├────────────────┼─ Phase 2 ─────┼────────────────┤
  │                │ Agent生态      │                |
  │                │ 可视化编辑器   │                |
  ├────────────────┼────────────────┼─ Phase 3 ─────┤
  │                │                │ 商业化         │
  │                │                │ 正式发布       │
```

---

## 二、Phase 1: 基础架构（Week 1-4）

### Week 1: 配置化 Agent 基础

#### Day 1-2: 环境准备与依赖

**任务清单：**
- [ ] 安装依赖 `js-yaml` 和 `chokidar`
- [ ] 创建目录结构 `src/copilot/agents/`
- [ ] 验证现有 Agent 系统正常工作

**命令：**
```bash
npm install js-yaml@^4.1.0 chokidar@^3.6.0
```

**交付物：**
- package.json 更新
- 依赖安装成功

#### Day 3-4: ConfigurableAgent 类

**文件：** `src/copilot/agents/configurable-agent.js`

**核心功能：**
```javascript
class ConfigurableAgent extends BaseAgent {
  constructor(config) {
    // 从 YAML config 初始化
  }
  
  getPresetCoordinates() {
    // 返回坐标配置
  }
  
  getDomainKnowledge() {
    // 组装 Prompt 知识库
  }
}
```

**验收标准：**
- [ ] 可以从 YAML 配置创建 Agent
- [ ] 可以正确返回坐标配置
- [ ] 可以正确组装 Prompt
- [ ] 通过单元测试

#### Day 5: DynamicAgentLoader 类

**文件：** `src/copilot/agents/dynamic-agent-loader.js`

**核心功能：**
```javascript
class DynamicAgentLoader {
  async initialize() {
    // 创建 agents 目录
    // 加载所有 YAML Agent
    // 设置文件监听
  }
  
  async _loadAgent(filename) {
    // 解析 YAML
    // 验证配置
    // 注册到 AgentRegistry
  }
  
  async saveAgent(config) {
    // 保存 YAML 到文件
  }
}
```

**验收标准：**
- [ ] 可以从 `~/.siliu/workspace/agents/` 加载 YAML
- [ ] 文件修改后热重载
- [ ] 可以保存新 Agent

### Week 2: 集成与测试

#### Day 1-2: 集成到现有架构

**修改文件：**
1. `src/copilot/agents/agent-registry.js`
   - 添加 `_loadYamlAgents()` 方法
   
2. `src/app.js`
   - 在 CopilotManager 初始化后添加 DynamicAgentLoader

3. `src/copilot/agents/index.js`
   - 导出 ConfigurableAgent 和 DynamicAgentLoader

**代码片段：**
```javascript
// agent-registry.js
async _loadYamlAgents() {
  // 加载 YAML Agent 逻辑
}

// app.js
const { DynamicAgentLoader } = require('./copilot/agents/dynamic-agent-loader');
const agentLoader = new DynamicAgentLoader(modules.core.workspaceManager);
await agentLoader.initialize();
```

#### Day 3: 创建示例 Agent

**文件：** `~/.siliu/workspace/agents/example-template.yaml`

**内容：**
- 完整的 YAML 配置示例
- 包含坐标、知识库、验证规则
- 中文注释说明

#### Day 4-5: 测试验证

**测试项：**
- [ ] YAML Agent 加载测试
- [ ] 热重载测试
- [ ] 坐标验证测试
- [ ] Prompt 生成测试
- [ ] 错误处理测试

**测试脚本：**
```bash
npm test -- --grep "DynamicAgent"
```

### Week 3: 基础编辑器

#### Day 1: IPC 接口设计

**文件：** `src/core/ipc-handlers.js`

**新增 Handlers：**
```javascript
// Agent 编辑器相关
ipcMain.handle('agent:save', async (event, config) => {...});
ipcMain.handle('agent:list', async () => {...});
ipcMain.handle('agent:delete', async (event, id) => {...});
ipcMain.handle('agent:test', async (event, id) => {...});
```

#### Day 2-3: 设置界面集成

**文件：** `public/copilot-settings.html`

**新增面板：**
- Agent 管理标签页
- 创建 Agent 表单
- Agent 列表展示
- 删除/编辑按钮

**界面原型：**
```
┌─────────────────────────────────────┐
│  [通用] [AI服务] [Agent管理] [关于]  │
├─────────────────────────────────────┤
│                                     │
│  我的 Agent                         │
│  ┌─────────────────────────────┐   │
│  │ my-bilibili        [编辑][删除] │ │
│  │ my-taobao          [编辑][删除] │ │
│  └─────────────────────────────┘   │
│                                     │
│  [+ 创建新 Agent]                   │
│                                     │
└─────────────────────────────────────┘
```

#### Day 4-5: 表单功能实现

**功能：**
- 网站名称/域名输入
- 坐标 JSON 编辑（带格式验证）
- 知识库文本编辑
- 保存/取消按钮

**代码验证：**
```javascript
function validateConfig(config) {
  // 检查必需字段
  // 检查坐标格式
  // 检查坐标范围 (0-1)
  return { valid, errors };
}
```

### Week 4: 优化与文档

#### Day 1-2: 错误处理优化

**优化点：**
- YAML 解析错误提示
- 配置验证错误提示
- 坐标越界警告
- 文件权限错误处理

#### Day 3-4: 性能优化

**优化点：**
- Agent 加载性能（延迟加载）
- 大 YAML 文件处理
- 内存优化（缓存策略）

#### Day 5: 文档完善

**文档：**
- 更新 AGENT_DEVELOPMENT.md
- 添加 YAML 配置说明
- 创建示例配置集

---

## 三、Phase 2: Agent 生态（Week 5-8）

### Week 5-6: 可视化编辑器

#### 任务分解：

| 任务 | 工作量 | 负责人 |
|------|--------|--------|
| 创建编辑器窗口 | 1 天 | - |
| 网站预览功能 | 2 天 | - |
| 坐标标注器 | 3 天 | - |
| 坐标列表管理 | 2 天 | - |
| 保存/加载功能 | 2 天 | - |

### Week 7: 官方 Agent 开发

**目标 Agent：**
1. **小红书 Agent** - 笔记采集、搜索
2. **抖音 Agent** - 视频搜索、评论
3. **知乎 Agent** - 问题搜索、回答采集

**每个 Agent 包含：**
- 10+ 预置坐标
- 完整的知识库
- 常见操作流程
- 验证规则

### Week 8: Agent 市场 MVP

**功能：**
- Agent 列表展示
- 下载安装功能
- 评分系统
- 基础搜索

---

## 四、Phase 3: 商业化（Week 9-12）

### Week 9-10: License 系统

**技术方案：**
- 使用 Lemonsqueezy/Paddle 处理支付
- 本地 License 验证
- 功能开关控制

**代码结构：**
```javascript
// src/core/license-manager.js
class LicenseManager {
  async validateLicense(key) {...}
  async activateLicense(key) {...}
  checkFeatureAccess(feature) {...}
}
```

### Week 11: 功能分离

**开源版功能：**
- 基础浏览器
- 通用 Agent
- 1-2 个 Demo Agent
- YAML 手动编辑

**Pro 版功能：**
- 所有官方 Agent
- Agent 生成器
- 高级导出
- 云端同步

### Week 12: 发布准备

**任务清单：**
- [ ] 官网搭建
- [ ] 演示视频制作
- [ ] 文档完善
- [ ] Product Hunt 准备
- [ ] GitHub 开源发布

---

## 五、关键决策点

### 决策 1: Agent 编辑器实现方式

| 方案 | 优点 | 缺点 | 建议 |
|------|------|------|------|
| **A. 集成到 shell.html** | 开发快 | 空间受限 | Phase 1 |
| **B. 独立窗口** | 体验好 | 开发复杂 | Phase 2 |
| **C. Web 应用** | 跨平台 | 需要服务 | 后期 |

**决策：** 先做 A（表单版），再做 B（可视化版）

### 决策 2: 订阅系统选型

| 方案 | 费用 | 集成难度 | 功能 |
|------|------|----------|------|
| **Lemonsqueezy** | 5% + 50¢ | 简单 | 完整 |
| **Paddle** | 5% + 50¢ | 中等 | 完整 |
| **自建** | 低 | 复杂 | 需维护 |

**决策：** 使用 Lemonsqueezy（简单、功能完整）

### 决策 3: 开源策略

| 策略 | 开源内容 | 闭源内容 |
|------|----------|----------|
| **Core 开源** | 浏览器、基础 Agent、配置化系统 | 编辑器、市场、云端 |
| **全开源** | 全部 | 无 |
| **部分开源** | 浏览器 | Agent 系统 |

**决策：** Core 开源，高级功能订阅

---

## 六、风险管理

### 风险矩阵

| 风险 | 概率 | 影响 | 应对策略 |
|------|------|------|----------|
| 网站改版 | 高 | 中 | 快速更新机制 + 社区贡献 |
| 竞品跟进 | 中 | 中 | 快速迭代 + 社区生态 |
| 技术难点 | 中 | 低 | MVP 先行 + 分阶段 |
| 用户增长慢 | 中 | 高 | 营销策略 + 产品打磨 |

### 应对预案

**网站改版导致 Agent 失效：**
```
检测机制：定期验证坐标有效性
更新机制：官方 Agent 48h 内更新
社区机制：用户可以快速提交修复
```

**技术实现延期：**
```
Plan A: 完整功能（4周）
Plan B: 简化功能（2周）
Plan C: 手动 YAML（1周）
```

---

## 七、资源需求

### 开发资源

| 角色 | 工作量 | 说明 |
|------|--------|------|
| 前端开发 | 60% | 编辑器界面 |
| 后端开发 | 30% | Agent 系统 |
| 测试 | 10% | 自动化测试 |

### 工具/服务

| 工具 | 用途 | 成本 |
|------|------|------|
| Lemonsqueezy | 支付处理 | 5% + 50¢ |
| Vercel | 官网托管 | 免费 |
| GitHub | 代码托管 | 免费 |

---

## 八、验收标准

### Phase 1 验收

- [ ] 可以从 YAML 创建 Agent
- [ ] 热重载正常工作
- [ ] 基础表单编辑器可用
- [ ] 所有测试通过

### Phase 2 验收

- [ ] 可视化编辑器可用
- [ ] 5 个官方 Agent 完成
- [ ] Agent 市场 MVP 上线

### Phase 3 验收

- [ ] License 系统正常工作
- [ ] 付费流程完整
- [ ] GitHub 开源发布
- [ ] Product Hunt 上线

---

*文档基于详细规划讨论整理*
*创建时间：2026-03-16*
