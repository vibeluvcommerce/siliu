/**
 * JSON Exporter - JSON 导出器
 */

const { BaseExporter } = require('./base-exporter');
const fs = require('fs').promises;

class JSONExporter extends BaseExporter {
  async export(data, filepath, options = {}) {
    const output = {
      meta: {
        exportTime: new Date().toISOString(),
        format: data.type || 'unknown',
        batchCount: options.batchCount || 1
      },
      data: data.data
    };

    await fs.writeFile(filepath, JSON.stringify(output, null, 2), 'utf-8');

    const stats = await fs.stat(filepath);
    console.log(`[JSONExporter] Exported to ${filepath}, size: ${stats.size} bytes`);

    return { size: stats.size };
  }

  getExtension() {
    return 'json';
  }
}

module.exports = { JSONExporter };
