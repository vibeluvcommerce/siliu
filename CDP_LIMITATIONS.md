# CDP 限制与回退机制

## CDP 模式限制

### 1. **需要远程调试端口**
- 必须启用 `--remote-debugging-port=9223`
- 端口可能被占用
- 防火墙可能阻止连接

**回退**: 自动切换到 JS 模式

### 2. **跨域限制 (CORS)**
- CDP 在某些跨域场景下受限
- iframe 内部操作可能失败
- 某些 CSP 严格的网站会阻止

**回退**: 自动切换到 JS 模式执行

### 3. **页面关闭/刷新**
- CDP 连接在页面导航时会断开
- 需要重新连接
- 分离窗口支持不完善

**回退**: 自动切换到 JS 模式

### 4. **某些网站检测**
- 部分网站可以检测到 CDP/DevTools
- 可能触发反爬虫机制
- 用户代理可能暴露

**回退**: 使用 JS 模式更隐蔽

### 5. **性能开销**
- WebSocket 通信有延迟
- 大量 DOM 操作较慢
- 内存占用较高

**回退**: 简单操作使用 JS 模式

### 6. **权限限制**
- 某些系统需要管理员权限
- 企业策略可能禁用
- 沙箱环境不支持

**回退**: 强制使用 JS 模式

## 自动回退机制

### 实现方式

```javascript
async _tryCDP(cdpFn, jsFn) {
  // 非 CDP 模式直接走 JS
  if (this.mode !== 'cdp' || !this.cdpController) {
    return jsFn();
  }

  try {
    // 尝试 CDP
    return await cdpFn();
  } catch (err) {
    // CDP 特定错误才回退
    const cdpErrors = [
      'Not connected',
      'WebSocket', 
      'CDP',
      'Protocol',
      'Target closed'
    ];
    
    const shouldFallback = cdpErrors.some(e => 
      err.message.includes(e)
    );
    
    if (!shouldFallback) {
      throw err; // 非 CDP 错误，直接抛出
    }
    
    console.warn('[SiliuController] CDP error:', err.message);
    console.log('[SiliuController] Falling back to JS mode');
    
    // 回退到 JS
    return jsFn();
  }
}
```

### 应用的操作

| 操作 | CDP 失败回退 |
|------|-------------|
| `navigate()` | ✅ 自动回退 |
| `click()` | ✅ 自动回退 |
| `type()` | ✅ 自动回退 |
| `scroll()` | ✅ 自动回退 |
| `getContent()` | ✅ 自动回退 |
| `screenshot()` | ✅ 自动回退 |

### 使用示例

```javascript
// 用户无感知，自动选择最佳模式
await controller.navigate('https://example.com');
await controller.click('button.submit');

// 如果 CDP 失败，会自动用 JS 模式重试
// 控制台会显示:
// [SiliuController] CDP error: Target closed
// [SiliuController] Falling back to JS mode
```

## 手动控制

### 强制使用 JS 模式

```javascript
// 方法1: 启动时设置
const controller = new SiliuController({
  mode: 'js'  // 强制 JS 模式
});

// 方法2: 运行时切换
controller.disableCDPMode();
```

### 强制使用 CDP 模式

```javascript
// 启动时
const controller = new SiliuController({
  mode: 'cdp',
  debugPort: 9223
});

// 或运行时切换
await controller.enableCDPMode(9223);
```

### 混合模式（推荐）

```javascript
// 默认 CDP，失败自动回退
const controller = new SiliuController({
  mode: 'cdp'
});

// 大部分操作走 CDP
// 失败时自动用 JS
```

## 最佳实践

1. **开发阶段**: 使用 CDP 模式，利用更好的调试能力
2. **生产环境**: 混合模式，自动回退保证稳定性
3. **特定网站**: 如果检测到反爬虫，切换到 JS 模式
4. **分离窗口**: 暂时使用 JS 模式（CDP 支持待完善）

## 故障排除

### CDP 连接失败

```
[SiliuController] CDP connection failed: connect ECONNREFUSED 127.0.0.1:9223
[SiliuController] Falling back to JS mode
```

**解决**:
- 检查是否启用 `remote-debugging-port`
- 检查端口是否被占用
- 防火墙放行

### 页面导航后断开

```
[SiliuController] CDP error: Target closed
[SiliuController] Falling back to JS mode
```

**解决**:
- 这是正常现象，已自动回退
- 如需重新启用 CDP，调用 `await controller.enableCDPMode()`

### 某些操作 CDP 慢

```javascript
// 可以临时切换到 JS 模式
controller.disableCDPMode();
await controller.getContent();  // JS 模式执行
await controller.enableCDPMode();  // 恢复 CDP
```
