// src/copilot/visual-context.js
// 视觉上下文管理器 - 截图、标注、临时文件管理、图床上传

const { nativeImage } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { ImageUploader } = require('../services/image-uploader');
const { ScreenshotServer } = require('../services/screenshot-server');

class VisualContextManager {
  constructor(options = {}) {
    this.maxWidth = options.maxWidth || 1280;
    this.quality = options.quality || 80;
    this.format = options.format || 'jpeg';
    this.tempDir = options.tempDir || path.join(os.tmpdir(), 'siliu-screenshots');
    
    // 传输模式: 'file' | 'upload' | 'server'
    this.transferMode = options.transferMode || 'file';
    
    // 图床上传配置（用于 upload 模式）
    this.uploadProvider = options.uploadProvider || 'catbox';
    this.uploader = new ImageUploader({
      provider: this.uploadProvider,
      ...options.uploaderConfig
    });
    
    // 本地 HTTP 服务（用于 server 模式 - Tailscale/内网穿透）
    this.server = null;
    this.serverPort = options.serverPort || 0;
    this.tailscaleIp = options.tailscaleIp || null;  // Tailscale 分配的 IP
    
    this.ensureTempDir();
  }

  async ensureTempDir() {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (e) {
      console.error('[VisualContext] Failed to create temp dir:', e);
    }
  }

  /**
   * 启动截图 HTTP 服务（用于 Tailscale/内网穿透）
   */
  async startServer() {
    if (this.server) {
      return { port: this.server.port, token: this.server.authToken };
    }
    
    this.server = new ScreenshotServer({
      port: this.serverPort,
      screenshotDir: this.tempDir
    });
    
    const address = await this.server.start();
    
    // 显示访问信息
    console.log('[VisualContext] Screenshot server ready');
    console.log(`  Local: http://localhost:${address.port}`);
    if (this.tailscaleIp) {
      console.log(`  Tailscale: http://${this.tailscaleIp}:${address.port}`);
    }
    console.log(`  Token: ${this.server.authToken}`);
    
    return { port: address.port, token: this.server.authToken };
  }

  /**
   * 停止截图 HTTP 服务
   */
  async stopServer() {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  /**
   * 截图并保存为临时文件
   * @returns {Promise<{path: string, width: number, height: number, mimeType: string}>}
   */
  async captureToFile(webContents, options = {}) {
    const image = await webContents.capturePage(options.rect);
    const processed = this._processImage(image);
    
    // 保存到临时文件
    const timestamp = Date.now();
    const ext = this.format === 'jpeg' ? 'jpg' : 'png';
    const filename = `screenshot_${timestamp}.${ext}`;
    const filepath = path.join(this.tempDir, filename);
    
    await fs.writeFile(filepath, processed.buffer);
    
    return {
      path: filepath,
      width: processed.width,
      height: processed.height,
      mimeType: processed.mimeType,
      size: processed.buffer.length
    };
  }

  /**
   * 截图并返回 Base64（用于预览）
   */
  async captureToBase64(webContents, options = {}) {
    const image = await webContents.capturePage(options.rect);
    const processed = this._processImage(image);
    
    return {
      data: processed.buffer.toString('base64'),
      mimeType: processed.mimeType,
      width: processed.width,
      height: processed.height,
      size: processed.buffer.length
    };
  }

  _processImage(nativeImage) {
    // 1. 调整大小
    const size = nativeImage.getSize();
    let processed = nativeImage;
    
    if (size.width > this.maxWidth) {
      const ratio = this.maxWidth / size.width;
      processed = nativeImage.resize({
        width: Math.round(size.width * ratio),
        height: Math.round(size.height * ratio),
        quality: 'good'
      });
    }

    // 2. 转换为指定格式
    let buffer;
    let mimeType;
    
    if (this.format === 'jpeg') {
      buffer = processed.toJPEG(this.quality);
      mimeType = 'image/jpeg';
    } else {
      buffer = processed.toPNG();
      mimeType = 'image/png';
    }

    return {
      buffer,
      mimeType,
      width: processed.getSize().width,
      height: processed.getSize().height
    };
  }

  /**
   * 创建带元素标注的截图
   */
  async captureWithAnnotations(webContents, elements) {
    // 先获取普通截图
    const screenshot = await this.captureToFile(webContents);
    
    // TODO: 使用 canvas 在截图上绘制元素边框和编号
    // 这需要额外的图像处理库，可以先实现基础版
    
    return screenshot;
  }

  /**
   * 清理临时文件
   */
  async cleanup(filepath) {
    try {
      if (filepath && filepath.startsWith(this.tempDir)) {
        await fs.unlink(filepath);
        console.log('[VisualContext] Cleaned up:', filepath);
      }
    } catch (e) {
      // 忽略清理错误
    }
  }

  /**
   * 清理所有临时文件
   */
  async cleanupAll() {
    try {
      const files = await fs.readdir(this.tempDir);
      for (const file of files) {
        await fs.unlink(path.join(this.tempDir, file));
      }
      console.log('[VisualContext] Cleaned up all screenshots');
    } catch (e) {
      console.error('[VisualContext] Cleanup error:', e);
    }
  }

  /**
   * 获取 OpenClaw attachment 格式（本地文件）
   */
  toAttachment(screenshotInfo) {
    return {
      mime: screenshotInfo.mimeType,
      path: screenshotInfo.path
    };
  }

  /**
   * 截图并上传到图床（用于云端 OpenClaw）
   * @returns {Promise<{url: string, width: number, height: number, mimeType: string}>}
   */
  async captureAndUpload(webContents, options = {}) {
    const image = await webContents.capturePage(options.rect);
    const processed = this._processImage(image);
    
    console.log(`[VisualContext] Uploading screenshot to ${this.uploadProvider}...`);
    
    try {
      // 上传到图床
      const uploadResult = await this.uploader.upload(
        processed.buffer,
        `screenshot_${Date.now()}.jpg`
      );
      
      console.log(`[VisualContext] Upload successful: ${uploadResult.url}`);
      
      return {
        url: uploadResult.url,
        width: processed.width,
        height: processed.height,
        mimeType: processed.mimeType,
        provider: uploadResult.provider,
        expires: uploadResult.expires
      };
    } catch (err) {
      console.error('[VisualContext] Upload failed:', err.message);
      // 上传失败时回退到本地文件
      console.log('[VisualContext] Falling back to local file...');
      return this.captureToFile(webContents, options);
    }
  }

  /**
   * 截图并通过本地 HTTP 服务提供（用于 Tailscale/内网穿透）
   */
  async captureAndServe(webContents, options = {}) {
    // 确保 HTTP 服务已启动
    if (!this.server) {
      await this.startServer();
    }
    
    const image = await webContents.capturePage(options.rect);
    const processed = this._processImage(image);
    
    // 保存到临时文件
    const timestamp = Date.now();
    const ext = this.format === 'jpeg' ? 'jpg' : 'png';
    const filename = `screenshot_${timestamp}.${ext}`;
    const filepath = path.join(this.tempDir, filename);
    
    await fs.writeFile(filepath, processed.buffer);
    
    // 生成访问 URL
    const url = this.server.getScreenshotUrl(filename, this.tailscaleIp);
    
    console.log(`[VisualContext] Screenshot served: ${url}`);
    
    return {
      path: filepath,
      url: url,
      filename: filename,
      width: processed.width,
      height: processed.height,
      mimeType: processed.mimeType,
      token: this.server.authToken
    };
  }

  /**
   * 获取 OpenClaw attachment 格式（本地 HTTP URL）
   */
  toServerAttachment(screenshotInfo) {
    return {
      mime: screenshotInfo.mimeType,
      url: screenshotInfo.url  // 本地 HTTP URL (Tailscale 可访问)
    };
  }

  /**
   * 测试图床上传
   */
  async testUpload() {
    return this.uploader.testAll();
  }
}

module.exports = { VisualContextManager };
