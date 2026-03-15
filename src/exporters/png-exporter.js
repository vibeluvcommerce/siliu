/**
 * PNG Exporter - PNG 导出器
 * 
 * 使用 Puppeteer 生成图表截图
 */

const { BaseExporter } = require('./base-exporter');
const fs = require('fs').promises;

class PNGExporter extends BaseExporter {
  async export(data, filepath, options = {}) {
    const puppeteer = require('puppeteer');

    if (data.type === 'chart') {
      return this._exportChart(data.data, filepath, options);
    }

    // 默认：将数据渲染为文本图片
    return this._exportTextImage(data, filepath, options);
  }

  async _exportChart(chartData, filepath, options) {
    const puppeteer = require('puppeteer');

    const width = options.width || 800;
    const height = options.height || 600;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { margin: 0; padding: 20px; background: white; }
    #chart-container { width: ${width}px; height: ${height}px; }
  </style>
</head>
<body>
  <div id="chart-container">
    <canvas id="chart"></canvas>
  </div>
  <script>
    new Chart(document.getElementById('chart'), {
      type: '${chartData.chartType || 'bar'}',
      data: {
        labels: ${JSON.stringify(chartData.labels || [])},
        datasets: [{
          label: '${chartData.datasetLabel || '数据'}',
          data: ${JSON.stringify(chartData.values || [])},
          backgroundColor: ${JSON.stringify(chartData.colors || [
            'rgba(255, 99, 132, 0.5)',
            'rgba(54, 162, 235, 0.5)',
            'rgba(255, 206, 86, 0.5)',
            'rgba(75, 192, 192, 0.5)',
            'rgba(153, 102, 255, 0.5)'
          ])},
          borderColor: ${JSON.stringify(chartData.borderColors || [
            'rgba(255, 99, 132, 1)',
            'rgba(54, 162, 235, 1)',
            'rgba(255, 206, 86, 1)',
            'rgba(75, 192, 192, 1)',
            'rgba(153, 102, 255, 1)'
          ])},
          borderWidth: 1
        }]
      },
      options: {
        responsive: false,
        animation: false,
        plugins: {
          title: {
            display: ${!!chartData.title},
            text: '${chartData.title || ''}'
          },
          legend: {
            display: true,
            position: 'bottom'
          }
        }
      }
    });
  </script>
</body>
</html>
    `;

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width, height });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      
      // 等待 Chart.js 渲染
      await page.waitForTimeout(1000);

      const element = await page.$('#chart-container');
      await element.screenshot({ path: filepath });

      const stats = await fs.stat(filepath);
      console.log(`[PNGExporter] Chart exported to ${filepath}, size: ${stats.size} bytes`);

      return { size: stats.size };
    } finally {
      await browser.close();
    }
  }

  async _exportTextImage(data, filepath, options) {
    const puppeteer = require('puppeteer');

    const width = options.width || 800;
    const height = options.height || 600;

    const text = JSON.stringify(data, null, 2);
    const lines = text.split('\n').map(l => `<div>${this._escapeHtml(l)}</div>`).join('');

    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: monospace;
      font-size: 14px;
      line-height: 1.5;
      color: #333;
      background: white;
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
    }
  </style>
</head>
<body>
  ${lines}
</body>
</html>
    `;

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['----no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width, height });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.screenshot({ path: filepath });

      const stats = await fs.stat(filepath);
      console.log(`[PNGExporter] Text image exported to ${filepath}, size: ${stats.size} bytes`);

      return { size: stats.size };
    } finally {
      await browser.close();
    }
  }

  _escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  getExtension() {
    return 'png';
  }
}

module.exports = { PNGExporter };
