# Siliu Browser 反检测与 AdBlock 方案

## 一、反检测 (Anti-Detection) 方案

### 1.1 核心原则
- **目标**：防止网站检测到 Electron 环境
- **策略**：最小化干预，避免影响正常功能（尤其是视频播放）
- **平台差异**：
  - **Windows**：使用 castLabs Electron（内置 Widevine，支持 DRM 视频）
  - **Linux**：使用 castLabs Electron（Widevine 有 VMP 限制，YouTube 可能受限）

### 1.2 已启用的反检测措施

#### Level 1: 基础（必须）
| 措施 | 状态 | 说明 |
|-----|------|------|
| User-Agent | ✅ | 伪装为 Chrome 121 on Windows |
| navigator.webdriver | ✅ | 删除或设为 undefined |
| window.process/require | ✅ | 删除 Electron 全局变量 |

#### Level 2: 进阶（谨慎使用）
| 措施 | 状态 | 说明 |
|-----|------|------|
| navigator 属性 | ⚠️ | 平台、语言等（可能影响视频地区检测） |
| WebGL 指纹 | ❌ | 已禁用（可能干扰视频解码） |
| Canvas 指纹 | ❌ | 已禁用（可能破坏图片处理） |
| Plugins 模拟 | ❌ | 已禁用（可能干扰 DRM） |

### 1.3 当前实现 (`src/core/fingerprint/index.js`)
```javascript
// 极简版 - 只保留最关键的反检测
- 删除 navigator.webdriver
- 删除 window.process / window.require
- 修改 User-Agent
- 其他属性保持默认（避免视频问题）
```

### 1.4 被禁用的措施（因影响视频）
```javascript
// 以下措施已禁用，因为它们会导致：
// - YouTube 无法播放
// - Bilibili 图片不显示
// - 视频解码异常

❌ Canvas 指纹随机化
❌ WebGL vendor/renderer 修改
❌ Plugins/MimeTypes 模拟
❌ Screen 属性修改
❌ 时区修改（可能影响视频 CDN）
```

---

## 二、AdBlock 方案

### 2.1 核心原则
- **目标**：拦截广告和追踪脚本
- **策略**：不过度拦截，避免影响网站功能
- **白名单机制**：关键网站（如 YouTube）默认放行

### 2.2 当前配置 (`src/adblock/index.js`)

#### 白名单（不拦截）
```javascript
whitelist = []  // 空列表 - 拦截所有广告域名
```

#### 拦截目标
```javascript
adDomains = [
  'doubleclick.net',
  'googleadservices.com',
  'googlesyndication.com',
  'google-analytics.com',
  'facebook.com',
  'amazon-adsystem.com',
  // ... 其他广告域名
]

// 拦截的资源类型
types = ['script', 'image', 'xhr', 'subFrame', 'object', 'media']
```

### 2.3 YouTube 特殊处理
- **广告拦截**: 已从白名单移除，尝试拦截 YouTube 广告
- **⚠️ 警告**: YouTube 广告与视频流混合，拦截可能导致：
  - 视频无法播放
  - 播放中断
  - 需要刷新页面
- **建议**: 如遇到问题，可重新添加到白名单或使用 YouTube Premium

---

## 三、平台差异处理

### 3.1 Windows
```javascript
// 最佳体验
- castLabs Electron v28.0.0+wvcus
- 内置 Widevine（支持 DRM）
- VMP 验证通过（YouTube 正常）
- 反检测 + AdBlock 全开
```

### 3.2 Linux
```javascript
// 有限支持
- castLabs Electron（Widevine 有 VMP 限制）
- YouTube 可能提示 "视频不可用" 或只能播放 720p
- 建议：使用网页版 YouTube 或 mpv+youtube-dl
- 其他网站（Bilibili）通常正常
```

### 3.3 macOS
```javascript
// 未测试
- 理论上支持 castLabs Electron
- 需要单独测试 Widevine 兼容性
```

---

## 四、视频播放问题排查

### 4.1 如果 YouTube 无法播放
1. 检查是否为 **castLabs Electron**（看版本号是否含 +wvcus）
2. 检查 AdBlock 白名单是否包含 youtube.com
3. 尝试禁用反检测脚本测试
4. Linux 用户：接受限制或使用其他方案

### 4.2 如果 Bilibili 图片不显示
1. 检查 Canvas 修改是否已禁用
2. 检查 WebGL 修改是否已禁用
3. 检查请求头 Sec-Fetch-* 是否正确

### 4.3 通用排查步骤
```bash
# 1. 检查 Electron 版本
cat node_modules/electron/dist/version
# 应显示：v28.0.0+wvcus（castLabs）

# 2. 检查 Widevine
electron --widevine-cdm-path

# 3. 测试时禁用 AdBlock
# 在 app.js 中注释掉 AdBlock 初始化

# 4. 测试时禁用反检测
# 在 tab-manager.js 中设置 enabled: false
```

---

## 五、配置文件速查

### 5.1 反检测开关
**文件**: `src/core/tab-manager.js`
```javascript
this.fingerprintManager = new FingerprintManager({
  enabled: true,  // true = 启用, false = 禁用
  profile: 'chrome'
});
```

### 5.2 AdBlock 开关
**文件**: `src/app.js`
```javascript
modules.adblock = new AdBlockExtension({
  core: modules.core,
  windowManager: modules.core.windowManager,
  enabled: true  // true = 启用, false = 禁用
});
```

### 5.3 AdBlock 白名单
**文件**: `src/adblock/index.js`
```javascript
this.whitelist = new Set([
  'youtube.com',
  'www.youtube.com',
  // 添加其他需要放行的域名
]);
```

---

## 六、总结

| 功能 | 状态 | 备注 |
|-----|------|------|
| 基础反检测 | ✅ | User-Agent + webdriver |
| 高级反检测 | ❌ | 已禁用（影响视频） |
| AdBlock | ✅ | 含 YouTube 白名单 |
| Widevine (Win) | ✅ | castLabs 内置 |
| Widevine (Linux) | ⚠️ | VMP 限制 |
| YouTube (Win) | ✅ | 应可正常播放 |
| YouTube (Linux) | ❌ | 可能受限 |
| Bilibili | ✅ | 正常 |

**建议**：
- Windows 用户：正常使用，YouTube 应该OK
- Linux 用户：主要用 Bilibili，YouTube 可用 mpv 替代
