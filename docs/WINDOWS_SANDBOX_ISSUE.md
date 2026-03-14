# Windows 右键菜单沙盒问题记录

## 问题描述

在 Windows 系统开发模式下，Electron 的右键菜单（标签页菜单、链接菜单、图片菜单等）无法正常显示，报错：

```
Error: ERR_FAILED (-2) loading 'file:///.../menu.html'
```

## 根本原因

Windows 平台下 Electron 的沙盒机制 (Sandbox) 会阻止子窗口加载本地 HTML 文件。这是开发模式特有的问题，打包后的生产版本不受影响。

## 解决方案

### 开发模式

使用 `--no-sandbox` 参数启动：

```bash
# 方式1：使用修改后的启动脚本
.\start.bat

# 方式2：直接运行 npm start（已在 package.json 中配置 --no-sandbox）
npm start

# 方式3：直接调用 Electron
.\node_modules\.bin\electron . --no-sandbox
```

### 生产模式

无需特殊处理，electron-builder 打包后的 Windows 版本自动正常工作。

## 相关提交

- `e3a7fd1` - fix(Windows): 启动脚本添加 --no-sandbox 解决右键菜单失效问题

## 影响范围

| 场景 | 是否受影响 | 解决方案 |
|------|-----------|---------|
| Windows 开发模式 (npm start) | ✅ 受影响 | 已配置 `--no-sandbox` |
| Windows 开发模式 (start.bat) | ✅ 受影响 | 已配置 `--no-sandbox` |
| Windows 打包版本 | ❌ 不受影响 | 无需处理 |
| macOS 开发模式 | ❌ 不受影响 | 无需处理 |
| Linux 开发模式 | 待验证 | - |

## 技术细节

### 为什么打包后没问题？

打包后的 Electron 应用有完整的签名和权限上下文，沙盒策略与开发模式不同。开发模式下 Node 进程的权限上下文与渲染进程隔离更严格，导致 `BrowserWindow` 加载本地文件被拦截。

### 安全提示

`--no-sandbox` 仅建议在开发环境使用，生产环境应保持沙盒启用。本项目生产版本通过正确的应用签名和打包配置，无需禁用沙盒即可正常工作。
