# CDP 测试指南

## 前提条件

1. **Siliu 浏览器正在运行**
2. **启用了远程调试端口**

启动方式:
```bash
cd /home/ubuntu/.openclaw/workspace/siliu
npm start
```

## 测试方案

### 方案 1: 快速 CDP 连接测试

```bash
node test-cdp.js
```

预期输出:
```
=================================
Siliu CDP 功能测试
=================================

Test 1: 连接到浏览器...
✓ 连接成功

Test 2: 导航到 example.com...
✓ 导航成功

Test 3: 获取页面标题...
  标题: Example Domain
✓ 获取标题成功

...
=================================
所有测试通过!
=================================
```

### 方案 2: SiliuController 双模式测试

在 DevTools 控制台执行:

```javascript
// 获取 controller
const controller = window.siliuAPI?.controller;

// 查看当前模式
console.log('当前模式:', controller?.getMode?.());

// 测试 1: 当前模式导航
await controller?.navigate?.('https://github.com');

// 测试 2: 点击操作
await controller?.click?.('Sign in');

// 测试 3: 获取内容
const { content } = await controller?.getContent?.();
console.log('页面内容:', content.substring(0, 200));
```

### 方案 3: 切换模式测试

```javascript
const controller = window.siliuAPI?.controller;

// 当前模式
console.log('当前模式:', controller.getMode());

// 切换到 CDP 模式
const result = await controller.enableCDPMode(9223);
console.log('CDP 启用:', result);

// 测试 CDP 操作
await controller.navigate('https://google.com');
await controller.type('input[name="q"]', 'openclaw');

// 切换回 JS 模式
controller.disableCDPMode();
console.log('当前模式:', controller.getMode());

// 测试 JS 操作
await controller.navigate('https://example.com');
```

### 方案 4: Copilot 集成测试

1. 确保 Copilot 已连接
2. 发送指令:
   ```
   打开 github.com 并搜索 openclaw
   ```
3. 观察控制台输出，检查是否使用 CDP 执行

## 常见问题

### 测试 1 失败: 连接失败

```
Error: connect ECONNREFUSED 127.0.0.1:9223
```

**解决**:
- 确保 Siliu 已启动
- 检查是否启用了调试端口
- 检查 `app.js` 中是否有:
  ```javascript
  app.commandLine.appendSwitch('remote-debugging-port', '9223');
  ```

### 测试 2 失败: CDP 模式切换失败

```
CDP connection failed: No suitable target found
```

**解决**:
- 确保有打开的标签页
- 检查 `http://127.0.0.1:9223/json/list` 是否有页面

### 测试 3: 回退机制测试

```javascript
// 强制触发 CDP 失败
await controller.enableCDPMode(9999); // 错误端口

// 应该自动回退到 JS 模式
console.log('模式:', controller.getMode()); // 'js'

// 操作应该仍然成功
await controller.navigate('https://example.com');
```

## 验证检查清单

- [ ] 连接成功
- [ ] 导航成功
- [ ] 获取标题成功
- [ ] 获取内容成功
- [ ] 执行 JavaScript 成功
- [ ] 截图成功
- [ ] CDP 模式切换成功
- [ ] JS 模式切换成功
- [ ] 自动回退工作正常

## 性能对比测试

```javascript
const controller = window.siliuAPI?.controller;

// JS 模式
controller.disableCDPMode();
console.time('js');
for (let i = 0; i < 10; i++) {
  await controller.getContent();
}
console.timeEnd('js');

// CDP 模式
await controller.enableCDPMode(9223);
console.time('cdp');
for (let i = 0; i < 10; i++) {
  await controller.getContent();
}
console.timeEnd('cdp');
```

## 完整集成测试

```bash
# 1. 启动 Siliu
npm start

# 2. 在新终端运行 CDP 测试
node test-cdp.js

# 3. 检查控制台输出
# 预期看到所有测试通过
```
