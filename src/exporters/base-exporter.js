/**
 * Base Exporter - 导出器基类
 */

class BaseExporter {
  /**
   * 导出数据到文件
   * @param {Object} data - 要导出的数据（已合并和处理）
   * @param {string} filepath - 输出文件路径
   * @param {Object} options - 导出选项
   */
  async export(data, filepath, options = {}) {
    throw new Error('Not implemented');
  }

  /**
   * 获取文件扩展名
   * @returns {string}
   */
  getExtension() {
    throw new Error('Not implemented');
  }
}

module.exports = { BaseExporter };
