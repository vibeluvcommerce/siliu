// src/siliu-controller/cdp-manager.js
// CDP (Chrome DevTools Protocol) 连接管理器

const WebSocket = require('ws');
const http = require('http');
const { EventEmitter } = require('events');

class CDPManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.debugPort = options.debugPort || 9223;
    this.ws = null;
    this.sessionId = null;
    this.commandId = 0;
    this.pendingCommands = new Map();
    this.domains = new Set();
    this.isConnected = false;
    this.targetId = null;
  }

  /**
   * 获取可用的调试目标列表
   */
  async listTargets() {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${this.debugPort}/json/list`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * 连接到指定目标（带重试）
   */
  async connect(targetFilter = null, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this._doConnect(targetFilter);
      } catch (err) {
        if (attempt === maxRetries) {
          throw err;
        }
        console.log(`[CDPManager] Connection attempt ${attempt} failed, retrying...`);
        await this._sleep(1000 * attempt);
      }
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 实际连接逻辑
   */
  async _doConnect(targetFilter) {
    try {
      // 获取目标列表
      const targets = await this.listTargets();

      // 选择目标
      let target;
      if (typeof targetFilter === 'function') {
        target = targets.find(targetFilter);
      } else if (typeof targetFilter === 'string') {
        target = targets.find(t => t.id === targetFilter || t.url.includes(targetFilter));
      } else {
        // 默认选择第一个非devtools页面
        target = targets.find(t => !t.url.includes('devtools') && t.type === 'page');
      }

      if (!target) {
        throw new Error('No suitable target found');
      }

      this.targetId = target.id;
      console.log('[CDPManager] Connecting to target:', target.title || target.url);

      // 建立 WebSocket 连接
      this.ws = new WebSocket(target.webSocketDebuggerUrl);

      await new Promise((resolve, reject) => {
        this.ws.on('open', () => {
          console.log('[CDPManager] WebSocket connected');
          this.isConnected = true;
          resolve();
        });
        this.ws.on('error', reject);
      });

      // 设置消息处理器
      this._setupMessageHandler();

      // 启用必要的域
      await this.enableDomain('Page');
      await this.enableDomain('Runtime');
      await this.enableDomain('DOM');
      // Input 域在某些版本中不存在，忽略错误
      try {
        await this.enableDomain('Input');
      } catch (e) {
        console.log('[CDPManager] Input domain not available, skipping');
      }

      this.emit('connected', { target });
      return { success: true, target };

    } catch (err) {
      console.error('[CDPManager] Connection failed:', err.message);
      throw err;
    }
  }

  /**
   * 设置消息处理器
   */
  _setupMessageHandler() {
    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);

        // 处理命令响应
        if (msg.id !== undefined && this.pendingCommands.has(msg.id)) {
          const { resolve, reject } = this.pendingCommands.get(msg.id);
          this.pendingCommands.delete(msg.id);

          if (msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg.result);
          }
        }

        // 处理事件
        if (msg.method) {
          this.emit('event', msg);
          this.emit(msg.method, msg.params);
        }

      } catch (e) {
        console.error('[CDPManager] Message parse error:', e);
      }
    });

    this.ws.on('close', () => {
      console.log('[CDPManager] WebSocket closed');
      this.isConnected = false;

      // 拒绝所有挂起的命令
      for (const [id, { reject }] of this.pendingCommands) {
        reject(new Error('Connection closed'));
      }
      this.pendingCommands.clear();

      this.emit('disconnected');
      
      // 不重连，由 SiliuController 控制重连
    });

    this.ws.on('error', (err) => {
      console.error('[CDPManager] WebSocket error:', err);
      this.emit('error', err);
    });
  }

  /**
   * 发送 CDP 命令
   */
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected || !this.ws) {
        reject(new Error('Not connected'));
        return;
      }

      this.commandId++;
      const id = this.commandId;

      this.pendingCommands.set(id, { resolve, reject });

      const message = JSON.stringify({ id, method, params });
      this.ws.send(message);

      // 设置超时
      setTimeout(() => {
        if (this.pendingCommands.has(id)) {
          this.pendingCommands.delete(id);
          reject(new Error(`Command timeout: ${method}`));
        }
      }, 30000);
    });
  }

  /**
   * 启用 CDP 域
   */
  async enableDomain(domain) {
    if (this.domains.has(domain)) return;

    await this.send(`${domain}.enable`);
    this.domains.add(domain);
    console.log(`[CDPManager] Domain enabled: ${domain}`);
  }

  /**
   * 禁用 CDP 域
   */
  async disableDomain(domain) {
    if (!this.domains.has(domain)) return;

    await this.send(`${domain}.disable`);
    this.domains.delete(domain);
    console.log(`[CDPManager] Domain disabled: ${domain}`);
  }

  /**
   * 等待页面加载完成
   */
  async waitForLoad(timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Load timeout'));
      }, timeout);

      const onLoad = () => {
        cleanup();
        resolve({ success: true });
      };

      const onDisconnect = () => {
        cleanup();
        reject(new Error('Connection closed while waiting for load'));
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.off('Page.loadEventFired', onLoad);
        this.off('disconnected', onDisconnect);
      };

      this.once('Page.loadEventFired', onLoad);
      this.once('disconnected', onDisconnect);
    });
  }

  /**
   * 等待网络空闲
   */
  async waitForNetworkIdle(timeout = 5000, idleTime = 500) {
    let idleTimer = null;
    let requestCount = 0;

    return new Promise((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        cleanup();
        resolve({ success: true, reason: 'timeout' });
      }, timeout);

      const onRequest = () => {
        requestCount++;
        clearTimeout(idleTimer);
      };

      const onResponse = () => {
        requestCount--;
        if (requestCount === 0) {
          idleTimer = setTimeout(() => {
            cleanup();
            resolve({ success: true, reason: 'idle' });
          }, idleTime);
        }
      };

      const cleanup = () => {
        clearTimeout(timeoutTimer);
        clearTimeout(idleTimer);
        this.off('Network.requestWillBeSent', onRequest);
        this.off('Network.responseReceived', onResponse);
      };

      this.on('Network.requestWillBeSent', onRequest);
      this.on('Network.responseReceived', onResponse);
    });
  }

  /**
   * 执行 JavaScript
   */
  async evaluate(expression, options = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: options.returnByValue !== false,
      awaitPromise: options.awaitPromise || false,
      timeout: options.timeout || 5000
    });

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'Script error');
    }

    return result.result;
  }

  /**
   * 断开连接
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.domains.clear();
    this.pendingCommands.clear();
  }
}

module.exports = CDPManager;
