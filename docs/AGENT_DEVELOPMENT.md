# Siliu Browser Agent 开发指南

## 目录

- [概述](#概述)
- [核心概念](#核心概念)
- [快速开始](#快速开始)
- [API 参考](#api-参考)
- [最佳实践](#最佳实践)
- [示例](#示例)
- [调试与测试](#调试与测试)
- [常见问题](#常见问题)

---

## 概述

Siliu Browser 的 Agent 系统是一个可扩展的浏览器自动化助手框架。每个 Agent 封装了针对特定网站或场景的：**领域知识**、**元素识别规则**、**操作流程优化**。

### 为什么需要 Agent？

| 场景 | 通用 Agent | BilibiliAgent |
|------|-----------|---------------|
| 搜索视频 | 点击搜索框输入 | 知道搜索框在顶部，placeholder 是 "搜索视频" |
|  Hover 菜单 | 可能点错位置 | 知道头像在 y:0.04-0.06，菜单项在 y:0.10-0.12 |
| 评论 | 找输入框困难 | 直接识别 "发一条友善的评论" placeholder |

### 架构图

```
用户任务
    ↓
WindowCopilot ──→ AgentRegistry (选择 Agent)
    ↓                      ↓
执行操作 ←──── Prompt ← Agent
    ↓
返回结果
```

---

## 核心概念

### 文件夹结构规范

```
src/copilot/agents/
├── base-agent.js              # 基类（勿动）
├── agent-registry.js          # 注册表（勿动）
├── index.js                   # 入口（勿动）
├── builtin/                   # 内置 Agent
│   ├── general-agent.js       # 通用助手
│   └── bilibili-agent.js      # B站助手
└── custom/                    # 自定义 Agent（用户扩展）
    ├── README.md              # 使用说明
    ├── example-agent.js.template  # 示例模板
    └── *.js                   # 你的自定义 Agent（自动加载）
```

**规则**：
1. `builtin/` - 官方维护的核心 Agent
2. `custom/` - 用户自定义 Agent，自动加载，开发阶段共享

### Agent 基类方法层级

```
BaseAgent
├── 【必需】构造函数 (id, name, icon, description)
│
├── 【可选覆盖】Prompt 构建层
│   ├── getSystemPrompt()      → 系统角色
│   ├── getActionSchema()      → 操作定义
│   ├── getRulesPrompt()       → 执行规则
│   ├── getExamplesPrompt()    → 操作示例
│   ├── getElementGuides()     → 元素定位指南
│   └── getDomainKnowledge()   → ⭐ 领域特定知识
│
├── 【可选覆盖】数据处理层
│   ├── processObservation()   → 预处理页面数据
│   └── formatElements()       → 自定义元素显示
│
└── 【工具方法】
    ├── getMetadata()          → 获取元信息
    ├── supportsAction()       → 检查操作支持
    └── buildActionPrompt()    → 构建完整 Prompt
```

### Prompt 组装流程

Agent 构建 Prompt 时按以下顺序组装：

```
1. getSystemPrompt()      # 你是谁
2. getActionSchema()      # 你能做什么
3. getRulesPrompt()       # 规则约束
4. getExamplesPrompt()    # 具体示例
5. getElementGuides()     # 如何定位元素
6. getDomainKnowledge()   # ⭐ 特定网站知识
7. buildTaskContext()     # 当前任务上下文
```

---

## 快速开始

### 文件夹结构

```
src/copilot/agents/
├── base-agent.js              # Agent 基类（不要修改）
├── agent-registry.js          # 注册表（不要修改）
├── index.js                   # 模块入口
├── builtin/                   # 内置 Agent（官方维护）
│   ├── general-agent.js       # 通用助手
│   └── bilibili-agent.js      # B站助手
└── custom/                    # 自定义 Agent（用户扩展）
    ├── README.md              # 使用说明
    ├── example-agent.js.template  # 示例模板
    └── your-agent.js          # ← 你的新 Agent 放在这里
```

### 创建自定义 Agent 的两种方式

#### 方式一：直接放在 custom 目录（推荐）

```bash
# 1. 复制模板文件
cd src/copilot/agents/custom
cp example-agent.js.template my-agent.js

# 2. 修改 my-agent.js，实现你的逻辑

# 3. 重启应用，自动加载
```

#### 方式二：注册为内置 Agent

如果你希望 Agent 随应用一起发布：

```bash
# 1. 创建文件在 builtin 目录
src/copilot/agents/builtin/taobao-agent.js

# 2. 在 agent-registry.js 的 _registerBuiltInAgents() 中注册
```

### 编写 Agent 类（custom 目录）

```javascript
// src/copilot/agents/custom/taobao-agent.js

const { BaseAgent } = require('../base-agent');

class TaobaoAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      id: 'taobao',                    // 唯一标识符
      name: '淘宝助手',                 // 显示名称
      icon: '🛒',                      // 图标（Emoji）
      description: '专为淘宝、天猫优化的自动化助手，支持商品搜索、购买、订单管理等操作',
      ...options
    });
  }

  /**
   * 领域特定知识 - 核心扩展点
   * 
   * 这里编写淘宝特有的：
   * - 页面结构特点
   * - 操作流程
   * - 坐标/选择器提示
   * - 注意事项
   */
  getDomainKnowledge() {
    return `【淘宝/天猫特有规则】

【页面识别】
- 淘宝域名: taobao.com
- 天猫域名: tmall.com
- 页面顶部有橙色导航栏

【搜索商品】
- 搜索框在顶部中央，placeholder 为 "搜索宝贝"
- 搜索建议下拉框出现后，可直接点击
- 搜索结果页使用 scroll 加载更多（非 wheel）

【商品详情页】
- 商品标题在页面顶部（h1 标签）
- 价格区域包含：原价（划线）、促销价（红色大字）
- "立即购买" 按钮：橙色，右侧
- "加入购物车" 按钮：橙色，右侧
- SKU 选择（颜色/尺寸）：需要先点击展开选择面板
- 数量选择器：通常在 SKU 下方

【购物车】
- 访问路径：顶部导航 → 购物车
- 商品列表每项左侧有复选框
- 全选/反选：列表顶部
- 结算按钮：固定在底部右侧
- 可修改数量、删除商品

【订单确认页】
- 必须确认收货地址（如未设置会提示）
- 优惠券自动选择最优，可手动更改
- 实付金额在底部
- 提交订单按钮：橙色，底部固定

【登录处理】
- 淘宝需要登录才能购买
- 遇到登录弹窗立即停止，使用 wait 等待用户完成
- 不要尝试自动输入账号密码

【注意事项】
- 页面元素 class 名通常是英文缩写，不易读懂
- 优先使用坐标点击而非 CSS 选择器
- 价格敏感操作（如提交订单）前必须 screenshot 确认`;
  }

  /**
   * 可选：自定义元素格式化
   * 让 Prompt 中的元素列表更易读
   */
  formatElements(elements) {
    // 先调用父类方法获取基础格式
    let result = super.formatElements(elements);
    
    // 识别淘宝特有元素
    const tips = [];
    
    if (elements.some(e => e.placeholder?.includes('搜索宝贝'))) {
      tips.push('- 搜索框可用，可输入商品关键词');
    }
    
    if (elements.some(e => e.text?.includes('立即购买'))) {
      tips.push('- 检测到购买按钮，可执行购买流程');
    }
    
    if (elements.some(e => e.text?.includes('加入购物车'))) {
      tips.push('- 可添加到购物车');
    }
    
    if (tips.length > 0) {
      result += '\n\n【淘宝元素识别】\n' + tips.join('\n');
    }

    return result;
  }

  /**
   * 可选：预处理观察数据
   * 优化元素排序或添加标记
   */
  processObservation(observation) {
    if (!observation.elements) return observation;

    // 为淘宝元素添加优先级
    observation.elements = observation.elements.map(el => {
      const enhanced = { ...el };
      
      // 搜索框最高优先级（+10）
      if (el.placeholder?.includes('搜索宝贝')) {
        enhanced.priority = (enhanced.priority || 0) + 10;
        enhanced.isTaobaoSearch = true;
      }
      
      // 购买按钮高优先级（+8）
      if (el.text?.includes('立即购买')) {
        enhanced.priority = (enhanced.priority || 0) + 8;
        enhanced.isBuyButton = true;
      }
      
      // 加入购物车（+6）
      if (el.text?.includes('加入购物车')) {
        enhanced.priority = (enhanced.priority || 0) + 6;
      }
      
      // SKU 选项（+4）
      if (el.className?.includes('sku') || el.className?.includes('prop')) {
        enhanced.priority = (enhanced.priority || 0) + 4;
        enhanced.isSKU = true;
      }
      
      return enhanced;
    });

    // 按优先级排序（高优先级在前）
    observation.elements.sort((a, b) => 
      (b.priority || 0) - (a.priority || 0)
    );

    return observation;
  }
}

module.exports = { TaobaoAgent };
```

### 注册方式

#### 方式一：custom 目录（自动加载）

**无需手动注册！** 只需将文件放入 `custom/` 目录，系统重启后自动加载。

```bash
# 文件位置
src/copilot/agents/custom/taobao-agent.js

# 重启应用后自动识别
```

#### 方式二：builtin 目录（手动注册）

如果是内置 Agent，需要在 `agent-registry.js` 中注册：

```javascript
// src/copilot/agents/agent-registry.js

const { TaobaoAgent } = require('./builtin/taobao-agent');

class AgentRegistry {
  _registerBuiltInAgents() {
    this.register(new GeneralAgent());
    this.register(new BilibiliAgent());
    this.register(new TaobaoAgent());  // ← 新增
  }
}
```

### 第四步：测试

```javascript
// test-taobao-agent.js
const { TaobaoAgent } = require('./src/copilot/agents/custom/taobao-agent');

const agent = new TaobaoAgent();

// 1. 检查元信息
console.log('Agent 信息:', agent.getMetadata());

// 2. 生成 Prompt
const prompt = agent.buildActionPrompt({
  task: '在淘宝搜索 iPhone 并查看第一个商品',
  observation: {
    url: 'https://taobao.com',
    title: '淘宝网 - 淘！我喜欢',
    elements: [
      { tag: 'input', placeholder: '搜索宝贝', rect: { x: 500, y: 100 } },
      { tag: 'button', text: '搜索', rect: { x: 800, y: 100 } }
    ]
  },
  stepCount: 0,
  history: []
});

console.log('\n=== 生成的 Prompt ===\n');
console.log(prompt);
```

运行测试：
```bash
cd c:\Users\QINGBIAOHUANG\OneDrive\文档\workspace\siliu
node test-taobao-agent.js
```

---

## API 参考

### 构造函数选项

```javascript
new BaseAgent({
  // 必需
  id: 'unique-id',              // 唯一标识符，用于切换
  name: '显示名称',              // 在 UI 中显示
  
  // 可选
  icon: '🤖',                   // Emoji 图标
  description: '描述',          // 详细描述
  maxSteps: 100,                // 最大步数限制
  maxElements: 25,              // Prompt 中最大元素数
  maxHistorySteps: 20           // 历史记录显示步数
});
```

### 方法详解

#### `getDomainKnowledge()` → string

**说明**：核心扩展点，返回特定网站的领域知识。

**最佳实践**：
- 使用清晰的层级结构（【标题】）
- 包含具体的坐标范围或选择器提示
- 说明常见错误和避免方法

**示例**：
```javascript
getDomainKnowledge() {
  return `【B站特有规则】

【视频页】
- 播放按钮在视频中央
- 控制栏在底部，包含：播放/暂停、进度、音量、全屏

【评论区】
- 输入框 placeholder: "发一条友善的评论"
- 发送按钮是蓝色 "发送" 文字

【Hover 菜单】
- 头像在 y: 0.04-0.06
- 下拉菜单项在 y: 0.10-0.12
- 【禁止】y > 0.20 的点击`;
}
```

---

#### `processObservation(observation)` → observation

**说明**：预处理页面观察数据，可添加优先级、标记等。

**参数**：
- `observation` - 包含 `url`, `title`, `elements` 等

**返回**：处理后的 observation

**示例**：
```javascript
processObservation(observation) {
  if (!observation.elements) return observation;

  observation.elements = observation.elements.map(el => {
    const enhanced = { ...el };
    
    // 添加优先级
    if (el.id === 'search') {
      enhanced.priority = 10;
    }
    
    // 添加标记
    if (el.className?.includes('player')) {
      enhanced.isVideoPlayer = true;
    }
    
    return enhanced;
  });

  // 排序
  observation.elements.sort((a, b) => 
    (b.priority || 0) - (a.priority || 0)
  );

  return observation;
}
```

---

#### `formatElements(elements)` → string

**说明**：自定义元素在 Prompt 中的显示格式。

**参数**：
- `elements` - 元素数组

**返回**：格式化后的字符串

**示例**：
```javascript
formatElements(elements) {
  // 基础格式
  let result = super.formatElements(elements);
  
  // 添加自定义提示
  if (elements.some(e => e.isVideoPlayer)) {
    result += '\n\n【识别到视频播放器】';
  }
  
  return result;
}
```

---

#### `getActionSchema()` → object

**说明**：定义可用操作。可覆盖以添加新操作或修改描述。

**结构**：
```javascript
{
  actionName: {
    params: ['param1', 'param2'],     // 参数列表
    desc: '操作描述',                  // 简短描述
    example: { ... }                  // 示例对象
  }
}
```

**示例**：
```javascript
getActionSchema() {
  const schema = super.getActionSchema();
  
  // 修改现有操作
  schema.click.desc = '点击元素，优先使用坐标';
  
  // 添加新操作
  schema.extractData = {
    params: ['selector'],
    desc: '提取结构化数据',
    example: {
      action: 'extractData',
      selector: '.product-list',
      description: '提取商品列表数据'
    }
  };
  
  return schema;
}
```

---

#### `buildActionPrompt(context)` → string

**说明**：构建完整的 Action Prompt。

**参数**：
```javascript
{
  task: '任务目标',
  observation: {           // 页面观察数据
    url: '...',
    title: '...',
    elements: [...]
  },
  previousResult: {        // 上一步结果
    success: true/false,
    error: '...'
  },
  stepCount: 5,            // 当前步数
  history: [...]           // 执行历史
}
```

**返回**：完整 Prompt 字符串

---

#### `buildVisualActionPrompt(context)` → {text, hasVisual}

**说明**：构建带视觉增强的 Prompt（包含截图信息）。

**返回**：
```javascript
{
  text: '完整 Prompt',
  hasVisual: true
}
```

---

#### `getMetadata()` → object

**说明**：获取 Agent 元信息，用于 UI 显示。

**返回**：
```javascript
{
  id: 'taobao',
  name: '淘宝助手',
  icon: '🛒',
  description: '...',
  actions: ['navigate', 'click', 'type', ...]
}
```

---

## 最佳实践

### 1. 领域知识编写规范

```javascript
getDomainKnowledge() {
  return `【网站名 + 版本】

【页面结构 - 关键区域】
- 区域A位置：描述位置特点
- 区域B识别：如何识别这个区域

【操作流程 - 标准步骤】
- 任务1：步骤1 → 步骤2 → 步骤3
- 任务2：步骤1 → 步骤2

【元素定位 - 精确提示】
- 元素A：使用选择器 #id 或坐标 x,y
- 元素B：在 y: 0.05-0.10 范围内

【注意事项 - 常见错误】
- 错误1：原因 + 正确做法
- 错误2：原因 + 正确做法`;
}
```

### 2. 优先级设定建议

```javascript
// 最高优先级（+10）：核心交互元素
if (el.isSearchInput) priority += 10;

// 高优先级（+7-9）：主要操作按钮
if (el.isBuyButton) priority += 8;
if (el.isSubmitButton) priority += 7;

// 中优先级（+4-6）：辅助元素
if (el.isNavItem) priority += 5;

// 低优先级（+1-3）：信息展示
if (el.isFooter) priority += 1;
```

### 3. 坐标范围描述规范

```javascript
// 不好的描述
'点击头像下方的菜单'

// 好的描述  
'头像在 y: 0.04-0.06，下拉菜单项在 y: 0.10-0.12，x: 0.75-0.85'
```

### 4. 错误预防提示

```javascript
getDomainKnowledge() {
  return `【常见错误预防】

【绝对禁止】
- y > 0.20 的点击（超出下拉菜单范围）
- 直接操作未加载的元素

【必须先确认】
- 提交订单前必须 screenshot
- hover 后必须 screenshot 再点击菜单

【等待要求】
- 页面加载后 wait 1000ms
- 点击后 wait 500ms`;
}
```

---

## 示例

### 数据采集 Agent

```javascript
class DataCollectionAgent extends BaseAgent {
  constructor() {
    super({
      id: 'data-collection',
      name: '数据采集助手',
      icon: '📊',
      description: '专为网页数据采集优化，支持列表翻页、结构化提取'
    });
  }

  getDomainKnowledge() {
    return `【数据采集规则】

【翻页策略】
1. 寻找 "下一页" 按钮（优先）
2. 如无按钮，尝试滚动加载（scroll）
3. 记录当前页码，防止重复

【数据提取】
- 使用 get_content 获取页面源码
- 识别列表项的重复模式
- 记录列表容器选择器

【容错处理】
- 网络错误：重试3次
- 数据缺失：记录警告继续
- 格式错误：跳过该项`;
  }

  processObservation(observation) {
    // 识别列表容器
    observation.elements.forEach(el => {
      if (el.className?.includes('list') || 
          el.className?.includes('items')) {
        el.isListContainer = true;
        el.priority = 10;
      }
    });
    
    return observation;
  }
}
```

### 表单填写 Agent

```javascript
class FormFillingAgent extends BaseAgent {
  constructor() {
    super({
      id: 'form-filling',
      name: '表单助手',
      icon: '📝',
      description: '智能识别表单字段，自动填充信息'
    });
  }

  getDomainKnowledge() {
    return `【表单填写规则】

【字段识别】
- 邮箱：input[type="email"] 或 placeholder 含 "邮箱"
- 手机：input[type="tel"] 或 placeholder 含 "手机"
- 验证码：通常紧邻输入框右侧

【填写顺序】
1. 文本输入框（从上到下）
2. 单选/复选框
3. 下拉选择
4. 提交按钮

【验证检查】
- 必填字段：检查是否有 * 标记
- 格式验证：邮箱、手机号格式
- 提交前：screenshot 确认`;
  }
}
```

---

## 调试与测试

### 单元测试模板

```javascript
// __tests__/taobao-agent.test.js

const { TaobaoAgent } = require('../src/copilot/agents/taobao-agent');

describe('TaobaoAgent', () => {
  let agent;

  beforeEach(() => {
    agent = new TaobaoAgent();
  });

  test('应该有正确的元信息', () => {
    const meta = agent.getMetadata();
    expect(meta.id).toBe('taobao');
    expect(meta.name).toBe('淘宝助手');
    expect(meta.icon).toBe('🛒');
  });

  test('应该支持基础操作', () => {
    expect(agent.supportsAction('click')).toBe(true);
    expect(agent.supportsAction('type')).toBe(true);
  });

  test('应该包含淘宝特有知识', () => {
    const knowledge = agent.getDomainKnowledge();
    expect(knowledge).toContain('淘宝');
    expect(knowledge).toContain('搜索宝贝');
  });

  test('应该正确设置元素优先级', () => {
    const observation = {
      elements: [
        { tag: 'input', placeholder: '搜索宝贝' },
        { tag: 'button', text: '其他按钮' }
      ]
    };

    const processed = agent.processObservation(observation);
    
    // 搜索框应该被标记
    expect(processed.elements[0].isTaobaoSearch).toBe(true);
    expect(processed.elements[0].priority).toBeGreaterThan(0);
  });

  test('应该生成有效的 Prompt', () => {
    const prompt = agent.buildActionPrompt({
      task: '搜索商品',
      observation: { url: 'https://taobao.com', elements: [] },
      stepCount: 0,
      history: []
    });

    expect(prompt).toContain('淘宝');
    expect(prompt).toContain('搜索宝贝');
    expect(prompt).toContain('任务目标');
  });
});
```

### 调试日志

```javascript
// 在 Agent 中添加日志
processObservation(observation) {
  console.log(`[${this.id}] 处理观察数据:`, {
    url: observation.url,
    elementCount: observation.elements?.length
  });
  
  // ... 处理逻辑
  
  console.log(`[${this.id}] 处理完成:`, {
    highPriorityElements: observation.elements.filter(e => e.priority > 5).length
  });
  
  return observation;
}
```

### 手动测试脚本

```javascript
// debug-agent.js
const { registry } = require('./src/copilot/agents');

// 切换到指定 Agent
registry.switchTo('taobao');

const agent = registry.getCurrent();

// 模拟页面观察数据
const mockObservation = {
  url: 'https://s.taobao.com/search?q=iPhone',
  title: 'iPhone - 淘宝搜索',
  elements: [
    { tag: 'input', placeholder: '搜索宝贝', rect: { x: 400, y: 80 } },
    { tag: 'a', text: 'iPhone 15', rect: { x: 200, y: 300 } },
    { tag: 'span', text: '¥5999', rect: { x: 200, y: 330 } }
  ]
};

// 生成 Prompt
const prompt = agent.buildActionPrompt({
  task: '找到最便宜的 iPhone 15',
  observation: mockObservation,
  stepCount: 1,
  history: [
    {
      step: 1,
      decision: { action: 'navigate', url: 'taobao.com', description: '打开淘宝' },
      confirmStatus: 'yes'
    }
  ]
});

// 保存到文件便于查看
const fs = require('fs');
fs.writeFileSync('debug-prompt.txt', prompt);
console.log('Prompt 已保存到 debug-prompt.txt');
```

---

## 常见问题

### Q1: Agent 应该放在哪个文件夹？

**自定义 Agent（custom 目录）**：
```
src/copilot/agents/custom/my-agent.js
```
- 自动加载，无需注册
- 开发阶段随项目共享
- 正式发布后将隔离

**内置 Agent（官方发布）**：
```
src/copilot/agents/builtin/my-agent.js
```
- 需要手动注册
- 随应用一起发布
- 适合贡献给社区

---

### Q2: Agent 切换后 Prompt 没有变化？

**检查点**：
1. Agent 是否已注册：`registry.has('your-id')`
2. 切换是否成功：`registry.switchTo('your-id')` 返回 true
3. 获取是否正确：`registry.getCurrent().id`

**调试代码**：
```javascript
const { registry } = require('./copilot/agents');

console.log('已注册 Agents:', registry.getAllAgents().map(a => a.id));
console.log('当前 Agent:', registry.getCurrent()?.id);
console.log('切换结果:', registry.switchTo('your-id'));
console.log('切换后 Agent:', registry.getCurrent()?.id);
```

---

### Q3: 如何扩展基础操作？

覆盖 `getActionSchema()`：

```javascript
getActionSchema() {
  const schema = super.getActionSchema();
  
  // 添加新操作
  schema.myCustomAction = {
    params: ['target', 'data'],
    desc: '自定义操作说明',
    example: {
      action: 'myCustomAction',
      target: { type: 'coordinate', x: 0.5, y: 0.5 },
      data: 'some data',
      description: '执行自定义操作'
    }
  };
  
  return schema;
}
```

同时需要在 `window-copilot.js` 中添加对应执行逻辑。

---

### Q4: 如何根据 URL 自动选择 Agent？

在 WindowCopilot 中添加自动检测：

```javascript
// src/copilot/window-copilot.js

_autoSelectAgent(url) {
  const { registry } = require('./agents');
  
  if (url.includes('bilibili.com')) {
    registry.switchTo('bilibili');
  } else if (url.includes('taobao.com') || url.includes('tmall.com')) {
    registry.switchTo('taobao');
  } else {
    registry.switchTo('general');
  }
}
```

在观察页面时调用：

```javascript
async _observePage() {
  // ...
  
  // 自动选择 Agent
  if (observation.url) {
    this._autoSelectAgent(observation.url);
  }
  
  // ...
}
```

---

### Q5: 如何共享通用功能？

创建 Mixin 或工具函数：

```javascript
// src/copilot/agents/utils.js

/**
 * 为元素添加坐标范围标记
 */
function markCoordinateRange(elements, ranges) {
  return elements.map(el => {
    const y = el.rect?.y;
    if (!y) return el;
    
    for (const [name, { min, max }] of Object.entries(ranges)) {
      if (y >= min && y <= max) {
        el.coordinateRange = name;
      }
    }
    return el;
  });
}

/**
 * 根据文本特征识别元素类型
 */
function recognizeByText(elements, patterns) {
  return elements.map(el => {
    const text = el.text || '';
    
    for (const [type, keywords] of Object.entries(patterns)) {
      if (keywords.some(k => text.includes(k))) {
        el.recognizedType = type;
      }
    }
    return el;
  });
}

module.exports = { markCoordinateRange, recognizeByText };
```

在 Agent 中使用：

```javascript
const { markCoordinateRange } = require('./utils');

processObservation(observation) {
  observation.elements = markCoordinateRange(
    observation.elements,
    {
      header: { min: 0, max: 0.1 },
      content: { min: 0.1, max: 0.8 },
      footer: { min: 0.8, max: 1.0 }
    }
  );
  return observation;
}
```

---

## 贡献指南

如果你想将 Agent 贡献给官方仓库：

1. **功能完整**：覆盖网站主要操作流程
2. **文档齐全**：包含示例和注意事项
3. **测试覆盖**：提供单元测试
4. **向后兼容**：不破坏现有功能
5. **代码规范**：遵循项目 ESLint 规则

提交 PR 前请确保：
- [ ] Agent 文件放置在 `src/copilot/agents/builtin/` 目录
- [ ] 已在 `agent-registry.js` 的 `_registerBuiltInAgents()` 中注册
- [ ] 已通过本地测试
- [ ] 已更新本文档

开发阶段：自定义 Agent 可以放在 `custom/` 目录随项目共享，便于团队协作测试。

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2024-03 | 初始版本，支持基础 Agent 架构 |

---

*最后更新：2024-03*
