# Widevine DRM 支持方案

## 问题
标准 Electron 不包含 Widevine DRM 组件，导致：
- YouTube 直播无法播放
- Netflix/Disney+/HBO 等流媒体无法播放
- 加密视频内容无法解码

## 解决方案

### 方案 1：使用 castLabs Electron（推荐）

castLabs 提供了包含 Widevine 的 Electron 构建版本。

1. 修改 package.json：
```json
{
  "devDependencies": {
    "@castlabs/electron-releases": "^28.0.0+wvcus",
    "electron-builder": "^24.9.1"
  }
}
```

2. 添加 electron-builder 配置：
```json
{
  "build": {
    "electronDist": "node_modules/@castlabs/electron-releases/dist",
    "electronDownload": {
      "mirror": "https://github.com/castlabs/electron-releases/releases/download/v"
    }
  }
}
```

3. 安装依赖：
```bash
npm install @castlabs/electron-releases@^28.0.0+wvcus --save-dev
npm uninstall electron
```

4. 修改启动脚本：
```json
{
  "scripts": {
    "start": "electron . --no-sandbox"
  }
}
```

### 方案 2：使用 widevinecdm 插件（Linux 较复杂）

从 Chrome 提取 Widevine CDM 组件：

1. 找到 Chrome 的 WidevineCdm 目录：
```bash
# Ubuntu/Debian
find /opt/google/chrome -name "WidevineCdm*" -type d

# 通常位于：
# /opt/google/chrome/WidevineCdm/_platform_specific/linux_x64/
```

2. 复制到项目目录：
```bash
mkdir -p widevine/
cp /opt/google/chrome/WidevineCdm/_platform_specific/linux_x64/libwidevinecdm.so widevine/
```

3. 修改 app.js 指定 Widevine 路径：
```javascript
app.commandLine.appendSwitch('widevine-cdm-path', path.join(__dirname, '../widevine/libwidevinecdm.so'));
app.commandLine.appendSwitch('widevine-cdm-version', '4.10.2710.0'); // 根据实际版本修改
```

4. 在 electron-builder 中配置额外资源：
```json
{
  "build": {
    "extraResources": [
      {
        "from": "widevine/",
        "to": "widevine/"
      }
    ]
  }
}
```

### 方案 3：降级功能（临时方案）

如果不使用流媒体，可以修改代码检测视频播放失败时显示提示：

```javascript
// 在 view-preload.js 中添加
window.addEventListener('error', (e) => {
  if (e.message?.includes('DRM') || e.message?.includes('widevine')) {
    console.warn('[Siliu] DRM content may not be supported in this build');
  }
});
```

## 推荐做法

对于 Siliu Browser，建议使用 **方案 1**（castLabs Electron）：

1. 支持所有主流流媒体
2. 自动处理 DRM 更新
3. 跨平台一致体验

## 注意事项

- castLabs Electron 版本号格式：`28.0.0+wvcus`（wvcus = Widevine CDM for US）
- 不同地区可能需要不同版本（wvcus/wvcee/wvcr2 等）
- 构建时需要联网下载 Widevine 组件

## 参考

- castLabs Electron: https://github.com/castlabs/electron-releases
- Electron Widevine 文档: https://www.electronjs.org/docs/latest/tutorial/widevine-cdm
