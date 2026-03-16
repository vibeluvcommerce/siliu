# Siliu Browser Agent 编辑器设计文档

> 详细描述可视化 Agent 编辑器的功能设计、界面原型和实现方案

---

## 一、需求分析

### 1.1 用户痛点

| 痛点 | 当前方案 | 期望方案 |
|------|----------|----------|
| 不知道坐标怎么获取 | 手动测量屏幕 | 点击自动获取 |
| YAML 语法错误 | 报错后反复修改 | 表单验证 |
| 不知道配置是否正确 | 保存后测试 | 实时预览验证 |
| 多个坐标管理混乱 | 纯文本编辑 | 可视化列表管理 |

### 1.2 功能需求分层

```
MVP (Must Have)
├── 表单输入（网站信息、坐标、描述）
├── YAML 生成和保存
└── 基础验证

Phase 2 (Should Have)
├── 网站预览
├── 点击获取坐标
├── 坐标列表管理
└── 测试验证

Phase 3 (Nice to Have)
├── 操作流程录制
├── AI 辅助生成
├── 实时协作
└── 版本管理
```

---

## 二、界面设计

### 2.1 整体布局

```
┌──────────────────────────────────────────────────────────────────────────┐
│  🎯 Agent 编辑器                                            [保存] [关闭] │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────┐  ┌────────────────────────────┐ │
│  │                                     │  │  配置面板                    │ │
│  │                                     │  ├────────────────────────────┤ │
│  │      网站预览区域                    │  │                            │ │
│  │      （加载目标网站）                 │  │  📋 基本信息                 │ │
│  │                                     │  │  ─────────────────────────  │ │
│  │   💡 提示：点击页面元素进行标注       │  │  网站名称： [__________]   │ │
│  │                                     │  │  网站域名： [__________]   │ │
│  │   ● (0.52, 0.06) 搜索框            │  │                            │ │
│  │   ● (0.61, 0.06) 搜索按钮          │  │  📍 坐标列表                 │ │
│  │   ○ (0.92, 0.06) 头像              │  │  ─────────────────────────  │ │
│  │                                     │  │  ┌──────────────────────┐  │ │
│  │                                     │  │  │ 搜索框              ● │  │ │
│  │                                     │  │  │ (0.52, 0.06)         │  │ │
│  │                                     │  │  │ [编辑] [删除] [测试] │  │ │
│  │                                     │  │  └──────────────────────┘  │ │
│  │                                     │  │  ┌──────────────────────┐  │ │
│  │                                     │  │  │ 搜索按钮            ● │  │ │
│  │                                     │  │  │ (0.61, 0.06)         │  │ │
│  │                                     │  │  │ [编辑] [删除] [测试] │  │ │
│  │                                     │  │  └──────────────────────┘  │ │
│  │                                     │  │                            │ │
│  │                                     │  │  [+ 添加坐标]               │ │
│  │                                     │  │                            │ │
│  │                                     │  │  🧠 知识库                   │ │
│  │                                     │  │  ─────────────────────────  │ │
│  │                                     │  │  页面结构： [多行文本]     │ │
│  │                                     │  │  操作流程： [多行文本]     │ │
│  │                                     │  │                            │ │
│  └─────────────────────────────────────┘  └────────────────────────────┘ │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 交互流程

```
用户打开编辑器
    ↓
输入网站 URL
    ↓
点击"加载预览" → 打开 BrowserView 加载网站
    ↓
用户点击页面元素
    ↓
显示坐标标注弹窗（输入名称、描述、操作类型）
    ↓
保存到坐标列表
    ↓
填写知识库信息（页面结构、操作流程）
    ↓
点击"保存 Agent"
    ↓
生成 YAML → 保存到 ~/.siliu/workspace/agents/
    ↓
自动加载生效
```

---

## 三、组件设计

### 3.1 坐标标注器（核心组件）

**功能：** 在目标网站上叠加交互层，捕获用户点击坐标

```javascript
// src/core/agent-editor/annotator.js

class CoordinateAnnotator {
  constructor(webContents) {
    this.webContents = webContents;
    this.annotations = [];
  }

  /**
   * 注入标注层到目标页面
   */
  async injectOverlay() {
    const script = `
      (function() {
        // 防止重复注入
        if (document.getElementById('siliu-annotator')) return;
        
        // 创建标注层
        const overlay = document.createElement('div');
        overlay.id = 'siliu-annotator';
        overlay.style.cssText = \`
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 999999;
          cursor: crosshair;
          pointer-events: auto;
        \`;
        
        // 点击事件处理
        overlay.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          
          // 计算相对坐标
          const relX = (e.clientX / window.innerWidth).toFixed(4);
          const relY = (e.clientY / window.innerHeight).toFixed(4);
          
          // 创建标记点
          const marker = document.createElement('div');
          marker.className = 'siliu-marker';
          marker.style.cssText = \`
            position: fixed;
            left: \${e.clientX - 8}px;
            top: \${e.clientY - 8}px;
            width: 16px;
            height: 16px;
            border: 3px solid #4CAF50;
            border-radius: 50%;
            background: rgba(76, 175, 80, 0.3);
            z-index: 999998;
            pointer-events: none;
            animation: siliu-pulse 1s infinite;
          \`;
          document.body.appendChild(marker);
          
          // 发送数据到主进程
          window.postMessage({
            type: 'SILIU_COORDINATE_SELECTED',
            data: {
              x: parseFloat(relX),
              y: parseFloat(relY),
              absoluteX: e.clientX,
              absoluteY: e.clientY,
              viewport: {
                width: window.innerWidth,
                height: window.innerHeight
              },
              element: {
                tag: e.target.tagName,
                text: e.target.innerText?.substring(0, 50),
                id: e.target.id,
                class: e.target.className
              }
            }
          }, '*');
        });
        
        // 添加动画样式
        const style = document.createElement('style');
        style.textContent = \`
          @keyframes siliu-pulse {
            0% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.2); opacity: 0.7; }
            100% { transform: scale(1); opacity: 1; }
          }
          .siliu-marker:hover::after {
            content: attr(data-name);
            position: absolute;
            top: -30px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            white-space: nowrap;
          }
        \`;
        document.head.appendChild(style);
        
        document.body.appendChild(overlay);
        console.log('[Siliu] Annotator overlay injected');
      })();
    `;
    
    await this.webContents.executeJavaScript(script);
  }

  /**
   * 更新标记点名称
   */
  async updateMarkerName(index, name) {
    const script = \`
      const markers = document.querySelectorAll('.siliu-marker');
      if (markers[\${index}]) {
        markers[\${index}].setAttribute('data-name', '\${name}');
      }
    \`;
    await this.webContents.executeJavaScript(script);
  }

  /**
   * 移除所有标注
   */
  async clearAll() {
    const script = \`
      document.getElementById('siliu-annotator')?.remove();
      document.querySelectorAll('.siliu-marker').forEach(m => m.remove());
    \`;
    await this.webContents.executeJavaScript(script);
    this.annotations = [];
  }
}

module.exports = { CoordinateAnnotator };
```

### 3.2 Agent 编辑器窗口

**文件：** `src/core/agent-editor/editor-window.js`

```javascript
/**
 * AgentEditorWindow - 可视化 Agent 编辑器窗口管理
 */

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { CoordinateAnnotator } = require('./annotator');

class AgentEditorWindow {
  constructor(parentWindow) {
    this.parentWindow = parentWindow;
    this.editorWindow = null;
    this.previewView = null;
    this.annotator = null;
    this.currentConfig = {
      metadata: {},
      coordinates: [],
      knowledge: {}
    };
  }

  /**
   * 打开编辑器窗口
   */
  async open() {
    this.editorWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      parent: this.parentWindow,
      modal: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../../preload/agent-editor-preload.js')
      }
    });

    // 加载编辑器界面
    await this.editorWindow.loadFile(
      path.join(__dirname, '../../../public/agent-editor.html')
    );

    // 设置 IPC 处理
    this._setupIPC();
  }

  /**
   * 加载预览网站
   */
  async loadPreview(url) {
    if (!this.previewView) {
      // 创建 BrowserView 用于预览
      this.previewView = new BrowserView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });
      
      this.editorWindow.setBrowserView(this.previewView);
      this.previewView.setBounds({
        x: 20,
        y: 80,
        width: 900,
        height: 750
      });
    }

    await this.previewView.webContents.loadURL(url);
    
    // 等待页面加载完成后注入标注器
    this.previewView.webContents.on('dom-ready', () => {
      this.annotator = new CoordinateAnnotator(this.previewView.webContents);
      this.annotator.injectOverlay();
    });
  }

  /**
   * 设置 IPC 通信
   */
  _setupIPC() {
    // 监听坐标选择事件
    ipcMain.handle('agent-editor:load-preview', async (event, url) => {
      await this.loadPreview(url);
      return { success: true };
    });

    // 监听坐标选择（从 preload 转发）
    ipcMain.on('agent-editor:coordinate-selected', (event, data) => {
      this.currentConfig.coordinates.push(data);
      // 通知渲染进程更新列表
      this.editorWindow.webContents.send('agent-editor:update-coordinates', 
        this.currentConfig.coordinates
      );
    });

    // 保存 Agent
    ipcMain.handle('agent-editor:save', async (event, config) => {
      const { DynamicAgentLoader } = require('../../copilot/agents/dynamic-agent-loader');
      const { getWorkspaceManager } = require('../workspace-manager');
      
      const loader = new DynamicAgentLoader(getWorkspaceManager());
      return await loader.saveAgent(config);
    });
  }
}

module.exports = { AgentEditorWindow };
```

### 3.3 编辑器界面 HTML

**文件：** `public/agent-editor.html`（简化版）

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Agent 编辑器 - Siliu Browser</title>
  <link rel="stylesheet" href="fonts/inter.css">
  <link rel="stylesheet" href="fonts/phosphor.css">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', system-ui, sans-serif;
      background: #1a1a2e;
      color: #eee;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    
    /* 顶部工具栏 */
    .toolbar {
      height: 60px;
      background: #16213e;
      display: flex;
      align-items: center;
      padding: 0 20px;
      gap: 15px;
      border-bottom: 1px solid #2a2a4a;
    }
    .toolbar h1 { font-size: 18px; font-weight: 600; }
    .toolbar input {
      flex: 1;
      max-width: 400px;
      padding: 8px 12px;
      border: 1px solid #3a3a5a;
      background: #0f0f23;
      color: #fff;
      border-radius: 6px;
    }
    .toolbar button {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
    }
    .btn-primary { background: #4CAF50; color: white; }
    .btn-secondary { background: #3a3a5a; color: #fff; }
    
    /* 主内容区 */
    .main {
      flex: 1;
      display: flex;
      overflow: hidden;
    }
    
    /* 左侧面板（预览区域） */
    .preview-panel {
      flex: 1;
      padding: 20px;
      display: flex;
      flex-direction: column;
    }
    .preview-placeholder {
      flex: 1;
      border: 2px dashed #3a3a5a;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #888;
    }
    
    /* 右侧面板（配置区域） */
    .config-panel {
      width: 420px;
      background: #16213e;
      border-left: 1px solid #2a2a4a;
      padding: 20px;
      overflow-y: auto;
    }
    
    .section {
      margin-bottom: 24px;
    }
    .section h3 {
      font-size: 14px;
      text-transform: uppercase;
      color: #888;
      margin-bottom: 12px;
      letter-spacing: 0.5px;
    }
    
    .form-group {
      margin-bottom: 16px;
    }
    .form-group label {
      display: block;
      font-size: 13px;
      color: #aaa;
      margin-bottom: 6px;
    }
    .form-group input,
    .form-group textarea {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #3a3a5a;
      background: #0f0f23;
      color: #fff;
      border-radius: 6px;
      font-size: 14px;
    }
    .form-group textarea {
      min-height: 80px;
      resize: vertical;
    }
    
    /* 坐标列表 */
    .coordinate-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .coordinate-item {
      background: #0f0f23;
      border: 1px solid #3a3a5a;
      border-radius: 8px;
      padding: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .coordinate-info h4 {
      font-size: 14px;
      margin-bottom: 4px;
    }
    .coordinate-info span {
      font-size: 12px;
      color: #888;
    }
    .coordinate-actions {
      display: flex;
      gap: 8px;
    }
    .coordinate-actions button {
      padding: 4px 8px;
      font-size: 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      background: #3a3a5a;
      color: #fff;
    }
    .coordinate-actions button:hover {
      background: #4a4a6a;
    }
    
    .add-btn {
      width: 100%;
      padding: 12px;
      border: 2px dashed #4CAF50;
      background: transparent;
      color: #4CAF50;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 500;
    }
    .add-btn:hover {
      background: rgba(76, 175, 80, 0.1);
    }
  </style>
</head>
<body>
  <!-- 工具栏 -->
  <div class="toolbar">
    <h1>🎯 Agent 编辑器</h1>
    <input type="text" id="url-input" placeholder="输入网站 URL，如：https://www.bilibili.com">
    <button class="btn-secondary" onclick="loadPreview()">加载预览</button>
    <div style="flex:1"></div>
    <button class="btn-secondary" onclick="window.close()">关闭</button>
    <button class="btn-primary" onclick="saveAgent()">保存 Agent</button>
  </div>
  
  <!-- 主内容 -->
  <div class="main">
    <!-- 预览面板 -->
    <div class="preview-panel">
      <div class="preview-placeholder" id="preview-area">
        <div>
          <i class="ph ph-globe" style="font-size: 48px; opacity: 0.3;"></i>
          <p style="margin-top: 10px;">输入 URL 加载网站预览</p>
        </div>
      </div>
    </div>
    
    <!-- 配置面板 -->
    <div class="config-panel">
      <!-- 基本信息 -->
      <div class="section">
        <h3>📋 基本信息</h3>
        <div class="form-group">
          <label>Agent 名称</label>
          <input type="text" id="agent-name" placeholder="如：我的B站助手">
        </div>
        <div class="form-group">
          <label>网站域名</label>
          <input type="text" id="agent-domain" placeholder="如：bilibili.com">
        </div>
      </div>
      
      <!-- 坐标列表 -->
      <div class="section">
        <h3>📍 坐标列表</h3>
        <div class="coordinate-list" id="coordinate-list">
          <!-- 动态生成 -->
        </div>
        <button class="add-btn" onclick="startAnnotating()">
          <i class="ph ph-plus"></i> 添加坐标（点击页面元素）
        </button>
      </div>
      
      <!-- 知识库 -->
      <div class="section">
        <h3>🧠 知识库</h3>
        <div class="form-group">
          <label>页面结构说明</label>
          <textarea id="page-structure" placeholder="描述页面布局，帮助AI理解..."></textarea>
        </div>
        <div class="form-group">
          <label>常见操作流程</label>
          <textarea id="workflows" placeholder="描述常见操作步骤..."></textarea>
        </div>
      </div>
    </div>
  </div>
  
  <script>
    let coordinates = [];
    
    // 加载预览
    async function loadPreview() {
      const url = document.getElementById('url-input').value;
      if (!url) return alert('请输入 URL');
      
      const result = await window.siliuAPI.agentEditor.loadPreview(url);
      if (result.success) {
        document.getElementById('preview-area').style.display = 'none';
      }
    }
    
    // 添加坐标（从主进程接收）
    window.siliuAPI.agentEditor.onCoordinateSelected((data) => {
      const name = prompt('为此坐标命名：', data.element.text || '未命名');
      if (!name) return;
      
      const description = prompt('功能描述：', `点击${name}`);
      const action = prompt('操作类型（click/type/hover）：', 'click');
      
      coordinates.push({
        name,
        description,
        action,
        x: data.x,
        y: data.y
      });
      
      renderCoordinateList();
    });
    
    // 渲染坐标列表
    function renderCoordinateList() {
      const list = document.getElementById('coordinate-list');
      list.innerHTML = coordinates.map((coord, index) => \`
        <div class="coordinate-item">
          <div class="coordinate-info">
            <h4>\${coord.name}</h4>
            <span>(\${coord.x}, \${coord.y}) - \${coord.action}</span>
          </div>
          <div class="coordinate-actions">
            <button onclick="testCoordinate(\${index})">测试</button>
            <button onclick="deleteCoordinate(\${index})">删除</button>
          </div>
        </div>
      \`).join('');
    }
    
    // 删除坐标
    function deleteCoordinate(index) {
      coordinates.splice(index, 1);
      renderCoordinateList();
    }
    
    // 保存 Agent
    async function saveAgent() {
      const config = {
        apiVersion: 'siliu.io/v1',
        kind: 'Agent',
        metadata: {
          id: document.getElementById('agent-name').value.toLowerCase().replace(/\\s+/g, '-'),
          name: document.getElementById('agent-name').value,
          icon: 'globe',
          color: '#1A73E8',
          description: \`自定义 \${document.getElementById('agent-name').value} Agent\`
        },
        coordinates: coordinates.reduce((acc, c) => {
          acc[c.name] = { x: c.x, y: c.y, description: c.description, action: c.action };
          return acc;
        }, {}),
        knowledge: {
          pageStructure: document.getElementById('page-structure').value
        },
        validation: {
          urlPattern: document.getElementById('agent-domain').value.replace(/\\./g, '\\\\.')
        }
      };
      
      const result = await window.siliuAPI.agentEditor.save(config);
      if (result.success) {
        alert('Agent 保存成功！');
        window.close();
      }
    }
  </script>
</body>
</html>
```

---

## 四、实施阶段

### Phase 1: 基础表单版（Week 1-2）

**功能：**
- 表单输入（网站信息、坐标 JSON、知识库）
- 生成 YAML 并保存
- 基础验证

**优点：**
- 开发快（2-3 天）
- 立即可用
- 技术门槛低

### Phase 2: 可视化标注版（Week 3-4）

**功能：**
- 网站预览窗口
- 点击获取坐标
- 实时标记显示
- 坐标列表管理

### Phase 3: 高级功能版（Week 5+）

**功能：**
- 坐标测试验证
- AI 辅助生成
- 导入/导出
- 版本历史

---

*文档基于详细设计讨论整理*
*创建时间：2026-03-16*
