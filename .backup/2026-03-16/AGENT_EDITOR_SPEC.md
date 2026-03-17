# Agent 编辑器开发文档

## 1. 核心概念

### 1.1 Agent 定义
- **一个 Agent = 一个 YAML 文件**
- YAML 可包含**多网站、多页面、多坐标**
- 示例：`shopping-agent.yaml` 同时支持淘宝、京东、拼多多

### 1.2 与现有系统关系
- **当前选中 Agent**：Agent 栏高亮显示的 Agent
- **执行时**：Copilot 使用当前选中 Agent 的 YAML 配置
- **无多 Agent 冲突**：同一时间只用一个 Agent 的坐标库

---

## 2. UI 布局设计

### 2.1 左下角 Agent 区域（核心入口）

```
┌─────────────────────────────────────────┐
│                                         │
│           浏览器内容区域                  │
│                                         │
├─────────────────────────────────────────┤
│  🛒 购物助手                    [▼]    │  ← Agent 选择下拉
└─────────────────────────────────────────┘

下拉菜单内容：
├─ 📝 编辑当前 Agent          ← 进入编辑模式
├─ ➕ 创建新 Agent...         ← 新建流程入口
├─ 📂 管理所有 Agents
├─ ─────────────────
├─ 🤖 购物助手          (当前)
├─ 📺 B站下载助手
└─ 🔍 网页搜索助手
```

### 2.2 编辑模式面板（覆盖式）

```
┌─────────────────────────────────────────────────────────┐
│  📝 编辑 Agent: 购物助手                    [×] 关闭   │
├─────────────────────────────────────────────────────────┤
│  基础信息: 购物助手  |  ID: shopping-agent  |  🛒      │
├────────────────┬────────────────────────────────────────┤
│                │                                        │
│  📁 网站列表    │         📷 页面预览区域               │
│                │                                        │
│  🛒 淘宝        │     ┌───────────────────────────┐     │
│  ├─ 🏠 首页 (2) │     │                           │     │
│  ├─ 🔍 搜索 (3) │     │     🔴 搜索框              │     │
│  └─ 📦 详情 (2) │     │     🔵 购买按钮            │     │
│      [当前]     │     │                           │     │
│  ─────────────  │     │   [开始标注] [测试坐标]    │     │
│  🐕 京东 (1页)  │     │                           │     │
│  📺 B站 (0页)   │     └───────────────────────────┘     │
│  ─────────────  │                                        │
│  [➕ 添加网站]  │  当前页面: taobao.com /item.htm       │
│                │  状态: 2 个坐标已保存                  │
├────────────────┴────────────────────────────────────────┤
│  [保存 Agent]  [导出 YAML]  [取消]                      │
└─────────────────────────────────────────────────────────┘
```

### 2.3 实时标注状态条（蒙版激活时显示）

```
┌─────────────────────────────────────────────────────────┐
│  🔴 标注中 - 淘宝 详情页  |  本页: 2 个坐标              │
│  [⏸ 暂停标注] [✓ 完成本页] [💾 保存并退出]              │
└─────────────────────────────────────────────────────────┘
        ↑ 显示在页面底部，不遮挡主要内容
```

---

## 3. 交互流程

### 3.1 创建新 Agent

```
1. 点击左下角 Agent 选择器 [▼]
2. 选择 "➕ 创建新 Agent..."
3. 弹出基础信息对话框：
   ┌─────────────────────────────────────┐
   │  创建新 Agent                        │
   │                                     │
   │  名称: [购物助手            ]       │
   │  ID:   [shopping-agent      ]       │  ← 自动生成，可修改
   │  图标: [🛒  选择...]                │
   │  颜色: [███ #FF6B00]                │
   │                                     │
   │  [取消]  [创建并标注]               │
   └─────────────────────────────────────┘
4. 点击 "创建并标注" → 进入编辑模式
5. 用户可立即开始标注当前页面
```

### 3.2 渐进式跨页面标注流程（核心）

```
【开始标注】
     ↓
┌─────────────────────────────────────────────────────────┐
│ 当前页面: taobao.com (首页)                              │
│ 状态: 标注中（蒙版激活，cursor: crosshair）              │
│                                                          │
│ 用户操作:                                                │
│ 1. 点击搜索框位置 → 弹窗输入 "search_box"               │
│ 2. 点击搜索按钮 → 弹窗输入 "search_btn"                 │
│ 3. ...继续标注其他元素                                   │
│                                                          │
│ 底部状态条: [⏸ 暂停标注] [✓ 完成本页]                  │
└─────────────────────────────────────────────────────────┘
     ↓ 点击 "⏸ 暂停标注" 或 "✓ 完成本页"
┌─────────────────────────────────────────────────────────┐
│ 当前页面: taobao.com (首页)                              │
│ 状态: 暂停（蒙版移除，页面可正常操作）                   │
│                                                          │
│ 用户操作:                                                │
│ 1. 正常点击搜索框                                       │
│ 2. 输入商品名称                                         │
│ 3. 点击搜索 → 跳转到搜索结果页                          │
│ 4. 点击商品 → 跳转到详情页                              │
│                                                          │
│ 底部状态条: [▶ 继续标注] [➡️ 下一页] [💾 保存退出]       │
│              ↑ 在新页面继续标注                         │
└─────────────────────────────────────────────────────────┘
     ↓ 导航到新页面后点击 "▶ 继续标注"
┌─────────────────────────────────────────────────────────┐
│ 当前页面: taobao.com (详情页)                            │
│ 状态: 标注中（蒙版激活）                                 │
│ 自动识别为新页面类型，独立保存坐标                       │
│                                                          │
│ 用户操作:                                                │
│ 1. 点击购买按钮 → 弹窗输入 "buy_now"                    │
│ 2. 点击价格区域 → 弹窗输入 "price"                      │
│                                                          │
│ 底部状态条: [⏸ 暂停标注] [✓ 完成本页] [💾 保存Agent]    │
└─────────────────────────────────────────────────────────┘
     ↓ 全部页面标注完成，点击 "💾 保存Agent"
生成 YAML 文件，退出编辑模式
```

### 3.3 编辑已有 Agent

```
1. 点击左下角 Agent 选择器 [▼]
2. 选择 "📝 编辑当前 Agent"
3. 打开编辑面板，显示：
   - 左侧：网站/页面树（已标注的结构）
   - 右侧：当前选中页面的预览
4. 用户可：
   - 点击已有页面 → 查看/调整标记点
   - 点击 "▶ 标注新页面" → 进入实时标注模式
   - 拖拽标记点微调位置
   - 双击删除标记点
5. 完成后点击 "保存 Agent"
```

---

## 4. YAML 结构规范

```yaml
metadata:
  id: "shopping-agent"
  name: "购物助手"
  description: "支持多平台购物"
  icon: "shopping-cart"
  color: "#FF6B00"
  createdAt: "2024-01-15T10:30:00Z"
  updatedAt: "2024-01-15T11:45:00Z"
  version: "1.0.0"

sites:
  taobao:
    domain: "taobao.com"
    pages:
      home:
        path: "^/$"
        description: "淘宝首页，有搜索功能"
        lastAnnotatedAt: "2024-01-15T10:35:00Z"
        screenshot: "base64..."
        coordinates:
          search_box:
            x: 0.35
            y: 0.08
            action: "click"
            elementSnapshot: "base64..."
            createdAt: "2024-01-15T10:30:00Z"
          search_btn:
            x: 0.62
            y: 0.08
            action: "click"
      
      detail:
        path: "/item.htm"
        description: "商品详情页"
        lastAnnotatedAt: "2024-01-15T10:45:00Z"
        screenshot: "base64..."
        coordinates:
          buy_now:
            x: 0.8
            y: 0.6
            action: "click"
          price:
            x: 0.65
            y: 0.45
            action: "extract"
            extractType: "text"
  
  jd:
    domain: "jd.com"
    pages:
      home:
        path: "^/$"
        coordinates:
          search_box:
            x: 0.4
            y: 0.08
            action: "click"
```

---

## 5. 状态管理

### 5.1 标注会话状态（内存中）

```typescript
interface AnnotationSession {
  // 基础信息
  agentId: string;
  agentName: string;
  isNewAgent: boolean;
  
  // 标注状态
  isAnnotating: boolean;      // 当前是否处于蒙版标注模式
  currentSite: string;        // 当前识别到的网站 key
  currentPage: string;        // 当前识别到的页面 key
  currentUrl: string;         // 当前 URL
  
  // 累积数据（跨页面保存）
  sites: {
    [siteKey: string]: {
      domain: string;
      pages: {
        [pageKey: string]: {
          path: string;
          description?: string;
          screenshot?: string;     // 页面截图
          coordinates: {
            [coordName: string]: CoordinateData;
          };
          lastAnnotatedAt: string;
        };
      };
    };
  };
  
  // 未保存的变更标记
  hasUnsavedChanges: boolean;
}

interface CoordinateData {
  x: number;
  y: number;
  action: 'click' | 'type' | 'hover' | 'extract';
  description?: string;
  elementSnapshot?: string;    // 元素截图
  selector?: string;           // CSS 选择器
  createdAt: string;
}
```

### 5.2 状态流转

```
【空闲】
  ↓ 点击"创建新Agent" 或 "编辑当前Agent"
【编辑面板打开】
  ↓ 点击"开始标注"
【标注中 (蒙版激活)】 ←──────────┐
  ↓ 点击"暂停标注"/"完成本页"      │
【暂停 (蒙版移除)】               │
  ↓ 用户自由跳转页面              │
【暂停 (新页面)】                 │
  ↓ 点击"继续标注" ──────────────┘
  ↓ 点击"保存Agent"
【保存 YAML】→ 【退出编辑模式】
```

---

## 6. 核心功能实现

### 6.1 蒙版注入与移除

```javascript
// IPC: annotation:start (开始标注)
// 注入蒙版，进入标注模式
const overlayScript = `
  (function() {
    if (document.getElementById('__siliu_anno__')) return;
    
    const overlay = document.createElement('div');
    overlay.id = '__siliu_anno__';
    overlay.style.cssText = 
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'z-index:2147483647;cursor:crosshair;background:transparent;';
    
    // 点击处理
    overlay.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const data = {
        type: 'SILIU_ANNOTATION_CLICK',
        x: e.clientX / window.innerWidth,
        y: e.clientY / window.innerHeight,
        element: e.target.tagName,
        url: location.href
      };
      
      window.postMessage(data, '*');
    });
    
    document.body.appendChild(overlay);
  })()
`;

// IPC: annotation:pause (暂停标注)
// 移除蒙版，但保留会话状态
const pauseScript = `
  (function() {
    const overlay = document.getElementById('__siliu_anno__');
    if (overlay) {
      overlay.remove();
    }
  })()
`;

// IPC: annotation:resume (继续标注)
// 重新注入蒙版，恢复标注模式（在新页面）
// 同 annotation:start
```

### 6.2 自动识别 Site/Page

```javascript
function identifySiteAndPage(url, existingSites) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace(/^www\./, '');
    const pathname = urlObj.pathname;
    
    // 查找匹配的 site
    let siteKey = null;
    for (const [key, site] of Object.entries(existingSites)) {
      if (hostname.includes(site.domain)) {
        siteKey = key;
        break;
      }
    }
    
    // 如果没找到，生成新 site key
    if (!siteKey) {
      siteKey = hostname.split('.')[0]; // "taobao.com" → "taobao"
    }
    
    // 查找匹配的 page
    let pageKey = 'unknown';
    const pages = existingSites[siteKey]?.pages || {};
    
    for (const [key, page] of Object.entries(pages)) {
      if (page.path && new RegExp(page.path).test(pathname)) {
        pageKey = key;
        break;
      }
    }
    
    return { siteKey, pageKey, isNewSite: !existingSites[siteKey] };
  } catch (e) {
    return { siteKey: 'unknown', pageKey: 'unknown', isNewSite: true };
  }
}
```

### 6.3 坐标命名建议

```javascript
async function suggestCoordinateName(elementInfo, aiService) {
  const suggestions = {
    'INPUT': ['search_box', 'username', 'password', 'email'],
    'BUTTON': ['submit', 'search_btn', 'buy_now', 'add_cart'],
    'A': ['link', 'nav_home', 'nav_profile'],
    'IMG': ['product_img', 'banner', 'avatar']
  };
  
  // 基础建议
  const baseSuggestions = suggestions[elementInfo.tag] || ['element'];
  
  // AI 增强建议（如果有 AI 服务）
  if (aiService) {
    const aiSuggestion = await aiService.suggestName(elementInfo);
    return [aiSuggestion, ...baseSuggestions];
  }
  
  return baseSuggestions;
}
```

---

## 7. 页面结构变化处理

### 7.1 坐标验证

```javascript
// 用户点击标记点的"测试"按钮
async function testCoordinate(coord, view) {
  // 1. 检查元素是否存在（通过 selector）
  const elementExists = await view.webContents.executeJavaScript(`
    !!document.querySelector('${coord.selector}')
  `);
  
  if (!elementExists) {
    return { valid: false, reason: '元素不存在，可能页面已改版' };
  }
  
  // 2. 执行点击测试
  await view.webContents.executeJavaScript(`
    const el = document.querySelector('${coord.selector}');
    if (el) {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      el.click();
      return { clicked: true, position: {x, y} };
    }
    return { clicked: false };
  `);
  
  return { valid: true };
}
```

### 7.2 截图比对（高级）

```javascript
async function validateWithScreenshot(currentScreenshot, savedScreenshot) {
  // 使用简单的像素差异检测
  // 或使用 SSIM 结构相似度算法
  const similarity = await computeSSIM(currentScreenshot, savedScreenshot);
  
  if (similarity < 0.7) {
    return { 
      valid: false, 
      reason: '页面布局变化较大',
      similarity 
    };
  }
  
  return { valid: true, similarity };
}
```

---

## 8. 与 Copilot 集成

### 8.1 执行时使用 Agent

```javascript
// Copilot 执行流程
async function executeWithAgent(task, agentConfig) {
  const currentUrl = await getCurrentUrl();
  const { site, page } = identifySiteAndPage(currentUrl, agentConfig.sites);
  
  // 获取当前页可用坐标
  const coordinates = agentConfig.sites[site]?.pages[page]?.coordinates || {};
  
  // 构建增强 Prompt
  const prompt = `
【Agent 预设】当前使用: ${agentConfig.metadata.name}
【当前页面】${site}.${page} (${currentUrl})
【可用坐标】
${Object.entries(coordinates).map(([name, coord]) => 
  `- ${name}: (${coord.x.toFixed(2)}, ${coord.y.toFixed(2)}) - ${coord.description || coord.action}`
).join('\n')}

【用户任务】${task}

提示: 如果任务涉及上述坐标对应的功能，优先使用预设坐标。
`;
  
  return await ai.generateResponse(prompt);
}
```

---

## 9. 开发优先级

### P0（核心功能）
- [ ] 左下角 Agent 选择器下拉菜单
- [ ] 创建新 Agent 对话框
- [ ] 标注模式（蒙版注入/移除）
- [ ] 暂停/继续标注（跨页面）
- [ ] 坐标记录与 YAML 生成
- [ ] 编辑面板（查看已标注结构）

### P1（体验优化）
- [ ] 自动识别 site/page
- [ ] 坐标命名建议
- [ ] 拖拽微调标记点
- [ ] 坐标测试验证
- [ ] 元素截图保存

### P2（增强功能）
- [ ] 截图比对失效检测
- [ ] AI 生成页面描述
- [ ] 导入/导出 Agent
- [ ] 撤销/重做

### P3（扩展）
- [ ] Agent 模板市场
- [ ] 多用户协作

---

## 10. 技术实现 Checklist

- [ ] 左下角 Agent 选择器 UI
- [ ] BrowserView 蒙版注入（start/pause/resume）
- [ ] 标注状态管理（AnnotationSession）
- [ ] Site/Page 自动识别
- [ ] 坐标点击事件捕获与存储
- [ ] 编辑面板（树形结构 + 预览）
- [ ] YAML 序列化/反序列化
- [ ] 与 Copilot 集成（Prompt 注入）

---

**确认后开始 P0 开发？**
