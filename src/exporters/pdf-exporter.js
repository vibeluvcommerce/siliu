/**
 * PDF Exporter - PDF 导出器
 * 
 * 依赖：puppeteer
 */

const { BaseExporter } = require('./base-exporter');
const fs = require('fs').promises;
const path = require('path');

class PDFExporter extends BaseExporter {
  async export(data, filepath, options = {}) {
    // 动态导入 puppeteer
    const puppeteer = require('puppeteer');

    // 生成 HTML
    const html = this._renderHTML(data, options);

    // 启动浏览器
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });

      // 等待图片加载
      await page.waitForTimeout(1000);

      // 生成 PDF
      await page.pdf({
        path: filepath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '20mm',
          bottom: '20mm',
          left: '20mm'
        }
      });

      const stats = await fs.stat(filepath);
      console.log(`[PDFExporter] Exported to ${filepath}, size: ${stats.size} bytes`);

      return { size: stats.size };
    } finally {
      await browser.close();
    }
  }

  _renderHTML(data, options) {
    const title = data.data?.title || '导出报告';
    const content = this._renderContent(data);

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: "Microsoft YaHei", "SimHei", sans-serif;
      font-size: 12pt;
      line-height: 1.6;
      color: #333;
      padding: 20px;
    }
    h1 {
      font-size: 18pt;
      color: #1a1a1a;
      border-bottom: 2px solid #333;
      padding-bottom: 10px;
    }
    h2 {
      font-size: 14pt;
      color: #333;
      margin-top: 20px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
    }
    th, td {
      border: 1px solid #ccc;
      padding: 8px;
      text-align: left;
    }
    th {
      background-color: #f5f5f5;
      font-weight: bold;
    }
    img {
      max-width: 150px;
      max-height: 150px;
    }
    .paragraph {
      margin: 10px 0;
      text-align: justify;
    }
    .meta {
      color: #666;
      font-size: 10pt;
      margin-top: 30px;
      border-top: 1px solid #eee;
      padding-top: 10px;
    }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${content}
  <div class="meta">
    生成时间：${new Date().toLocaleString()}
  </div>
</body>
</html>
    `;
  }

  _renderContent(data) {
    if (data.type === 'table') {
      return this._renderTable(data.data);
    }
    if (data.type === 'list') {
      return this._renderList(data.data);
    }
    if (data.type === 'document') {
      return this._renderDocument(data.data);
    }
    return `<pre>${JSON.stringify(data, null, 2)}</pre>`;
  }

  _renderTable(tableData) {
    const headers = tableData.headers.map(h => `<th>${h}</th>`).join('');
    const rows = tableData.rows.map(row => {
      const cells = row.map(cell => {
        if (cell && typeof cell === 'object' && cell.type === 'image') {
          const src = cell.localPath || cell.url;
          return `<td><img src="${src}" alt="${cell.alt || ''}"></td>`;
        }
        return `<td>${cell ?? ''}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    return `
      <table>
        <thead><tr>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  _renderList(listData) {
    const items = listData.items.map((item, index) => {
      const value = typeof item === 'object' ? JSON.stringify(item) : item;
      return `<li><strong>${index + 1}.</strong> ${value}</li>`;
    }).join('');
    return `<ol>${items}</ol>`;
  }

  _renderDocument(docData) {
    return docData.sections.map(section => {
      switch (section.type) {
        case 'heading':
          return `<h2>${section.text}</h2>`;
        case 'paragraph':
          return `<div class="paragraph">${section.text}</div>`;
        case 'table':
          return this._renderTable(section.data);
        case 'image':
          const src = section.localPath || section.url;
          return `<div><img src="${src}" alt="${section.caption || ''}"><div>${section.caption || ''}</div></div>`;
        default:
          return `<div>${JSON.stringify(section)}</div>`;
      }
    }).join('');
  }

  getExtension() {
    return 'pdf';
  }
}

module.exports = { PDFExporter };
