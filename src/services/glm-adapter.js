// src/services/glm-adapter.js
// 智谱 GLM-4V 适配器 - 原生支持多模态图像识别

const axios = require('axios');
const { globalEventBus } = require('../core/event-bus');

class GLMAdapter {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl || 'https://open.bigmodel.cn/api/paas/v4';
    this.model = options.model || 'glm-4.6v';
    this.messageCallbacks = [];
  }

  /**
   * 获取标准化的 baseUrl
   */
  _getBaseUrl() {
    return this.baseUrl.replace(/\/$/, '');
  }

  /**
   * 发送普通文本消息
   */
  async sendMessage(message, options = {}) {
    const text = typeof message === 'string' ? message : message.text || message;
    const sessionKey = options.sessionKey || 'default';

    console.log('[GLMAdapter] Sending message:', text.substring(0, 100) + '...');

    try {
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
            'User-Agent': 'Siliu-Browser/1.0'
          },
          timeout: 60000
        }
      );

      const replyText = response.data.choices[0].message.content;
      
      console.log('[GLMAdapter] Received response:', replyText.substring(0, 100) + '...');

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
          console.error('[GLMAdapter] Callback error:', err);
        }
      });

      return { success: true };
    } catch (err) {
      console.error('[GLMAdapter] API error:', err.message);
      
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
          console.error('[GLMAdapter] Error callback error:', cbErr);
        }
      });

      throw err;
    }
  }

  /**
   * 发送多模态消息（支持图片）
   * GLM-4V 原生支持图像理解
   */
  async sendMultimodalMessage(text, images, options = {}) {
    const sessionKey = options.sessionKey || 'default';
    
    console.log('[GLMAdapter] Sending multimodal message:', text.substring(0, 100) + '...');

    try {
      globalEventBus.emit('ai:thinking', { sessionKey });

      // 构建消息内容 - OpenAI 兼容格式
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

      // 【调试日志】打印请求
      console.log('\n========== [DEBUG] GLM API Request ==========');
      console.log('Model:', this.model);
      console.log('Images count:', images?.length || 0);
      console.log('============================================\n');

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
            'User-Agent': 'Siliu-Browser/1.0'
          },
          timeout: 120000  // 多模态可能需要更长时间
        }
      );

      const replyText = response.data.choices[0].message.content;
      
      console.log('[GLMAdapter] Received multimodal response:', replyText.substring(0, 100) + '...');

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
          console.error('[GLMAdapter] Callback error:', err);
        }
      });

      return { success: true };
    } catch (err) {
      console.error('[GLMAdapter] Multimodal API error:', err.message);
      if (err.response) {
        console.error('[GLMAdapter] Response status:', err.response.status);
        console.error('[GLMAdapter] Response data:', err.response.data);
      }
      
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
          console.error('[GLMAdapter] Error callback error:', cbErr);
        }
      });

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
   * 测试连接
   */
  async checkConnection() {
    try {
      console.log('[GLMAdapter] Testing connection to:', `${this._getBaseUrl()}/chat/completions`);
      
      await axios.post(
        `${this._getBaseUrl()}/chat/completions`,
        {
          model: this.model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      
      console.log('[GLMAdapter] Connection test successful, model:', this.model);
      return true;
    } catch (err) {
      console.error('[GLMAdapter] Connection test failed:', err.message);
      if (err.response) {
        console.error('[GLMAdapter] Response status:', err.response.status);
        console.error('[GLMAdapter] Response data:', err.response.data);
      }
      return false;
    }
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.messageCallbacks = [];
  }
}

module.exports = { GLMAdapter };
