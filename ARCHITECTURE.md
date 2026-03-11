# Siliu Browser - 项目结构说明（解耦优化版）

## 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                         Siliu Browser                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    EventBus (事件总线)                   │   │
│  │              模块间通信中心，完全解耦依赖                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌───────────────────────────┼─────────────────────────────┐   │
│  │                           │                             │   │
│  ▼                           ▼                             ▼   │
│ ┌──────────┐  ┌──────────────┐  ┌────────────┐  ┌──────────┐  │
│ │ Config   │  │ AI Service   │  │   Core     │  │ AdBlock  │  │
│ │ Manager  │  │ Manager      │  │ (Browser)  │  │          │  │
│ └────┬─────┘  └──────┬───────┘  └─────┬──────┘  └────┬─────┘  │
│      │               │                │              │        │
│      │        ┌──────┴──────┐         │              │        │
│      │        │             │         │              │        │
│      │   ┌────┴────┐  ┌────┴────┐   │              │        │
│      │   │OpenClaw │  │ Cloud   │   │              │        │
│      │   │Adapter  │  │ Adapter │   │              │        │
│      │   └────┬────┘  └────┬────┘   │              │        │
│      │        │            │        │              │        │
│      └────────┴────────────┴────────┘              │        │
│                         │                          │        │
│                    ┌────┴────┐                     │        │
│                    │ Copilot │                     │        │
│                    │ (AI助手) │                     │        │
│                    └────┬────┘                     │        │
│                         │                          │        │
│              ┌──────────┴──────────┐              │        │
│              │                     │              │        │
│         ┌────┴────┐          ┌────┴────┐         │        │
│         │ Chat    │          │ Action  │         │        │
│         │ Agent   │          │ Agent   │         │        │
│         └─────────┘          └────┬────┘         │        │
│                                   │              │        │
│                              ┌────┴────┐         │        │
│                              │Controller│◄────────┘        │
│                              │(Browser) │                   │
│                              └─────────┘                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 模块职责

### 1. EventBus (`src/core/event-bus.js`)
- **职责**：模块间通信中心
- **功能**：
  - 发布/订阅事件
  - 一次性事件监听
  - 完全解耦模块依赖
- **关键方法**：`on()`, `once()`, `off()`, `emit()`

### 2. ConfigManager (`src/core/config-manager.js`)
- **职责**：统一配置管理
- **功能**：
  - 加载/保存配置到 `~/.siliu/config.json`
  - 支持路径式配置访问 (`config.get('local.url')`)
  - 配置变更事件通知
  - 默认配置合并
- **配置项**：
  - `serviceType`: 'local' | 'cloud'
  - `local`: OpenClaw 连接配置
  - `cloud`: 云端 AI 配置
  - `ui`: 界面配置
  - `browser`: 浏览器行为配置
  - `copilot`: AI 助手配置

### 3. AIServiceManager (`src/services/ai-service.js`)
- **职责**：AI 服务抽象层
- **功能**：
  - 支持多种 AI 服务（OpenClaw/Cloud）
  - 统一接口：`sendMessage()`, `onMessage()`
  - 自动重连
  - 服务切换
- **适配器**：
  - `OpenClawAdapter`: WebSocket 连接本地 OpenClaw
  - `CloudAIAdapter`: HTTP/WebSocket 连接云端 AI（待实现）

### 4. Core (`src/core/`)
- **职责**：浏览器核心
- **功能**：
  - 窗口管理
  - 标签页管理
  - 视图控制
  - 原生菜单/自定义菜单

### 5. SiliuController (`src/siliu-controller/index.js`)
- **职责**：浏览器控制 API
- **功能**：
  - 人类化操作（随机延迟、模拟打字）
  - 智能元素查找
  - 页面导航
  - 元素交互（点击、悬停、输入）
  - 截图、获取内容
- **配置**：通过 ConfigManager 读取 humanize 配置

### 6. Copilot (`src/copilot/index.js`)
- **职责**：AI 助手
- **功能**：
  - 双角色模式（Chat/Action）
  - 对话 Agent：理解用户意图
  - 动作 Agent：执行浏览器自动化
  - 任务状态管理
- **依赖**：仅通过 AIServiceManager 和 EventBus 通信

### 7. AdBlock (`src/adblock/`)
- **职责**：广告拦截
- **功能**：
  - 基于规则的广告过滤
  - 可开关

## 解耦优化点

### 1. 去除直接依赖
- **之前**：Copilot 直接依赖 `options.openclaw` 和 `options.controller`
- **现在**：Copilot 仅依赖 `AIServiceManager`（接口）和 `EventBus`（事件）

### 2. 统一配置管理
- **之前**：配置分散在各模块
- **现在**：`ConfigManager` 集中管理，支持热更新

### 3. AI 服务抽象
- **之前**：硬编码 OpenClaw WebSocket 连接
- **现在**：`AIServiceManager` + Adapter 模式，支持多种 AI 服务

### 4. 事件驱动通信
- **之前**：模块直接调用其他模块方法
- **现在**：通过 `EventBus` 发布/订阅事件

## 启动流程

```
1. EventBus        - 创建全局事件总线
2. ConfigManager   - 加载配置文件
3. AIServiceManager- 初始化（暂不连接）
4. Core            - 初始化 Electron 核心
5. ContextMenu     - 初始化右键菜单
6. SiliuController - 初始化浏览器控制器
7. Copilot         - 激活 AI 助手
8. 创建主窗口      - 显示界面
9. 连接 AI 服务    - 根据配置连接 OpenClaw/Cloud
10. AdBlock        - 加载广告拦截
11. IPC Handlers   - 设置主进程-渲染进程通信
```

## 配置示例

```json
{
  "version": 1,
  "serviceType": "local",
  "local": {
    "url": "ws://127.0.0.1:18789",
    "token": "your-token",
    "sessionKey": "agent:main:main"
  },
  "cloud": {
    "apiEndpoint": "wss://ai.siliu.io/v1",
    "apiKey": "",
    "model": "kimi-coding/k2p5"
  },
  "browser": {
    "humanize": {
      "enabled": true,
      "minDelay": 300,
      "maxDelay": 800,
      "typeDelay": 50
    }
  },
  "copilot": {
    "maxSteps": 30
  }
}
```

## 新增/修改的文件

### 新增
- `src/core/event-bus.js` - 事件总线
- `src/core/config-manager.js` - 配置管理器
- `src/services/ai-service.js` - AI 服务抽象层

### 重构
- `src/app.js` - 使用新架构的入口文件
- `src/siliu-controller/index.js` - 解耦后的控制器
- `src/copilot/index.js` - 解耦后的 Copilot

## 后续优化建议

1. **状态管理**：考虑引入 Redux/Vuex 风格的状态管理
2. **插件系统**：将 AdBlock、Copilot 改为插件化加载
3. **日志系统**：统一日志格式，支持日志级别配置
4. **错误边界**：添加全局错误处理和恢复机制
5. **测试**：为各模块添加单元测试
