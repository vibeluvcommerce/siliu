/**
 * Export Manager - 统一数据导出管理器
 * 
 * 功能：
 * 1. 接收 AI 分批输出的数据（collect action）
 * 2. 实时写入磁盘缓存
 * 3. 超时检测（180s）
 * 4. 自动合并并导出为指定格式
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { getWorkspaceManager } = require('./workspace-manager');
const { resolveHomePath } = require('./path-utils');
const { v4: uuidv4 } = require('uuid');

// 导入导出器（基础导出器）
const { ExcelExporter } = require('../exporters/excel-exporter');
const { CSVExporter } = require('../exporters/csv-exporter');
const { JSONExporter } = require('../exporters/json-exporter');
// PDF/PNG 导出器使用延迟加载，避免启动时加载 Puppeteer
let PDFExporter, PNGExporter;

// 超时时间：180秒
const EXPORT_TIMEOUT = 180000;
// 检查间隔：10秒
const CHECK_INTERVAL = 10000;

class ExportManager {
  constructor() {
    this.workspace = getWorkspaceManager();
    this.cacheDir = path.join(this.workspace.getCacheDir(), 'exports');
    
    // 活跃的导出任务
    this.activeExports = new Map();
    
    // 启动超时检查定时器
    this._startTimeoutChecker();
    
    // 确保缓存目录存在
    this._ensureCacheDir();
  }

  /**
   * 确保缓存目录存在
   */
  async _ensureCacheDir() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (err) {
      console.error('[ExportManager] Failed to create cache dir:', err.message);
    }
  }

  /**
   * 开始一个新的导出任务
   * @param {Object} options
   * @param {string} options.format - 导出格式
   * @param {string} options.filename - 基础文件名
   * @param {string} options.expectedType - 预期数据类型（table/list/document/chart）
   * @returns {string} taskId
   */
  async startExport(options = {}) {
    const taskId = uuidv4();
    const index = {
      taskId,
      status: 'collecting',
      format: options.format || 'excel',
      filename: options.filename || `export-${Date.now()}`,
      expectedType: options.expectedType || 'table',
      batches: 0,
      startTime: Date.now(),
      lastBatchTime: Date.now()
    };

    // 写入索引文件
    await this._writeIndex(taskId, index);
    
    // 记录活跃任务
    this.activeExports.set(taskId, {
      ...index,
      timeoutId: null
    });

    console.log(`[ExportManager] Started export task: ${taskId}`);
    return taskId;
  }

  /**
   * 接收一批数据
   * @param {string} taskId
   * @param {Object} data - collect action 的 content.data
   * @param {number} batchIndex
   * @param {boolean} hasMore
   */
  async collectBatch(taskId, content, batchIndex, hasMore) {
    const index = await this._readIndex(taskId);
    if (!index || index.status !== 'collecting') {
      throw new Error(`Export task ${taskId} not found or not collecting`);
    }

    // 写入批次文件
    const batchFile = path.join(this.cacheDir, `${taskId}-${batchIndex}.json`);
    await fs.writeFile(batchFile, JSON.stringify({
      batchIndex,
      content,
      hasMore,
      timestamp: Date.now()
    }));

    // 更新索引
    index.batches = Math.max(index.batches, batchIndex + 1);
    index.lastBatchTime = Date.now();
    await this._writeIndex(taskId, index);

    // 更新活跃任务
    const activeTask = this.activeExports.get(taskId);
    if (activeTask) {
      activeTask.batches = index.batches;
      activeTask.lastBatchTime = index.lastBatchTime;
    }

    console.log(`[ExportManager] Collected batch ${batchIndex} for ${taskId}, hasMore=${hasMore}`);

    // 如果是最后一批，立即触发导出
    if (!hasMore) {
      await this._finalizeExport(taskId, 'completed');
    }

    return { batchIndex, hasMore };
  }

  /**
   * 完成导出任务
   * @param {string} taskId
   * @param {string} status - completed 或 timeout
   */
  async _finalizeExport(taskId, status) {
    const index = await this._readIndex(taskId);
    if (!index) return;

    // 防止重复处理
    if (index.status !== 'collecting') {
      console.log(`[ExportManager] Task ${taskId} already finalized`);
      return;
    }

    console.log(`[ExportManager] Finalizing ${taskId} with status: ${status}`);

    try {
      // 1. 读取所有批次
      const batches = await this._loadAllBatches(taskId);
      if (batches.length === 0) {
        throw new Error('No data collected');
      }

      // 2. 合并数据
      const mergedData = await this._mergeBatches(batches, index.expectedType);

      // 3. 处理图片
      const processedData = await this._processImages(mergedData, taskId);

      // 4. 导出文件
      const exportPath = await this._exportFile(processedData, index);

      // 5. 更新索引
      index.status = status;
      index.exportPath = exportPath;
      index.completedAt = Date.now();
      await this._writeIndex(taskId, index);

      // 6. 清理活跃任务
      this.activeExports.delete(taskId);

      // 7. 通知用户
      const message = status === 'completed' 
        ? `✅ 已完整导出数据：${exportPath}`
        : `⚠️ 已导出部分数据（超时）：${exportPath}`;
      
      console.log(`[ExportManager] ${message}`);
      this._notifyUser(message);

      return { path: exportPath, status };

    } catch (err) {
      console.error(`[ExportManager] Export failed:`, err);
      index.status = 'failed';
      index.error = err.message;
      await this._writeIndex(taskId, index);
      this.activeExports.delete(taskId);
      throw err;
    }
  }

  /**
   * 加载所有批次数据
   */
  async _loadAllBatches(taskId) {
    const index = await this._readIndex(taskId);
    const batches = [];

    for (let i = 0; i < index.batches; i++) {
      const batchFile = path.join(this.cacheDir, `${taskId}-${i}.json`);
      try {
        const content = await fs.readFile(batchFile, 'utf-8');
        batches.push(JSON.parse(content));
      } catch (err) {
        console.warn(`[ExportManager] Failed to load batch ${i}:`, err.message);
      }
    }

    return batches.sort((a, b) => a.batchIndex - b.batchIndex);
  }

  /**
   * 合并批次数据
   */
  async _mergeBatches(batches, dataType) {
    const firstContent = batches[0].content;
    const firstData = firstContent.data;

    switch (dataType) {
      case 'table':
        return this._mergeTables(batches);
      case 'list':
        return this._mergeLists(batches);
      case 'document':
        return this._mergeDocuments(batches);
      default:
        // 默认取最后一批
        return batches[batches.length - 1].content;
    }
  }

  _mergeTables(batches) {
    const first = batches[0].content.data;
    return {
      type: 'table',
      data: {
        headers: first.headers,
        rows: batches.flatMap(b => b.content.data.rows || [])
      }
    };
  }

  _mergeLists(batches) {
    return {
      type: 'list',
      data: {
        items: batches.flatMap(b => b.content.data.items || [])
      }
    };
  }

  _mergeDocuments(batches) {
    const first = batches[0].content.data;
    return {
      type: 'document',
      data: {
        title: first.title,
        sections: batches.flatMap(b => b.content.data.sections || [])
      }
    };
  }

  /**
   * 处理图片（下载并替换 URL）
   */
  async _processImages(content, taskId) {
    const imageCacheDir = path.join(this.cacheDir, `${taskId}-images`);
    await fs.mkdir(imageCacheDir, { recursive: true });

    // 递归扫描所有图片
    const imageUrls = this._extractImageUrls(content);
    console.log(`[ExportManager] Found ${imageUrls.length} images to download`);

    // 并行下载（限制并发数为 5）
    const results = await this._downloadImagesParallel(imageUrls, imageCacheDir, 5);

    // 替换 URL 为本地路径
    return this._replaceImageUrls(content, results);
  }

  _extractImageUrls(obj, urls = []) {
    if (typeof obj === 'object' && obj !== null) {
      if (obj.type === 'image' && obj.url) {
        urls.push({ url: obj.url, alt: obj.alt });
      }
      for (const key in obj) {
        this._extractImageUrls(obj[key], urls);
      }
    }
    return urls;
  }

  async _downloadImagesParallel(imageUrls, cacheDir, concurrency = 5) {
    const results = [];
    
    for (let i = 0; i < imageUrls.length; i += concurrency) {
      const batch = imageUrls.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(img => this._downloadImage(img, cacheDir))
      );
      results.push(...batchResults);
    }

    return results;
  }

  async _downloadImage(imgInfo, cacheDir) {
    try {
      const crypto = require('crypto');
      const hash = crypto.createHash('md5').update(imgInfo.url).digest('hex');
      
      // 尝试获取扩展名
      const urlPath = new URL(imgInfo.url).pathname;
      const ext = path.extname(urlPath) || '.png';
      const filename = `${hash}${ext}`;
      const filepath = path.join(cacheDir, filename);

      // 检查是否已存在
      try {
        await fs.access(filepath);
        return { ...imgInfo, localPath: filepath, success: true, cached: true };
      } catch {
        // 不存在，继续下载
      }

      // 下载图片
      const response = await fetch(imgInfo.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(filepath, buffer);

      console.log(`[ExportManager] Downloaded image: ${imgInfo.url.substring(0, 50)}...`);
      return { ...imgInfo, localPath: filepath, success: true };

    } catch (err) {
      console.warn(`[ExportManager] Failed to download image: ${imgInfo.url}`, err.message);
      return { ...imgInfo, success: false, error: err.message };
    }
  }

  _replaceImageUrls(obj, results) {
    if (typeof obj === 'object' && obj !== null) {
      if (obj.type === 'image' && obj.url) {
        const result = results.find(r => r.url === obj.url);
        if (result && result.success) {
          return { ...obj, localPath: result.localPath };
        }
      }
      
      if (Array.isArray(obj)) {
        return obj.map(item => this._replaceImageUrls(item, results));
      }
      
      const newObj = {};
      for (const key in obj) {
        newObj[key] = this._replaceImageUrls(obj[key], results);
      }
      return newObj;
    }
    return obj;
  }

  /**
   * 导出文件
   */
  async _exportFile(data, index) {
    const exporter = this._getExporter(index.format);
    const exportsDir = this.workspace.getExportsDir();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = `${index.filename}-${timestamp}.${exporter.getExtension()}`;
    const filepath = path.join(exportsDir, filename);

    console.log(`[ExportManager] Exporting to ${filepath}...`);
    
    await exporter.export(data, filepath, {
      batchCount: index.batches
    });

    return filepath;
  }

  _getExporter(format) {
    switch (format) {
      case 'excel': return new ExcelExporter();
      case 'csv': return new CSVExporter();
      case 'json': return new JSONExporter();
      case 'pdf':
        // 延迟加载 PDF 导出器，避免启动时加载 Puppeteer
        if (!PDFExporter) {
          PDFExporter = require('../exporters/pdf-exporter').PDFExporter;
        }
        return new PDFExporter();
      case 'png':
        // 延迟加载 PNG 导出器，避免启动时加载 Puppeteer
        if (!PNGExporter) {
          PNGExporter = require('../exporters/png-exporter').PNGExporter;
        }
        return new PNGExporter();
      default: throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * 启动超时检查定时器
   */
  _startTimeoutChecker() {
    setInterval(async () => {
      const now = Date.now();
      
      for (const [taskId, task] of this.activeExports) {
        if (task.status !== 'collecting') continue;
        
        const elapsed = now - task.lastBatchTime;
        if (elapsed > EXPORT_TIMEOUT) {
          console.log(`[ExportManager] Task ${taskId} timed out after ${elapsed}ms`);
          await this._finalizeExport(taskId, 'timeout');
        }
      }
    }, CHECK_INTERVAL);
  }

  /**
   * 读取索引文件
   */
  async _readIndex(taskId) {
    try {
      const indexFile = path.join(this.cacheDir, `${taskId}-index.json`);
      const content = await fs.readFile(indexFile, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      return null;
    }
  }

  /**
   * 写入索引文件
   */
  async _writeIndex(taskId, index) {
    const indexFile = path.join(this.cacheDir, `${taskId}-index.json`);
    await fs.writeFile(indexFile, JSON.stringify(index, null, 2));
  }

  /**
   * 通知用户（可通过事件扩展）
   */
  _notifyUser(message) {
    // TODO: 集成到 UI 通知系统
    console.log(`[ExportManager] Notification: ${message}`);
  }

  /**
   * 手动触发导出（用于 AI 明确调用 export action）
   */
  async manualExport(taskId) {
    const index = await this._readIndex(taskId);
    if (!index) {
      throw new Error(`Export task ${taskId} not found`);
    }
    if (index.status !== 'collecting') {
      throw new Error(`Export task ${taskId} is not in collecting state`);
    }
    
    return this._finalizeExport(taskId, 'completed');
  }

  /**
   * 获取导出任务状态
   */
  async getStatus(taskId) {
    return this._readIndex(taskId);
  }

  /**
   * 清理旧缓存（保留24小时）
   */
  async cleanup(maxAge = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    const entries = await fs.readdir(this.cacheDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      
      const filepath = path.join(this.cacheDir, entry.name);
      const stats = await fs.stat(filepath);
      
      if (now - stats.mtimeMs > maxAge) {
        await fs.unlink(filepath);
        console.log(`[ExportManager] Cleaned up: ${entry.name}`);
      }
    }
  }
}

// 单例
let instance = null;
function getExportManager() {
  if (!instance) {
    instance = new ExportManager();
  }
  return instance;
}

module.exports = { ExportManager, getExportManager };
