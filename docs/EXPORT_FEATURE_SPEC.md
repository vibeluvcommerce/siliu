# 数据导出功能开发文档

## 1. 功能概述

统一的数据导出能力，支持 AI 分步采集、自动合并、多格式导出。

## 2. 核心设计原则

- **AI 只管输出**：AI 输出标准 JSON 数据片段
- **系统负责实现**：系统处理合并、下载、格式转换
- **简单可靠**：不追求复杂容灾，超时即结束

---

## 3. 数据流架构

```
AI 采集数据
    ↓
输出 data action（分批）
    ↓
系统实时写入磁盘缓存
    ↓
检测到 hasMore: false 或超时 180s
    ↓
自动合并所有批次
    ↓
按指定格式导出文件
    ↓
提示用户结果
```

---

## 4. 关键数据结构

### 4.1 AI 输出格式（data action）

```typescript
interface DataAction {
  action: 'data';
  content: {
    type: 'table' | 'list' | 'document' | 'chart';
    data: any;
    // 表格示例
    // data: {
    //   headers: ['商品', '价格', '图片'],
    //   rows: [
    //     ['iPhone', 5999, { type: 'image', url: 'https://...', alt: 'iPhone' }],
    //     ['MacBook', 9999, { type: 'image', url: 'https://...', alt: 'MacBook' }]
    //   ]
    // }
  };
  batchIndex: number;      // 第几批，从 0 开始
  hasMore: boolean;        // 是否还有下一批
  description: string;     // 步骤描述
}
```

### 4.2 缓存文件结构

```
~/.siliu/workspace/cache/exports/
├── {taskId}-index.json           # 导出任务索引
├── {taskId}-0.json               # 第 0 批数据
├── {taskId}-1.json               # 第 1 批数据
└── {taskId}-images/              # 下载的图片缓存
    ├── {hash1}.png
    └── {hash2}.jpg
```

### 4.3 索引文件格式

```typescript
interface ExportIndex {
  taskId: string;
  status: 'collecting' | 'merging' | 'exporting' | 'completed' | 'timeout';
  format: 'excel' | 'csv' | 'json' | 'pdf' | 'png';
  filename: string;           // 用户指定的基础文件名
  batches: number;           // 已采集批次数
  startTime: number;         // 开始时间戳
  lastBatchTime: number;     // 最后一批时间戳
  expectedFormat?: string;   // 预期数据类型（table/list等）
}
```

---

## 5. 状态流转

```
                    ┌─────────────────────┐
                    │   startExport()     │
                    │  创建索引文件       │
                    └──────────┬──────────┘
                               ↓
                    ┌─────────────────────┐
         ┌─────────│     COLLECTING      │◄────────────────┐
         │         │   接收 data action  │                 │
         │         └──────────┬──────────┘                 │
         │                    │                           │
         │     hasMore: true  │                           │
         │                    ↓                           │
         │         ┌─────────────────────┐                │
         └─────────│  写入 batch-n.json  │────────────────┘
                   └─────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         │ hasMore: false      │ 180s 超时          │
         ↓                     ↓                     ↓
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│    COMPLETED    │  │    TIMEOUT      │  │    FAILED       │
│   完整导出      │  │   部分导出      │  │   导出失败      │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## 6. 结束判断机制

### 6.1 正常结束（hasMore: false）

```javascript
// AI 输出示例
{
  action: 'data',
  content: { type: 'table', data: {...} },
  batchIndex: 4,
  hasMore: false,  // ← 明确标记结束
  description: '采集第5页（最后一页）'
}

// 系统处理
if (!decision.hasMore) {
  await finalizeExport(taskId, 'completed');
  notifyUser('✅ 已完整导出数据：' + filepath);
}
```

### 6.2 超时结束（180秒）

```javascript
// 定时检查
setInterval(async () => {
  const index = await readIndex(taskId);
  const elapsed = Date.now() - index.lastBatchTime;
  
  if (elapsed > 180000 && index.status === 'collecting') {
    await finalizeExport(taskId, 'timeout');
    notifyUser('⚠️ 已导出部分数据（超时）：' + filepath);
  }
}, 10000); // 每10秒检查一次
```

### 6.3 超时后处理

- **不恢复**：超时后直接结束任务，不保留恢复状态
- **保留缓存**：批次文件保留 24 小时（方便用户手动查找）
- **明确提示**：告知用户是"部分数据"

---

## 7. 数据合并逻辑

### 7.1 按类型合并

```javascript
async function mergeBatches(taskId, dataType) {
  const batches = await loadAllBatches(taskId);
  
  switch(dataType) {
    case 'table':
      return mergeTables(batches);
    case 'list':
      return mergeLists(batches);
    case 'document':
      return mergeDocuments(batches);
    default:
      return batches[batches.length - 1]; // 默认取最后一批
  }
}

function mergeTables(batches) {
  const first = batches[0].content.data;
  return {
    headers: first.headers,
    rows: batches.flatMap(b => b.content.data.rows)
  };
}

function mergeLists(batches) {
  return {
    items: batches.flatMap(b => b.content.data.items)
  };
}

function mergeDocuments(batches) {
  return {
    title: batches[0].content.data.title,
    sections: batches.flatMap(b => b.content.data.sections)
  };
}
```

### 7.2 图片处理

```javascript
async function processImages(data, taskId) {
  const imageCacheDir = `~/.siliu/workspace/cache/exports/${taskId}-images/`;
  
  // 递归扫描所有图片 URL
  const imageUrls = extractImageUrls(data);
  
  // 并行下载（限制并发）
  const results = await Promise.all(
    imageUrls.map(async (img) => {
      try {
        const localPath = await downloadImage(img.url, imageCacheDir);
        return { ...img, localPath, success: true };
      } catch (err) {
        return { ...img, success: false, error: err.message };
      }
    })
  );
  
  // 替换 URL 为本地路径
  return replaceImageUrls(data, results);
}
```

---

## 8. 导出器实现

### 8.1 导出器接口

```javascript
class BaseExporter {
  async export(data, filepath, options) {
    throw new Error('Not implemented');
  }
  
  getExtension() {
    throw new Error('Not implemented');
  }
}
```

### 8.2 Excel 导出器

```javascript
const ExcelJS = require('exceljs');

class ExcelExporter extends BaseExporter {
  async export(data, filepath, options = {}) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(options.sheetName || 'Sheet1');
    
    // 写入表头
    worksheet.columns = data.headers.map(h => ({ header: h, key: h }));
    
    // 写入数据行
    for (const row of data.rows) {
      const rowData = {};
      for (let i = 0; i < data.headers.length; i++) {
        const cell = row[i];
        if (cell && cell.type === 'image') {
          // 插入图片
          await this.insertImage(worksheet, cell.localPath, rowIndex, i);
          rowData[data.headers[i]] = ''; // 图片单元格留空
        } else {
          rowData[data.headers[i]] = cell;
        }
      }
      worksheet.addRow(rowData);
    }
    
    await workbook.xlsx.writeFile(filepath);
    return { size: fs.statSync(filepath).size };
  }
  
  async insertImage(worksheet, imagePath, row, col) {
    const imageId = worksheet.workbook.addImage({
      filename: imagePath,
      extension: path.extname(imagePath).slice(1)
    });
    
    worksheet.addImage(imageId, {
      tl: { col: col, row: row },
      ext: { width: 100, height: 100 }
    });
  }
  
  getExtension() { return 'xlsx'; }
}
```

### 8.3 CSV 导出器

```javascript
class CSVExporter extends BaseExporter {
  async export(data, filepath, options) {
    const { createObjectCsvWriter } = require('csv-writer');
    
    const csvWriter = createObjectCsvWriter({
      path: filepath,
      header: data.headers.map(h => ({ id: h, title: h }))
    });
    
    // 图片转为 URL 文本
    const records = data.rows.map(row => {
      const record = {};
      for (let i = 0; i < data.headers.length; i++) {
        const cell = row[i];
        record[data.headers[i]] = (cell && cell.type === 'image') 
          ? cell.url 
          : cell;
      }
      return record;
    });
    
    await csvWriter.writeRecords(records);
    return { size: fs.statSync(filepath).size };
  }
  
  getExtension() { return 'csv'; }
}
```

### 8.4 JSON 导出器

```javascript
class JSONExporter extends BaseExporter {
  async export(data, filepath, options) {
    const output = {
      meta: {
        exportTime: new Date().toISOString(),
        batches: options.batchCount
      },
      data: data
    };
    
    await fs.writeFile(filepath, JSON.stringify(output, null, 2));
    return { size: fs.statSync(filepath).size };
  }
  
  getExtension() { return 'json'; }
}
```

### 8.5 PDF 导出器（Puppeteer 方案）

```javascript
class PDFExporter extends BaseExporter {
  async export(data, filepath, options) {
    const puppeteer = require('puppeteer');
    
    // 生成 HTML
    const html = this.renderTemplate(data, options.template);
    
    // 启动浏览器
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    // 生成 PDF
    await page.pdf({
      path: filepath,
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' }
    });
    
    await browser.close();
    return { size: fs.statSync(filepath).size };
  }
  
  renderTemplate(data, template) {
    // 使用简单的 HTML 模板
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; }
          h1 { color: #333; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 8px; }
          th { background-color: #f2f2f2; }
          img { max-width: 200px; max-height: 200px; }
        </style>
      </head>
      <body>
        <h1>${data.title || '导出报告'}</h1>
        ${this.renderContent(data)}
      </body>
      </html>
    `;
  }
  
  renderContent(data) {
    if (data.type === 'table') {
      return this.renderTable(data.data);
    }
    if (data.type === 'document') {
      return data.data.sections.map(s => this.renderSection(s)).join('');
    }
    return JSON.stringify(data);
  }
  
  renderTable(tableData) {
    return `
      <table>
        <thead>
          <tr>${tableData.headers.map(h => `<th>${h}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${tableData.rows.map(row => `
            <tr>${row.map(cell => {
              if (cell && cell.type === 'image') {
                return `<td><img src="${cell.localPath || cell.url}"></td>`;
              }
              return `<td>${cell}</td>`;
            }).join('')}</tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
  
  getExtension() { return 'pdf'; }
}
```

### 8.6 PNG 导出器（图表）

```javascript
class PNGExporter extends BaseExporter {
  async export(data, filepath, options) {
    const { createCanvas } = require('canvas');
    
    if (data.type === 'chart') {
      return this.exportChart(data.data, filepath, options);
    }
    
    // 默认：渲染文档为图片
    return this.exportDocument(data, filepath, options);
  }
  
  async exportChart(chartData, filepath, options) {
    // 使用 Chart.js + node-canvas
    const { Chart } = require('chart.js/auto');
    const canvas = createCanvas(800, 600);
    const ctx = canvas.getContext('2d');
    
    new Chart(ctx, {
      type: chartData.chartType,
      data: {
        labels: chartData.labels,
        datasets: [{
          data: chartData.values,
          backgroundColor: chartData.colors
        }]
      },
      options: {
        responsive: false,
        animation: false
      }
    });
    
    const buffer = canvas.toBuffer('image/png');
    await fs.writeFile(filepath, buffer);
    return { size: buffer.length };
  }
  
  getExtension() { return 'png'; }
}
```

---

## 9. AI 系统提示

```markdown
【导出数据】
如需导出采集的数据，使用 data action 分批输出，最后用 export action 触发导出。

## 1. 采集数据（data action）

分批输出数据，每批一个 data action：

```json
{
  "action": "data",
  "content": {
    "type": "table",
    "data": {
      "headers": ["商品", "价格", "图片"],
      "rows": [
        ["iPhone", 5999, {"type": "image", "url": "https://...", "alt": "iPhone"}],
        ["MacBook", 9999, {"type": "image", "url": "https://...", "alt": "MacBook"}]
      ]
    }
  },
  "batchIndex": 0,
  "hasMore": true,
  "description": "采集第1页数据"
}
```

- batchIndex: 从 0 开始递增
- hasMore: 是否还有下一批（true/false）
- 图片字段用 `{type: "image", url: "..."}` 格式

## 2. 触发导出（export action）

所有数据采集完成后，使用 export action 触发导出：

```json
{
  "action": "export",
  "format": "excel",
  "filename": "商品数据",
  "options": {
    "sheetName": "Sheet1"
  }
}
```

支持格式：excel, csv, json, pdf, png

## 3. 完整示例流程

```
1. navigate: https://example.com/products
2. data: 采集第1页 (batchIndex:0, hasMore:true)
3. click: 下一页按钮
4. data: 采集第2页 (batchIndex:1, hasMore:true)
5. click: 下一页按钮
6. data: 采集第3页 (batchIndex:2, hasMore:false) ← 最后一页
7. export: 导出为 excel
8. done: 任务完成
```

## 4. 注意事项

- 每批数据建议控制在 100 条以内
- 如果 180 秒内未收到新数据，系统会自动合并导出
- 导出文件保存在 ~/.siliu/workspace/exports/
```

---

## 10. 实现清单

### Phase 1: 基础框架
- [ ] ExportManager 类
- [ ] 缓存文件系统
- [ ] 索引文件管理
- [ ] 超时检测机制

### Phase 2: 数据合并
- [ ] 批次文件读写
- [ ] 按类型合并逻辑
- [ ] 图片下载与缓存

### Phase 3: 导出器
- [ ] Excel 导出器（含图片）
- [ ] CSV 导出器
- [ ] JSON 导出器
- [ ] PDF 导出器
- [ ] PNG 导出器

### Phase 4: AI 集成
- [ ] data action 支持
- [ ] export action 支持
- [ ] 更新系统提示
- [ ] 用户通知机制

### Phase 5: 测试
- [ ] 单元测试
- [ ] 分页采集测试
- [ ] 超时测试
- [ ] 大文件测试

---

## 11. 依赖库

```json
{
  "exceljs": "^4.4.0",
  "csv-writer": "^1.6.0",
  "puppeteer": "^21.0.0",
  "canvas": "^2.11.0",
  "chart.js": "^4.4.0"
}
```

---

**文档版本**: 1.0  
**创建日期**: 2026-03-15  
**作者**: Siliu Team
