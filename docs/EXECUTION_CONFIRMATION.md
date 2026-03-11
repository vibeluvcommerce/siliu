# 执行确认机制

## 概述

执行确认机制让 AI 每步操作后验证效果，形成"决策 → 执行 → 确认 → 分析 → 再决策"的闭环。

```
AI决策 → 执行操作 → 截图确认 → 分析结果 → AI判断
                              ↓
                        成功 → 继续下一步
                        失败 → 调整策略重试
                        不确定 → AI深入分析
```

## 确认模式

### 1. 自动确认（默认）

系统自动对比执行前后截图，判断操作效果：

```json
{
  "copilot": {
    "confirmationMode": "auto"
  }
}
```

**判断逻辑**:
- 截图大小变化 > 5% → 认为有变化
- 页面导航 → 成功
- 无变化 + 非 wait 操作 → 不确定

### 2. 人工确认

每步执行后等待用户点击"确认"才继续：

```json
{
  "copilot": {
    "confirmationMode": "manual"
  }
}
```

**适用场景**:
- 关键操作需要人工审核
- 调试时观察每步效果
- 学习AI决策过程

### 3. 混合确认

自动确认 + 异常时转人工：

```json
{
  "copilot": {
    "confirmationMode": "hybrid"
  }
}
```

**逻辑**:
- 正常情况下自动通过
- 检测到异常时暂停等待用户

## 确认结果反馈给 AI

### 成功确认

```
【上一步执行确认结果】
状态: ✅ 成功
分析: 执行成功: click
建议: 继续下一步
```

### 失败确认

```
【上一步执行确认结果】
状态: ❌ 失败
分析: 执行失败: Element not found
建议: 检查错误原因，可能需要调整策略或等待页面加载

【注意】上一步执行可能未达到预期效果，请仔细分析当前截图，调整策略后重试。
```

### 不确定确认

```
【上一步执行确认结果】
状态: ⚠️ 不确定
分析: 页面可能没有变化，需要进一步验证
建议: 截图对比未检测到明显变化，建议AI重新分析当前状态
```

## 前端展示

### 执行中

```
[步骤 3/50] 正在执行: 点击登录按钮
执行中...
```

### 执行确认

```
[步骤 3/50] 执行完成: 点击登录按钮
✅ 确认成功
分析: 页面已导航到登录页
继续下一步...
```

### 需要用户确认（人工模式）

```
[步骤 3/50] 执行完成: 点击登录按钮
请确认执行效果：
[截图预览]
[✅ 成功] [❌ 失败] [⚠️ 不确定]
```

## 事件

### EXECUTION_CONFIRMED

执行已确认，包含确认结果：

```javascript
{
  step: 3,
  decision: { action: 'click', ... },
  result: { success: true },
  confirmation: {
    status: 'success',  // success | failure | uncertain
    analysis: '执行成功: click',
    suggestion: '继续下一步'
  }
}
```

### NEED_USER_CONFIRMATION

需要用户介入确认：

```javascript
{
  step: 3,
  message: '请确认执行效果',
  decision: { ... },
  screenshot: { data: '...', size: {...} }
}
```

## 实现细节

### 执行前后截图对比

```javascript
// 执行前截图
const beforeImage = await webContents.capturePage();

// 执行操作
const result = await this._executeStep(decision);

// 执行后截图（等待页面稳定）
await this._sleep(500);
const afterImage = await webContents.capturePage();

// 确认
const confirmation = await this.confirmation.confirm(
  decision,
  result,
  { beforeScreenshot, afterScreenshot }
);
```

### AI 决策反馈

确认结果通过 `previousResult.confirmation` 传递给 AI：

```javascript
await this._continueAction({
  success: true,
  confirmation: {
    status: 'success',
    analysis: '执行成功',
    suggestion: '继续下一步'
  }
});
```

提示词构建器会将确认结果添加到 AI 提示词中。

## 配置示例

### 开发调试（人工确认）

```json
{
  "copilot": {
    "confirmationMode": "manual",
    "maxSteps": 100
  }
}
```

### 生产环境（自动确认）

```json
{
  "copilot": {
    "confirmationMode": "auto",
    "maxSteps": 50
  }
}
```

### 关键任务（混合确认）

```json
{
  "copilot": {
    "confirmationMode": "hybrid",
    "maxSteps": 50
  }
}
```

## 最佳实践

1. **开发阶段**: 使用 `manual` 模式，观察 AI 每步决策
2. **测试阶段**: 使用 `hybrid` 模式，捕获异常情况
3. **生产环境**: 使用 `auto` 模式，减少人工干预
4. **关键操作**: 在 AI 提示词中明确要求"执行后截图验证"

## 常见问题

### Q: 确认超时怎么办？

A: 自动模式会继续，人工模式会转为自动继续。

### Q: AI 如何知道确认结果？

A: 确认结果通过 `previousResult.confirmation` 传递给 AI 提示词。

### Q: 可以跳过确认吗？

A: 将 `confirmationMode` 设为 `auto` 且确保操作成功率足够高。

### Q: 截图对比准确吗？

A: 当前使用文件大小对比（简单），未来可升级为像素级对比或 AI 视觉分析。
