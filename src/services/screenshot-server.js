// src/services/screenshot-server.js
// 本地截图 HTTP 服务 - 用于 Tailscale/内网穿透访问

const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class ScreenshotServer {
  constructor(options = {}) {
    this.port = options.port || 0;  // 0 = 随机端口
    this.screenshotDir = options.screenshotDir || '/tmp/siliu-screenshots';
    this.authToken = options.authToken || this._generateToken();
    this.server = null;
    this.accessLog = new Map();  // 记录访问日志
  }

  _generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  async start() {
    this.server = http.createServer(async (req, res) => {
      // 启用 CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET');

      // 解析 URL
      const url = new URL(req.url, `http://${req.headers.host}`);
      
      // 验证 Token
      const token = url.searchParams.get('token');
      if (token !== this.authToken) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('Unauthorized');
        return;
      }

      // 只允许 GET 请求
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
      }

      // 解析文件路径
      const filename = path.basename(url.pathname);
      if (!filename || filename.includes('..')) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid filename');
        return;
      }

      const filepath = path.join(this.screenshotDir, filename);

      try {
        // 读取文件
        const data = await fs.readFile(filepath);
        
        // 记录访问日志
        this.accessLog.set(filename, {
          ip: req.socket.remoteAddress,
          time: new Date().toISOString(),
          userAgent: req.headers['user-agent']
        });

        // 设置内容类型
        const ext = path.extname(filename).toLowerCase();
        const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';

        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff'
        });
        res.end(data);

        console.log(`[ScreenshotServer] Served: ${filename} to ${req.socket.remoteAddress}`);
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
      }
    });

    return new Promise((resolve, reject) => {
      this.server.listen(this.port, '0.0.0.0', () => {
        const address = this.server.address();
        this.port = address.port;
        console.log(`[ScreenshotServer] Started on port ${this.port}`);
        console.log(`[ScreenshotServer] Auth token: ${this.authToken}`);
        resolve(address);
      });

      this.server.on('error', reject);
    });
  }

  /**
   * 获取截图的完整 URL
   */
  getScreenshotUrl(filename, tailscaleIp) {
    // 如果使用 Tailscale，使用 Tailscale IP
    // 否则使用公网 IP 或域名
    const host = tailscaleIp || 'localhost';
    return `http://${host}:${this.port}/${filename}?token=${this.authToken}`;
  }

  /**
   * 停止服务
   */
  stop() {
    if (this.server) {
      this.server.close();
      console.log('[ScreenshotServer] Stopped');
    }
  }

  /**
   * 获取访问日志
   */
  getAccessLog() {
    return Array.from(this.accessLog.entries());
  }
}

module.exports = { ScreenshotServer };
