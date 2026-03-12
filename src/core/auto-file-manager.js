/**
 * Auto File Manager - 自动化文件管理器
 * 协调系统级对话框拦截和 AI 文件操作
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class AutoFileManager extends EventEmitter {
  constructor(tabManager) {
    super();
    this.tabManager = tabManager;
    this.interceptor = null;
    this.workDir = this._getDefaultWorkDir();
    this.isAutoMode = false;
    this.pendingOperation = null; // { type: 'upload'|'download', filePath: string }
    
    // 尝试加载拦截器
    this._initInterceptor();
  }

  /**
   * 获取默认工作目录
   */
  _getDefaultWorkDir() {
    const workDir = path.join(app.getPath('userData'), 'auto-files');
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }
    
    // 创建子目录
    const dirs = ['uploads', 'downloads'];
    dirs.forEach(dir => {
      const subDir = path.join(workDir, dir);
      if (!fs.existsSync(subDir)) {
        fs.mkdirSync(subDir, { recursive: true });
      }
    });
    
    return workDir;
  }

  /**
   * 初始化拦截器
   */
  _initInterceptor() {
    try {
      const DialogInterceptor = require('./dialog-interceptor');
      this.interceptor = DialogInterceptor;
      
      // 监听拦截器事件
      this.interceptor.on('file:selected', (data) => {
        console.log('[AutoFileManager] File auto-selected:', data);
        this.emit('file:selected', data);
        this._clearPending();
      });
      
      this.interceptor.on('dialog:manual-required', (data) => {
        console.warn('[AutoFileManager] Manual intervention required:', data);
        this.emit('dialog:manual-required', data);
      });
      
      // 启动拦截器
      if (this.interceptor.isAvailable()) {
        this.interceptor.start();
        console.log('[AutoFileManager] Dialog interceptor started');
      } else {
        console.warn('[AutoFileManager] Dialog interceptor not available (koffi missing)');
      }
      
    } catch (err) {
      console.error('[AutoFileManager] Failed to init interceptor:', err.message);
      this.interceptor = null;
    }
  }

  /**
   * 设置自动模式
   * @param {boolean} enabled - 是否启用自动模式
   * @param {Object} options - 选项
   * @param {string} options.uploadDir - 上传目录
   * @param {string} options.downloadDir - 下载目录
   */
  setAutoMode(enabled, options = {}) {
    this.isAutoMode = enabled;
    
    if (options.uploadDir) {
      this.uploadDir = options.uploadDir;
      if (!fs.existsSync(this.uploadDir)) {
        fs.mkdirSync(this.uploadDir, { recursive: true });
      }
    }
    
    if (options.downloadDir) {
      this.downloadDir = options.downloadDir;
      if (!fs.existsSync(this.downloadDir)) {
        fs.mkdirSync(this.downloadDir, { recursive: true });
      }
    }
    
    console.log('[AutoFileManager] Auto mode:', enabled, options);
    this.emit('mode:changed', { enabled, ...options });
  }

  /**
   * 准备上传文件
   * @param {string} filePath - 要上传的文件路径
   * @returns {boolean} 是否成功准备
   */
  prepareUpload(filePath) {
    if (!fs.existsSync(filePath)) {
      console.error('[AutoFileManager] File not found:', filePath);
      return false;
    }
    
    this.pendingOperation = {
      type: 'upload',
      filePath: filePath
    };
    
    // 设置到拦截器
    if (this.interceptor) {
      this.interceptor.setNextFile(filePath);
    }
    
    console.log('[AutoFileManager] Upload prepared:', filePath);
    return true;
  }

  /**
   * AI 执行上传操作
   * @param {string} selector - 上传按钮选择器或坐标
   * @param {string} filePath - 要上传的文件
   * @returns {Promise<Object>}
   */
  async performUpload(selector, filePath) {
    // 1. 准备文件
    if (!this.prepareUpload(filePath)) {
      return { success: false, error: 'File not found' };
    }
    
    // 2. 启动拦截器（如果可用）
    const interceptorReady = this.interceptor?.isRunning || false;
    
    try {
      // 3. 触发上传按钮点击
      console.log('[AutoFileManager] Clicking upload button:', selector);
      
      // 这里假设通过 CDP 或 controller 点击
      // 实际调用会在 siliu-controller 中实现
      this.emit('upload:click', { selector, filePath });
      
      // 4. 等待结果
      const result = await this._waitForUploadResult(10000); // 10秒超时
      
      return result;
      
    } catch (err) {
      console.error('[AutoFileManager] Upload failed:', err);
      this._clearPending();
      return { success: false, error: err.message };
    }
  }

  /**
   * 处理系统弹出的文件对话框（备用方案）
   * 当拦截器不可用时，使用同步的文件选择
   */
  handleSystemDialog(dialogInfo) {
    if (!this.pendingOperation) return null;
    
    const { type, filePath } = this.pendingOperation;
    
    if (type === 'upload' && filePath) {
      // 返回预设的文件路径
      return {
        canceled: false,
        filePaths: [filePath]
      };
    }
    
    return null;
  }

  /**
   * 等待上传结果
   */
  _waitForUploadResult(timeout = 10000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve({ success: false, error: 'Timeout waiting for upload' });
      }, timeout);
      
      const onSelected = (data) => {
        cleanup();
        resolve({ success: true, filePath: data.filePath });
      };
      
      const onManual = (data) => {
        cleanup();
        resolve({ 
          success: false, 
          error: 'Manual intervention required',
          hwnd: data.hwnd 
        });
      };
      
      const cleanup = () => {
        clearTimeout(timer);
        this.off('file:selected', onSelected);
        this.off('dialog:manual-required', onManual);
      };
      
      this.once('file:selected', onSelected);
      this.once('dialog:manual-required', onManual);
    });
  }

  /**
   * 清理待处理操作
   */
  _clearPending() {
    this.pendingOperation = null;
    if (this.interceptor) {
      this.interceptor.clearNextFile();
    }
  }

  /**
   * 获取工作目录路径
   */
  getWorkPath(subDir = '') {
    if (subDir) {
      const dir = path.join(this.workDir, subDir);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      return dir;
    }
    return this.workDir;
  }

  /**
   * 列出目录中的文件
   */
  listFiles(subDir = '') {
    const dir = this.getWorkPath(subDir);
    try {
      return fs.readdirSync(dir).map(name => {
        const fullPath = path.join(dir, name);
        const stat = fs.statSync(fullPath);
        return {
          name,
          path: fullPath,
          size: stat.size,
          mtime: stat.mtime,
          isDirectory: stat.isDirectory()
        };
      });
    } catch (err) {
      console.error('[AutoFileManager] Failed to list files:', err);
      return [];
    }
  }

  /**
   * 停止服务
   */
  stop() {
    if (this.interceptor) {
      this.interceptor.stop();
    }
    this._clearPending();
    console.log('[AutoFileManager] Stopped');
  }
}

module.exports = AutoFileManager;
