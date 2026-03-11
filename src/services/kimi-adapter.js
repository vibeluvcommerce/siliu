// src/services/kimi-adapter.js
// Kimi API 直连适配器（绕过 OpenClaw 网关）

const axios = require('axios');
const { globalEventBus } = require('../core/event-bus');

class KimiAdapter {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    // 支持普通 Moonshot API 和 Kimi for Coding API
    this.baseUrl = options.baseUrl || 'https://api.moonshot.cn/v1';
    this.model = options.model || 'kimi-k2.5';
    this.messageCallbacks = [];
    // 检测是否为 Coding 端点
    this.isCodingEndpoint = this.baseUrl.includes('kimi.com/coding');
  }

  /**
   * 获取标准化的 baseUrl（确保以 /v1 结尾）
   */
  _getBaseUrl() {
    let baseUrl = this.baseUrl;
    if (!baseUrl.endsWith('/v1')) {
      baseUrl = baseUrl.replace(/\/$/, '') + '/v1';
    }
    return baseUrl;
  }

  /**
   * 发送普通文本消息
   * 触发 onMessage 回调返回结果
   */
  async sendMessage(message, options = {}) {
    const text = typeof message === 'string' ? message : message.text || message;
    const sessionKey = options.sessionKey || 'default';

    console.log('[KimiAdapter] Sending message:', text.substring(0, 100) + '...');

    try {
      // 触发思考状态
      globalEventBus.emit('ai:thinking', { sessionKey });

      const response = await axios.post(
        `${this._getBaseUrl()}/chat/completions`,
        {
          model: this.model,
          messages: [{
            role: 'user',
            content: text
          }],
          stream: false
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': this.isCodingEndpoint ? 'OpenClaw-Gateway/1.0' : 'Siliu-Browser/1.0'
          },
          timeout: 60000
        }
      );

      const replyText = response.data.choices[0].message.content;
      
      console.log('[KimiAdapter] Received response:', replyText.substring(0, 100) + '...');

      // 触发消息回调
      const messageData = {
        type: 'message',
        payload: {
          sessionKey,
          message: {
            role: 'assistant',
            content: replyText
          }
        }
      };

      // 调用所有注册的回调
      this.messageCallbacks.forEach(callback => {
        try {
          callback(messageData);
        } catch (err) {
          console.error('[KimiAdapter] Callback error:', err);
        }
      });

      return { success: true };
    } catch (err) {
      console.error('[KimiAdapter] API error:', err.message);
      
      // 触发错误回调
      const errorData = {
        type: 'error',
        payload: {
          sessionKey,
          error: err.message
        }
      };

      this.messageCallbacks.forEach(callback => {
        try {
          callback(errorData);
        } catch (cbErr) {
          console.error('[KimiAdapter] Error callback error:', cbErr);
        }
      });

      throw err;
    }
  }

  /**
   * 发送多模态消息（支持图片）
   */
  async sendMultimodalMessage(text, images, options = {}) {
    const sessionKey = options.sessionKey || 'default';
    
    // 构建消息内容
    const content = [];
    
    // 添加文本
    content.push({
      type: 'text',
      text: text
    });
    
    // 添加图片（Base64 格式）
    if (images && images.length > 0) {
      for (const image of images) {
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${image.mimeType};base64,${image.data}`
          }
        });
      }
    }

    try {
      // 触发思考状态
      globalEventBus.emit('ai:thinking', { sessionKey });

      const response = await axios.post(
        `${this._getBaseUrl()}/chat/completions`,
        {
          model: this.model,
          messages: [{
            role: 'user',
            content: content
          }],
          stream: false
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': this.isCodingEndpoint ? 'OpenClaw-Gateway/1.0' : 'Siliu-Browser/1.0'
          },
          timeout: 120000  // 多模态可能需要更长时间
        }
      );

      const replyText = response.data.choices[0].message.content;

      // 触发消息回调
      const messageData = {
        type: 'message',
        payload: {
          sessionKey,
          message: {
            role: 'assistant',
            content: replyText
          }
        }
      };

      this.messageCallbacks.forEach(callback => {
        try {
          callback(messageData);
        } catch (err) {
          console.error('[KimiAdapter] Callback error:', err);
        }
      });

      return { success: true };
    } catch (err) {
      console.error('[KimiAdapter] API error:', err.message);
      throw err;
    }
  }

  /**
   * 注册消息回调
   * Kimi API 是请求-响应模式，这里模拟 WebSocket 的 onMessage 接口
   */
  onMessage(callback) {
    this.messageCallbacks.push(callback);
    
    // 返回取消订阅函数
    return () => {
      const index = this.messageCallbacks.indexOf(callback);
      if (index > -1) {
        this.messageCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * 检查连接状态 - 实际发送请求验证模型是否可用
   */
  async checkConnection() {
    try {
      const baseUrl = this._getBaseUrl();
      console.log('[KimiAdapter] Testing connection to:', `${baseUrl}/chat/completions`);
      
      // 实际发送一个 chat 请求来验证模型
      await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model: this.model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': this.isCodingEndpoint ? 'OpenClaw-Gateway/1.0' : 'Siliu-Browser/1.0'
          },
          timeout: 10000
        }
      );
      
      console.log('[KimiAdapter] Connection test successful, model:', this.model);
      return true;
    } catch (err) {
      console.error('[KimiAdapter] Connection test failed:', err.message);
      if (err.response) {
        console.error('[KimiAdapter] Response status:', err.response.status);
        console.error('[KimiAdapter] Response data:', err.response.data);
      }
      return false;
    }
  }

  /**
   * 断开连接（清理资源）
   */
  disconnect() {
    this.messageCallbacks = [];
  }
}

module.exports = { KimiAdapter };