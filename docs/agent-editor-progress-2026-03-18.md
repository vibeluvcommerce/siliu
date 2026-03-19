# Agent Editor 功能优化进度 - 2026-03-18

## 今日目标
修复 Agent Editor 的标记序号递增、状态清理和二次确认弹窗功能。

---

## 已完成修复 ✅

### 1. 标记序号递增问题
**问题**：新标签页和标签切换时，标记序号不自增（一直显示 1）

**修复方案**：
- 修改 `agentEditor:inject` IPC 调用，直接传递 `coordinates` 参数
- 避免依赖 `agentEditorData` Map 的同步时序问题

**修改文件**：
- `src/app.js`: 第 914 行，`agentEditor:inject` 添加 `coordinates` 参数
- `src/preload/index.js`: 第 92 行，传递 `coordinates` 参数
- `public/shell.html`: 多处调用传入 `annotationSession.coordinates`

### 2. 关闭最后一个标签页清理状态
**问题**：关闭最后一个标签页后新建标签页，会继承之前的 Agent Editor 状态

**修复方案**：
- 在 `tab-manager.js` 的 `closeView` 中，关闭最后一个标签页时触发 `view:last-closed` 事件
- 在 `app.js` 中监听该事件，清理所有 Agent Editor 状态

**修改文件**：
- `src/core/tab-manager.js`: 第 279 行，添加 `this.emit('view:last-closed')`
- `src/app.js`: 第 251 行，添加事件监听和状态清理

### 3. 取消按钮功能
**问题**：点击取消按钮应该关闭所有标签页并放弃所有标注

**修复方案**：
- 修改取消按钮发送的消息类型为 `AGENT_EDITOR_CANCEL_ALL`
- 主进程处理该消息，清理状态并关闭所有标签页

**修改文件**：
- `src/app.js`: 第 791 行，`agentEditorCancelAllHandler` 处理函数
- `public/shell.html`: 第 2753 行，`agentEditor:cancelAll` 事件监听

### 4. 二次确认弹窗（部分完成）
**问题**：需要在放弃标注时显示确认弹窗

**实现方案**：
- 使用系统 `dialog.showMessageBox` 避免 BrowserView 层级问题
- 在 `shell.html` 添加 `showConfirm` 函数

**修改文件**：
- `src/app.js`: 第 1605 行，添加 `dialog:confirm` IPC handler
- `src/preload/index.js`: 第 96 行，添加 `showConfirmDialog` API
- `public/shell.html`: 第 2684 行，`showConfirm` 函数

---

## 当前问题 ❌

### 关键问题：shell.html 脚本函数未定义
**现象**：
- 浏览器控制台输入 `typeof addNewAgent` 返回 `'undefined'`
- 点击"创建新 Agent"按钮无响应
- 点击"设置"按钮无响应
- 所有在第二个 `<script>` 块中定义的函数都未定义

**排查信息**：
- `document.querySelectorAll('script')` 只返回 1 个 inline script
- 第二个 `<script>` 块（1944 行开始）似乎被浏览器忽略
- 没有明显的语法错误（Node.js 解析通过）

**可能原因**：
1. 特殊字符或编码问题导致脚本解析失败
2. `</script>` 标签未正确闭合
3. HTML 结构问题导致浏览器提前结束解析
4. 缓存问题（已尝试清除缓存未解决）

---

## 明日排查方向 🔍

### 优先级 1：修复脚本加载
1. **检查 HTML 结构**
   ```bash
   # 检查 </script> 标签
   grep -n "</script>" public/shell.html
   ```

2. **检查特殊字符**
   - 查看 1944 行附近的 `<script>` 标签是否有隐藏字符
   - 检查文件编码（应为 UTF-8）

3. **简化测试**
   - 在第二个 script 块开头添加简单的 `console.log('test')`
   - 检查是否能输出

4. **检查浏览器控制台错误**
   - 刷新页面，查看是否有脚本解析错误
   - 查看 Network 面板，确认 shell.html 加载完整

### 优先级 2：确认弹窗功能
- 脚本加载修复后，测试确认弹窗是否正常显示
- 无标注时直接关闭
- 有标注时显示确认弹窗

### 优先级 3：测试完整流程
1. 打开 Agent Editor
2. 添加标注
3. 关闭 Agent Editor（有标注时应有确认弹窗）
4. 重新打开 Agent Editor（应清理旧数据）

---

## 相关代码位置

### 核心文件
- `public/shell.html` - shell UI，包含 addNewAgent 等函数
- `src/app.js` - 主进程 IPC 处理
- `src/preload/index.js` - preload 脚本
- `src/core/tab-manager.js` - 标签页管理

### 关键函数位置
| 函数 | 文件 | 行号 |
|------|------|------|
| `addNewAgent()` | `public/shell.html` | 2702 |
| `showConfirm()` | `public/shell.html` | 2684 |
| `agentEditor:inject` | `src/app.js` | 914 |
| `dialog:confirm` | `src/app.js` | 1605 |
| `showConfirmDialog` | `src/preload/index.js` | 96 |
| `view:last-closed` | `src/core/tab-manager.js` | 279 |

---

## Git 提交记录
```bash
# 今日提交
[main 4cbbcc3] WIP: Agent Editor 功能优化（进行中）
```

---

## 备注
- 当前分支：`main`
- 领先 origin 28 个提交
- 未 push 到远程
