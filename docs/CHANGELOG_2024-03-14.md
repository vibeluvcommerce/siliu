# 变更日志 - 2024-03-14

## 概述
今日主要完成 Agent 系统的架构重构，实现可扩展的浏览器自动化助手框架。

---

## 主要变更

### 1. Agent 系统架构重构 ✨

#### 新增文件
- `src/copilot/agents/base-agent.js` - Agent 基类，定义扩展接口
- `src/copilot/agents/agent-registry.js` - Agent 注册表，支持自动加载
- `src/copilot/agents/index.js` - 模块入口
- `src/copilot/agents/builtin/general-agent.js` - 通用助手（内置）
- `src/copilot/agents/builtin/bilibili-agent.js` - B站助手（内置）
- `src/copilot/agents/custom/README.md` - 自定义 Agent 说明
- `src/copilot/agents/custom/example-agent.js.template` - 示例模板

#### 架构设计
```
agents/
├── base-agent.js              # 基类（定义扩展接口）
├── agent-registry.js          # 注册表（自动加载 custom）
├── index.js                   # 模块入口
├── builtin/                   # 内置 Agent
│   ├── general-agent.js       # 通用助手
│   └── bilibili-agent.js      # B站助手
└── custom/                    # 自定义 Agent（开发阶段共享）
    ├── README.md
    └── example-agent.js.template
```

#### 核心特性
- **分层架构**：Prompt 构建层、数据处理层、工具方法层
- **自动加载**：`custom/` 目录下的 Agent 自动识别加载
- **向后兼容**：支持旧版 PromptBuilder 调用方式
- **URL 自动选择**：根据页面 URL 自动匹配合适的 Agent

---

### 2. PromptBuilder 简化 🔧

**修改文件**：`src/copilot/prompt-builder.js`

#### 变更内容
- 移除冗余的本地 Prompt 构建逻辑
- 完全委托给 Agent 系统构建 Prompt
- 提供默认 Agent 用于向后兼容
- 简化视觉增强逻辑

**代码变化**：
```javascript
// 旧：复杂的本地构建逻辑
// 新：委托给 Agent
buildActionPrompt(...) {
  const agent = this._getAgent();
  return agent.buildActionPrompt({...});
}
```

---

### 3. WindowCopilot 集成 🔌

**修改文件**：`src/copilot/window-copilot.js`

#### 变更内容
- 添加 `switchAgent()` 方法支持 Agent 切换
- 添加 `getCurrentAgent()` 方法获取当前 Agent
- 修复 `_parseDecision` 解析多 JSON 的问题
- 修复 `press` 操作返回值缺失 `mode` 的问题
- 添加坐标检测的灵活性（支持隐式 x/y 坐标）

#### Bug 修复
1. **CDP type 失败**：添加 `selectorOrText` 空值检查
2. **坐标检测**：支持 `{x, y}` 隐式坐标（无需 `type: "coordinate"`）
3. **历史记录**：增强描述信息（显示文本、坐标、URL）

---

### 4. CDP Controller 防御性编程 🛡️

**修改文件**：
- `src/siliu-controller/cdp-controller.js`
- `src/siliu-controller/index.js`

#### 变更内容
- `smartFind()`：添加空值和类型检查
- `type()`：前置参数校验
- `click()`：前置参数校验
- `_isCSSSelector()`：添加字符串类型检查
- `press()`：修复返回值缺失 `mode` 字段

---

### 5. IPC 通信支持 📡

**修改文件**：
- `src/core/events.js`
- `src/core/ipc-handlers.js`
- `src/preload/index.js`
- `public/shell.html`

#### 变更内容
- 添加 `AGENT_SWITCH` 事件常量
- 添加 IPC 处理器 `copilot:switchAgent`
- 前端 UI 支持 Agent 切换下拉框

---

### 6. 开发文档 📚

**新增文件**：`docs/AGENT_DEVELOPMENT.md`

#### 文档内容
- 架构设计说明
- 快速开始教程
- 完整 API 参考
- 最佳实践指南
- 示例代码（淘宝 Agent、数据采集 Agent）
- 调试与测试方法
- 常见问题解答

---

## 文件变更统计

| 类型 | 数量 | 说明 |
|------|------|------|
| 新增文件 | 8 | Agent 系统核心文件 |
| 修改文件 | 9 | 集成 Agent 系统 |
| 删除文件 | 0 | - |
| 新增代码行 | ~2,000 | Agent 基类、文档等 |
| 删除代码行 | ~340 | 简化 PromptBuilder |

---

## 待办事项

- [ ] 测试 Agent 切换功能
- [ ] 验证 BilibiliAgent 的 B站优化
- [ ] 添加更多内置 Agent（如 TaobaoAgent）
- [ ] 正式发布时隔离 custom 目录

---

## 破坏性变更

无。所有变更向后兼容，原有功能不受影响。

---

## 迁移指南

### 对于开发者

如需创建自定义 Agent：

```bash
# 1. 复制模板
cp src/copilot/agents/custom/example-agent.js.template \
   src/copilot/agents/custom/my-agent.js

# 2. 修改实现
# 3. 重启应用自动加载
```

### 对于用户

无需任何操作，系统会自动使用默认的 GeneralAgent。

---

*提交时间：2024-03-14*
