# Siliu CDP (Chrome DevTools Protocol) 集成

## 概述

Siliu 现在支持两种浏览器控制模式：

1. **JS 注入模式** (默认) - 使用 `webContents.executeJavaScript()`
2. **CDP 模式** - 使用 Chrome DevTools Protocol 通过 WebSocket 连接

## CDP 模式优势

- 更精细的浏览器控制
- 支持原生鼠标/键盘事件模拟
- 更好的性能和稳定性
- 支持网络监控
- 可以截取全页面截图（不仅是视口）
- 更低的检测率（更难被网站识别为自动化）

## 使用方法

### 1. 启动时启用 CDP 模式

```bash
# 环境变量方式
SILIU_CONTROLLER_MODE=cdp npm start

# 或修改代码
const controller = new SiliuController({
  core: modules.core,
  mode: 'cdp',  // 'js' 或 'cdp'
  debugPort: 9223
});
```

### 2. 运行时切换模式

```javascript
// 启用 CDP 模式
await controller.enableCDPMode(9223);

// 禁用 CDP 模式（回到 JS 模式）
controller.disableCDPMode();

// 获取当前模式
const mode = controller.getMode(); // 'js' 或 'cdp'
```

### 3. API 使用

CDP 模式下 API 完全兼容 JS 模式：

```javascript
// 导航
await controller.navigate('https://github.com');

// 点击
await controller.click('button.submit');

// 输入文本
await controller.type('input[name="q"]', 'openclaw');

// 滚动
await controller.scroll('down', 500);

// 获取内容
const { content } = await controller.getContent();

// 截图
const { dataUrl } = await controller.screenshot({ fullPage: true });
```

## CDP 专用功能

### 网络监控

```javascript
const CDPController = require('./siliu-controller/cdp-controller');
const cdp = new CDPController({ debugPort: 9223 });

await cdp.connect();

// 监听网络请求
cdp.cdp.on('Network.requestWillBeSent', (params) => {
  console.log('Request:', params.request.url);
});

// 监听响应
cdp.cdp.on('Network.responseReceived', (params) => {
  console.log('Response:', params.response.url, params.response.status);
});

// 等待网络空闲
await cdp.cdp.waitForNetworkIdle(5000, 500);
```

### DOM 操作

```javascript
// 获取文档根节点
const root = await cdp.getDocument();

// 查询元素
const nodeId = await cdp.querySelector('.my-class');

// 查询多个元素
const nodeIds = await cdp.querySelectorAll('.item');

// 获取属性
const attrs = await cdp.getAttributes(nodeId);

// 获取文本内容
const text = await cdp.getTextContent(nodeId);
```

### 执行 JavaScript

```javascript
const result = await cdp.cdp.evaluate(`
  document.querySelector('h1').innerText
`, { returnByValue: true });

console.log(result.value);
```

## 配置选项

```javascript
const controller = new SiliuController({
  core: modules.core,
  mode: 'cdp',
  debugPort: 9223,           // CDP 调试端口
  humanize: {
    enabled: true,           // 启用人类化延迟
    minDelay: 300,           // 最小延迟 (ms)
    maxDelay: 800,           // 最大延迟 (ms)
    typeDelay: 50,           // 打字延迟 (ms)
    scrollDelay: 200         // 滚动延迟 (ms)
  }
});
```

## 故障排除

### CDP 连接失败

1. 检查调试端口是否被占用：
   ```bash
   lsof -i :9223
   ```

2. 检查 Electron 是否启用了调试：
   ```javascript
   app.commandLine.appendSwitch('remote-debugging-port', '9223');
   ```

3. 防火墙是否允许连接

### 性能问题

CDP 模式通常比 JS 注入模式更快，但如果遇到性能问题：
- 减少不必要的网络监控
- 禁用不用的 CDP 域
- 使用 `awaitPromise: false` 执行 JavaScript

### 兼容性

CDP 模式需要：
- Electron 12+ （使用 Chromium 89+）
- 或 Chrome 89+

某些旧版网站可能需要回退到 JS 模式。

## 架构

```
SiliuController (统一 API)
    │
    ├── JS Mode (webContents.executeJavaScript)
    │
    └── CDP Mode
        │
        └── CDPController
            │
            └── CDPManager (WebSocket 连接)
                │
                └── Chrome DevTools Protocol
```

## 测试

```bash
# 使用 CDP 模式运行测试
SILIU_CONTROLLER_MODE=cdp npm test

# 或使用 JS 模式
SILIU_CONTROLLER_MODE=js npm test
```

## 未来计划

- [ ] 支持多标签同时控制
- [ ] 支持移动端模拟
- [ ] 支持性能分析
- [ ] 支持网络拦截和修改
- [ ] 支持本地存储操作
