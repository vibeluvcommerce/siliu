# 数据导出功能问题记录

## 问题描述

AI 采集数据后导出失败，用户在 done 后无法看到导出文件。

## 发现的问题

### 1. 重复导出导致失败
**现象：**
```
[WindowCopilot:main] Auto-export failed: Export task xxx is not in collecting state
```

**原因：**
- AI 在任务完成前多次调用了 `export` 操作（第 43、44、45 步）
- 第一次 export 成功后，任务状态变为 `completed`
- 后续 export 和 done 时的自动导出都失败了（因为状态不是 `collecting`）

### 2. Prompt 描述不明确
原来的 Prompt 让 AI 误以为需要手动调用 export：
- `export: 触发数据导出（可选，系统会自动导出）`

AI 理解混乱，既调用了 export，又期望系统自动导出。

## 修复措施

### 1. Prompt 优化 (`src/copilot/agents/base-agent.js`)
```javascript
// 明确告诉 AI 不要手动调用 export
- 【重要】不要手动调用 export 操作，系统会在 done 时自动导出
```

### 2. 允许多次导出 (`src/core/export-manager.js`)
```javascript
// 如果已经导出过了，直接返回已导出的路径
if (index.status === 'completed' && index.exportPath) {
  return { path: index.exportPath, status: 'completed' };
}
```

### 3. 优化 export 操作 (`src/copilot/window-copilot.js`)
- 不清理 `_currentExportTaskId`（可能还要继续采集）
- 已导出过时提示成功而非报错

### 4. done 时优雅处理 (`src/copilot/window-copilot.js`)
```javascript
// 如果已经导出过，从状态中获取导出路径
if (err.message.includes('already exported')) {
  const status = await exportManager.getStatus(this._currentExportTaskId);
  if (status?.exportPath) {
    summary += `数据已导出到: ${status.exportPath}`;
  }
}
```

## 简化后的采集流程

```
AI: 滚动/翻页加载数据 → collect (只需提供 content) → 继续翻页 → collect → ... → done
                                                          ↓
系统: 自动递增页码保存 ←←←←←←←←←←←←←←←←←←← 自动合并并导出
```

## 测试建议

1. 测试分页网站采集（如豆瓣 Top250）
2. 测试无限滚动网站采集
3. 验证 done 后是否正确显示导出文件路径
4. 验证多次调用 export 不会报错

## 相关文件

- `src/copilot/agents/base-agent.js` - Prompt 定义
- `src/copilot/window-copilot.js` - 操作执行
- `src/core/export-manager.js` - 导出逻辑
- `src/exporters/excel-exporter.js` - Excel 导出器
