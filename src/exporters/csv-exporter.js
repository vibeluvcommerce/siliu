/**
 * CSV Exporter - CSV 导出器
 */

const { BaseExporter } = require('./base-exporter');
const fs = require('fs').promises;

class CSVExporter extends BaseExporter {
  async export(data, filepath, options = {}) {
    const rows = [];

    if (data.type === 'table') {
      // 表头
      rows.push(this._escapeRow(data.data.headers));
      
      // 数据行
      for (const row of data.data.rows) {
        const cells = row.map(cell => {
          if (cell && typeof cell === 'object' && cell.type === 'image') {
            // 图片转为 URL 文本
            return cell.url || cell.alt || '[图片]';
          }
          return cell;
        });
        rows.push(this._escapeRow(cells));
      }
    } else if (data.type === 'list') {
      rows.push(['Index', 'Item']);
      data.data.items.forEach((item, index) => {
        const value = typeof item === 'object' ? JSON.stringify(item) : item;
        rows.push(this._escapeRow([index + 1, value]));
      });
    } else {
      // 默认转为 JSON
      rows.push(['Data']);
      rows.push([JSON.stringify(data)]);
    }

    const csvContent = rows.join('\n');
    await fs.writeFile(filepath, csvContent, 'utf-8');

    const stats = await fs.stat(filepath);
    console.log(`[CSVExporter] Exported to ${filepath}, size: ${stats.size} bytes`);

    return { size: stats.size };
  }

  _escapeRow(cells) {
    return cells.map(cell => {
      const str = String(cell ?? '');
      // 如果包含逗号、引号或换行，需要转义
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',');
  }

  getExtension() {
    return 'csv';
  }
}

module.exports = { CSVExporter };
