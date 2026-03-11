# Siliu Browser 反检测方案对比

## 一、当前启用的反检测方案（极简版）

| # | 措施 | 位置 | 说明 |
|---|------|------|------|
| 1 | **navigator.webdriver** | 页面脚本 | 删除或设为 undefined，防止最基本的自动化检测 |
| 2 | **window.process** | 页面脚本 | 删除 Electron 全局变量 |
| 3 | **window.require** | 页面脚本 | 删除 Node.js require |
| 4 | **User-Agent** | Session | 伪装为 Chrome 121 on Windows |

### 当前方案效果
- ✅ 通过基础自动化检测（webdriver、process）
- ⚠️ 可能被高级检测发现（navigator 属性不一致、WebGL 指纹等）
- ✅ 不影响视频播放

---

## 二、可添加但未启用的方案

### Level 2: Navigator 属性（低风险）
| # | 措施 | 影响 | 是否建议添加 |
|---|------|------|-------------|
| 5 | **navigator.platform** | 设为 "Win32" | ⚠️ 测试后添加 |
| 6 | **navigator.vendor** | 设为 "Google Inc." | ⚠️ 测试后添加 |
| 7 | **navigator.language** | 设为 "zh-CN" | ✅ 可添加 |
| 8 | **navigator.hardwareConcurrency** | 设为 8 | ✅ 可添加 |
| 9 | **navigator.deviceMemory** | 设为 8 | ✅ 可添加 |
| 10 | **navigator.maxTouchPoints** | 设为 0 | ✅ 可添加 |
| 11 | **navigator.languages** | 设为 ["zh-CN", "en"] | ⚠️ 可能影响地区内容 |

### Level 3: 浏览器指纹（中风险）
| # | 措施 | 影响 | 是否建议添加 |
|---|------|------|-------------|
| 12 | **WebGL vendor/renderer** | 伪装显卡信息 | ❌ 影响视频解码 |
| 13 | **Canvas 指纹随机化** | 添加噪点 | ❌ 影响图片/视频处理 |
| 14 | **Plugins 模拟** | 模拟 Chrome 插件 | ⚠️ 可能干扰 DRM |
| 15 | **MimeTypes 模拟** | 模拟 MIME 类型 | ⚠️ 可能干扰下载 |

### Level 4: 环境伪装（高风险）
| # | 措施 | 影响 | 是否建议添加 |
|---|------|------|-------------|
| 16 | **Screen 属性** | 修改分辨率等 | ❌ 影响响应式布局 |
| 17 | **时区修改** | UTC+8 | ⚠️ 影响 CDN、视频地区 |
| 18 | **Chrome 扩展模拟** | chrome.runtime | ✅ 低风险，可添加 |

### Level 5: 高级隐藏（极高风险）
| # | 措施 | 影响 | 是否建议添加 |
|---|------|------|-------------|
| 19 | **自动化变量删除** | 删除 __webdriver_* 等 | ✅ 可添加（全面列表） |
| 20 | **Notification API** | 模拟权限 | ⚠️ 测试后添加 |
| 21 | **Permissions API** | 模拟权限状态 | ⚠️ 测试后添加 |
| 22 | **iframe 注入** | 递归注入反检测 | ❌ 影响性能/稳定性 |
| 23 | **Function.toString 伪装** | 隐藏修改痕迹 | ⚠️ 调试困难 |
| 24 | **Performance API** | 修改时间戳 | ❌ 影响动画/视频同步 |

---

## 三、推荐添加的方案

### 第一批（低风险，建议添加）
```javascript
// 1. Chrome 扩展模拟
window.chrome = {
  runtime: { /* ... */ },
  app: { isInstalled: false }
};

// 2. 更多自动化变量
const automationVars = [
  '__webdriver_script_fn',
  '__selenium_evaluate', 
  '__selenium_unwrapped',
  '__fxdriver_evaluate',
  '_phantom',
  '__phantomas',
  'callPhantom',
  '_selenium',
  'callSelenium',
  '__webdriver__chr',
  'cdc_adoQpoasnfa76pfcZLmcfl_',
  '$cdc_asdjflasutopfhvcZLmcfl_',
  // ... 更多
];
```

### 第二批（测试后添加）
```javascript
// 3. Navigator 属性（需测试视频播放）
navigator.platform = "Win32";
navigator.vendor = "Google Inc.";
navigator.hardwareConcurrency = 8;
navigator.deviceMemory = 8;

// 4. Notification/Permissions API
Notification.permission = "default";
navigator.permissions.query = () => Promise.resolve({state: "prompt"});
```

### 第三批（谨慎添加）
```javascript
// 5. Plugins 模拟（可能影响 DRM）
navigator.plugins = [/* Chrome 默认插件 */];
navigator.mimeTypes = [/* Chrome 默认 MIME */];

// 6. WebGL（仅在不播放视频时）
// 只修改 UNMASKED_VENDOR_WEBGL/RENDERER，其他保持默认
```

---

## 四、被禁用的方案及原因

| 方案 | 禁用原因 | 备注 |
|------|---------|------|
| Canvas 指纹随机化 | 破坏图片处理 | Bilibili 图片不显示 |
| WebGL 详细修改 | 干扰视频解码 | YouTube 无法播放 |
| Screen 属性修改 | 影响响应式布局 | 网站布局错乱 |
| 时区修改 | 影响 CDN 分配 | 视频加载缓慢 |
| iframe 递归注入 | 性能下降、不稳定 | 页面卡顿 |
| Performance API 修改 | 动画/视频不同步 | 播放异常 |

---

## 五、平台差异

### Windows (castLabs Electron)
```javascript
// 可以添加更多反检测，因为 Widevine 内置且支持 VMP
- WebGL 谨慎修改
- Plugins 可以尝试
- Navigator 属性可以全改
```

### Linux (castLabs Electron)
```javascript
// 保持极简，Widevine 有 VMP 限制
- 保持当前方案
- 不添加复杂修改
- 避免进一步影响视频
```

---

## 六、下一步建议

### 选项 A：保持现状（推荐）
- 当前方案通过基础检测
- 不影响视频播放
- 适合日常使用

### 选项 B：添加 Level 2（Navigator 属性）
- 需要测试 YouTube、Bilibili 播放
- 提高反检测等级
- 风险较低

### 选项 C：添加 Chrome 扩展模拟
- 低风险
- 可立即添加
- 提高真实性

### 选项 D：完整版（不推荐）
- 添加所有方案
- 需要大量测试
- 可能影响稳定性

---

**当前状态**: 4/24 项已启用 (16.7%)
**建议下一步**: 添加 Chrome 扩展模拟 + 更多自动化变量删除
