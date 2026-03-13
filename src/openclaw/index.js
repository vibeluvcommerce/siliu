/**
 * Module 1: OpenClaw
 * 连接本地或云端 OpenClaw 服务
 */

const WebSocket = require('ws');

class OpenClawModule {
  constructor(options = {}) {
    this.opts = {
      url: options.url || 'ws://127.0.0.1:18789',
      token: options.token || '',
      sessionKey: options.sessionKey || 'agent:main:main',
      onHello: options.onHello || (() => {}),
      onClose: options.onClose || (() => {}),
      onEvent: options.onEvent || (() => {}),
      autoReconnect: options.autoReconnect !== false // 默认启用自动重连
    };
    
    this.ws = null;
    this.connected = false;
    this.connecting = false;
    this.pending = new Map();
    this.requestId = 1;
    this.connectSent = false;
    this.closed = false;
    this.backoffMs = 800;
    this.reconnectTimer = null;
    this.connectResolve = null;
    this.connectReject = null;
    this.connectTimeout = null;
  }

  /**
   * 连接到 OpenClaw
   */
  async connect() {
    // 如果已经连接，直接返回
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      console.log('[OpenClaw] Already connected');
      return { server: { version: 'dev' } };
    }

    // 重置关闭标记（允许新连接）
    this.closed = false;

    // 如果正在连接中，返回现有 Promise
    if (this.connecting) {
      console.log('[OpenClaw] Already connecting...');
      return new Promise((resolve, reject) => {
        const check = () => {
          if (this.connected) {
            resolve({ server: { version: 'dev' } });
          } else if (this.closed) {
            reject(new Error('Connection closed'));
          } else {
            setTimeout(check, 100);
          }
        };
        check();
      });
    }

    return new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      
      // 设置连接超时（3秒）
      this.connectTimeout = setTimeout(() => {
        if (!this.connected && this.connecting) {
          console.log('[OpenClaw] Connection timeout (3s)');
          this.closed = true; // 标记为关闭，阻止重连
          this.connecting = false;
          if (this.ws) {
            this.ws.terminate();
            this.ws = null;
          }
          reject(new Error('Connection timeout'));
          this.connectResolve = null;
          this.connectReject = null;
        }
      }, 3000);
      
      this.doConnect();
    });
  }

  /**
   * 执行连接
   */
  doConnect() {
    // 如果已关闭，不再连接
    if (this.closed) {
      console.log('[OpenClaw] Connection closed, skipping doConnect');
      return;
    }
    
    // 如果已有连接且是 OPEN 状态，跳过
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[OpenClaw] Already connected, skipping doConnect');
      return;
    }

    this.connecting = true;
    this.connectSent = false;

    console.log('[OpenClaw] Connecting to', this.opts.url);
    
    try {
      this.ws = new WebSocket(this.opts.url, {
        headers: {
          'Origin': 'http://localhost'
        }
      });

      this.ws.on('open', () => {
        console.log('[OpenClaw] WebSocket opened, waiting for challenge...');
      });

      this.ws.on('message', (data) => {
        this.handleMessage(String(data || ''));
      });

      this.ws.on('close', (code, reason) => {
        console.log('[OpenClaw] Closed:', code, reason?.toString());
        this.ws = null;
        this.connected = false;
        this.connecting = false;
        this.connectSent = false;
        
        // 清理 pending
        this.flushPending(new Error(`Connection closed: ${code}`));
        
        // 触发关闭回调
        this.opts.onClose({ code, reason: String(reason || '') });

        // 连接失败时 reject
        if (this.connectReject && !this.connected) {
          this.connectReject(new Error(`Connection failed: ${code}`));
          this.connectResolve = null;
          this.connectReject = null;
        }

        // 自动重连（如果不是主动断开且启用了自动重连）
        if (!this.closed && this.opts.autoReconnect) {
          console.log('[OpenClaw] Reconnecting in', this.backoffMs, 'ms...');
          this.reconnectTimer = setTimeout(() => {
            this.doConnect();
          }, this.backoffMs);
          this.backoffMs = Math.min(this.backoffMs * 1.5, 30000);
        } else if (!this.opts.autoReconnect && !this.connected) {
          console.log('[OpenClaw] Auto reconnect disabled, marking as closed');
          this.closed = true;
        }
      });

      this.ws.on('error', (err) => {
        console.error('[OpenClaw] Error:', err.message);
      });

    } catch (err) {
      console.error('[OpenClaw] Failed to create WebSocket:', err.message);
      this.connecting = false;
      if (this.connectReject) {
        this.connectReject(err);
        this.connectResolve = null;
        this.connectReject = null;
      }
    }
  }

  /**
   * 发送连接认证
   */
  sendConnect() {
    if (this.connectSent) return;
    this.connectSent = true;

    const id = String(this.requestId++);
    const scopes = ['operator.admin', 'operator.approvals', 'operator.pairing'];
    
    const msg = {
      type: 'req',
      id,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'openclaw-control-ui',
          version: '2.0.0',
          platform: process.platform || 'linux',
          mode: 'webchat',
          instanceId: require('crypto').randomUUID(),
        },
        role: 'operator',
        scopes,
        caps: [],
        auth: { token: this.opts.token },
        userAgent: 'Siliu-Browser/2.0.0',
        locale: 'zh-CN',
      }
    };

    console.log('[OpenClaw] Sending connect, id:', id);

    this.pending.set(id, {
      resolve: (result) => {
        console.log('[OpenClaw] Connected!');
        // 清除连接超时
        if (this.connectTimeout) {
          clearTimeout(this.connectTimeout);
          this.connectTimeout = null;
        }
        this.backoffMs = 800;
        this.connected = true;
        this.connecting = false;
        this.closed = false;
        
        if (this.connectResolve) {
          this.connectResolve(result);
          this.connectResolve = null;
          this.connectReject = null;
        }
        this.opts.onHello(result);
      },
      reject: (err) => {
        console.error('[OpenClaw] Connect failed:', err.message);
        // 清除连接超时
        if (this.connectTimeout) {
          clearTimeout(this.connectTimeout);
          this.connectTimeout = null;
        }
        if (this.connectReject) {
          this.connectReject(err);
          this.connectResolve = null;
          this.connectReject = null;
        }
        this.ws?.close();
      }
    });

    this.ws.send(JSON.stringify(msg));
  }

  /**
   * 处理消息
   */
  handleMessage(text) {
    try {
      const msg = JSON.parse(text);

      // 处理 challenge
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        console.log('[OpenClaw] Got challenge');
        this.sendConnect();
        return;
      }

      // 处理响应
      if (msg.type === 'res') {
        const pending = this.pending.get(msg.id);
        if (pending) {
          this.pending.delete(msg.id);
          if (msg.ok) {
            pending.resolve(msg.payload);
          } else {
            pending.reject(new Error(msg.error?.message || 'Request failed'));
          }
        }
        return;
      }

      // 处理事件
      if (msg.type === 'event') {
        this.opts.onEvent(msg);
      }
    } catch (err) {
      console.error('[OpenClaw] Message error:', err);
    }
  }

  /**
   * 清理 pending 请求
   */
  flushPending(err) {
    for (const [, pending] of this.pending) {
      pending.reject(err);
    }
    this.pending.clear();
  }

  /**
   * 发送消息（支持 attachments）
   */
  async sendMessage(text, options = {}) {
    if (!this.connected) {
      throw new Error('Not connected');
    }

    const params = {
      sessionKey: options.sessionKey || this.opts.sessionKey,
      deliver: true,
      idempotencyKey: require('crypto').randomUUID()
    };

    // 支持多模态 content 格式（如果传入的是对象）
    if (typeof text === 'object' && text.content) {
      params.message = text;
    } else {
      params.message = text;
    }

    // 支持 attachments
    if (options.attachments && options.attachments.length > 0) {
      params.attachments = options.attachments;
    }

    // 【调试日志】打印发送给 OpenClaw 的消息
    console.log('\n========== [DEBUG] OpenClaw SendMessage ==========');
    console.log('SessionKey:', params.sessionKey);
    console.log('Message length:', typeof params.message === 'string' ? params.message.length : JSON.stringify(params.message).length);
    console.log('Has attachments:', !!params.attachments && params.attachments.length > 0);
    if (params.attachments && params.attachments.length > 0) {
      params.attachments.forEach((att, i) => {
        console.log(`  Attachment[${i}]:`, { mime: att.mime, url: att.url, path: att.path });
      });
    }
    console.log('========== [DEBUG] End OpenClaw SendMessage ==========\n');

    return this.request('chat.send', params);
  }

  /**
   * 获取历史消息
   */
  async getHistory(limit = 50) {
    if (!this.connected) {
      throw new Error('Not connected');
    }

    return this.request('chat.history', {
      sessionKey: this.opts.sessionKey,
      limit
    });
  }

  /**
   * 通用请求
   */
  request(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const id = String(this.requestId++);
      const msg = { type: 'req', id, method, params };

      this.pending.set(id, { resolve, reject });
      
      try {
        this.ws.send(JSON.stringify(msg));
      } catch (err) {
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  /**
   * 断开连接
   */
  disconnect() {
    // 立即标记为关闭，阻止任何重连
    this.closed = true;
    
    // 清除重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // 关闭 WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.connected = false;
    this.connecting = false;
    this.connectSent = false;
    
    this.flushPending(new Error('Disconnected'));
  }

  /**
   * 获取连接状态
   */
  getStatus() {
    return {
      connected: this.connected,
      connecting: this.connecting,
      url: this.opts.url
    };
  }
}

module.exports = OpenClawModule;
