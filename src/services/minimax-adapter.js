// src/services/minimax-adapter.js
// MiniMax 适配器（使用 OpenAI 兼容格式）

const axios = require('axios');
const { globalEventBus } = require('../core/event-bus');

class MinimaxAdapter {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    // MiniMax 使用 OpenAI 兼容格式
    this.baseUrl = options.baseUrl || 'https://api.minimaxi.com/v1';
    this.model = options.model || 'MiniMax-M2.7-highspeed';
    this.messageCallbacks = [];
  }

  /**
   * 获取标准化的 baseUrl
   */
  _getBaseUrl() {
    // 移除末尾的斜杠（如果用户已经添加了）
    return this.baseUrl.replace(/\/$/, '');
  }

  /**
   * 发送普通文本消息
   * 使用 OpenAI 兼容 API 格式
   */
  async sendMessage(message, options = {}) {
    const text = typeof message === 'string' ? message : message.text || message;
    const sessionKey = options.sessionKey || 'default';

    console.log('[MinimaxAdapter] Sending message:', text.substring(0, 100) + '...');

    try {
      // 触发思考状态
      globalEventBus.emit('ai:thinking', { sessionKey });

      // OpenAI 兼容 API 格式
      const response = await axios.post(
        `${this._getBaseUrl()}/chat/completions`,
        {
          model: this.model,
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: text
          }]
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        }
      );

      // OpenAI 格式响应
      const replyText = response.data.choices?.[0]?.message?.content || 'No response';
      
      console.log('[MinimaxAdapter] Received response:', replyText.substring(0, 100) + '...');

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
          console.error('[MinimaxAdapter] Callback error:', err);
        }
      });

      return { success: true };
    } catch (err) {
      console.error('[MinimaxAdapter] API error:', err.message);
      
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
          console.error('[MinimaxAdapter] Error callback error:', cbErr);
        }
      });

      throw err;
    }
  }

  /**
   * 发送多模态消息（支持图片）
   * MiniMax 支持图片输入（OpenAI 兼容格式）
   */
  async sendMultimodalMessage(text, images, options = {}) {
    const sessionKey = options.sessionKey || 'default';
    
    console.log('[MinimaxAdapter] Sending multimodal message:', text.substring(0, 100) + '...');

    try {
      // 触发思考状态
      globalEventBus.emit('ai:thinking', { sessionKey });

      // 构建内容数组（OpenAI 格式）
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
              url: `data:${image.mimeType || 'image/jpeg'};base64,${image.data}`
            }
          });
        }
      }

      const requestPayload = {
        model: this.model,
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: content
        }]
      };

      const response = await axios.post(
        `${this._getBaseUrl()}/chat/completions`,
        requestPayload,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 120000
        }
      );

      // OpenAI 格式响应
      const replyText = response.data.choices?.[0]?.message?.content || 'No response';

      console.log('[MinimaxAdapter] Received multimodal response:', replyText.substring(0, 100) + '...');

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
          console.error('[MinimaxAdapter] Callback error:', err);
        }
      });

      return { success: true };
    } catch (err) {
      console.error('[MinimaxAdapter] Multimodal API error:', err.message);
      throw err;
    }
  }

  /**
   * 注册消息回调
   */
  onMessage(callback) {
    this.messageCallbacks.push(callback);
    return () => {
      this.messageCallbacks = this.messageCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * 测试连接 - 实际发送请求验证模型是否可用
   */
  async checkConnection() {
    try {
      console.log('[MinimaxAdapter] Testing connection to:', `${this._getBaseUrl()}/chat/completions`);
      
      // 实际发送一个 chat completions 请求来验证模型
      await axios.post(
        `${this._getBaseUrl()}/chat/completions`,
        {
          model: this.model,
          max_tokens: 5,
          messages: [{ role: 'user', content: 'Hi' }]
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      
      console.log('[MinimaxAdapter] Connection test successful, model:', this.model);
      return true;
    } catch (err) {
      console.error('[MinimaxAdapter] Connection test failed:', err.message);
      if (err.response) {
        console.error('[MinimaxAdapter] Response status:', err.response.status);
        console.error('[MinimaxAdapter] Response data:', err.response.data);
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

module.exports = { MinimaxAdapter };
