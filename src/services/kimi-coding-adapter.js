// src/services/kimi-coding-adapter.js
// Kimi Coding API 适配器（使用 Anthropic Messages 格式）

const axios = require('axios');
const { globalEventBus } = require('../core/event-bus');

class KimiCodingAdapter {
  constructor(options = {}) {
    this.apiKey = options.apiKey;
    // Kimi Coding 使用 Anthropic 格式，端点不同
    this.baseUrl = options.baseUrl || 'https://api.kimi.com/coding';
    this.model = options.model || 'k2p5';
    this.messageCallbacks = [];
  }

  /**
   * 获取标准化的 baseUrl（确保不以 /v1 结尾，避免重复）
   */
  _getBaseUrl() {
    // 移除末尾的 /v1（如果用户已经添加了）
    return this.baseUrl.replace(/\/v1$/, '');
  }

  /**
   * 发送普通文本消息
   * 使用 Anthropic Messages API 格式
   */
  async sendMessage(message, options = {}) {
    const text = typeof message === 'string' ? message : message.text || message;
    const sessionKey = options.sessionKey || 'default';

    console.log('[KimiCodingAdapter] Sending message:', text.substring(0, 100) + '...');

    try {
      // 触发思考状态
      globalEventBus.emit('ai:thinking', { sessionKey });

      // Anthropic Messages API 格式
      const response = await axios.post(
        `${this._getBaseUrl()}/v1/messages`,
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
            'x-api-key': this.apiKey,  // Anthropic 使用 x-api-key
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'User-Agent': 'OpenClaw-Gateway/1.0'
          },
          timeout: 60000
        }
      );

      // Anthropic 响应格式不同
      const replyText = response.data.content?.[0]?.text || 
                       response.data.completion || 
                       'No response';
      
      console.log('[KimiCodingAdapter] Received response:', replyText.substring(0, 100) + '...');

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
          console.error('[KimiCodingAdapter] Callback error:', err);
        }
      });

      return { success: true };
    } catch (err) {
      console.error('[KimiCodingAdapter] API error:', err.message);
      
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
          console.error('[KimiCodingAdapter] Error callback error:', cbErr);
        }
      });

      throw err;
    }
  }

  /**
   * 发送多模态消息（支持图片）
   * Kimi Coding 支持图片输入
   */
  async sendMultimodalMessage(text, images, options = {}) {
    const sessionKey = options.sessionKey || 'default';
    
    console.log('[KimiCodingAdapter] Sending multimodal message:', text.substring(0, 100) + '...');

    try {
      // 触发思考状态
      globalEventBus.emit('ai:thinking', { sessionKey });

      // 构建内容数组
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
            type: 'image',
            source: {
              type: 'base64',
              media_type: image.mimeType || 'image/jpeg',
              data: image.data
            }
          });
        }
      }

      // 【调试日志】打印完整请求 payload
      const requestPayload = {
        model: this.model,
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: content
        }]
      };
      console.log('\n========== [DEBUG] Kimi API Request Payload ==========');
      // 截断图片数据以便阅读
      const debugPayload = JSON.parse(JSON.stringify(requestPayload));
      debugPayload.messages[0].content.forEach(item => {
        if (item.type === 'image' && item.source?.data) {
          item.source.data = `[Base64: ${item.source.data.length} chars]`;
        }
      });
      console.log(JSON.stringify(debugPayload, null, 2));
      console.log('========== [DEBUG] End Request Payload ==========\n');

      const response = await axios.post(
        `${this._getBaseUrl()}/v1/messages`,
        requestPayload,
        {
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'User-Agent': 'OpenClaw-Gateway/1.0'
          },
          timeout: 120000  // 多模态可能需要更长时间
        }
      );

      const replyText = response.data.content?.[0]?.text || 
                       response.data.completion || 
                       'No response';

      console.log('[KimiCodingAdapter] Received multimodal response:', replyText.substring(0, 100) + '...');

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
          console.error('[KimiCodingAdapter] Callback error:', err);
        }
      });

      return { success: true };
    } catch (err) {
      console.error('[KimiCodingAdapter] Multimodal API error:', err.message);
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
      console.log('[KimiCodingAdapter] Testing connection to:', `${this._getBaseUrl()}/v1/messages`);
      
      // 实际发送一个 messages 请求来验证模型
      await axios.post(
        `${this._getBaseUrl()}/v1/messages`,
        {
          model: this.model,
          max_tokens: 5,
          messages: [{ role: 'user', content: 'Hi' }]
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'User-Agent': 'OpenClaw-Gateway/1.0'
          },
          timeout: 10000
        }
      );
      
      console.log('[KimiCodingAdapter] Connection test successful, model:', this.model);
      return true;
    } catch (err) {
      console.error('[KimiCodingAdapter] Connection test failed:', err.message);
      if (err.response) {
        console.error('[KimiCodingAdapter] Response status:', err.response.status);
        console.error('[KimiCodingAdapter] Response data:', err.response.data);
      }
      return false;
    }
  }

  /**
   * 断开连接（清理资源）
   * @param {boolean} silent - 是否静默断开（不发送 toast）
   */
  disconnect(silent = false) {
    console.log('[KimiCodingAdapter] Disconnecting, silent:', silent);
    this.messageCallbacks = [];
    
    // 发送断开连接事件
    console.log('[KimiCodingAdapter] Emitting ai:disconnected');
    globalEventBus.emit('ai:disconnected', { service: 'Kimi' });
    
    // 非静默模式才发送 toast
    if (!silent) {
      console.log('[KimiCodingAdapter] Emitting ai:toast');
      globalEventBus.emit('ai:toast', {
        message: 'Siliu AI 云端服务 已断开',
        type: 'info'
      });
    }
    console.log('[KimiCodingAdapter] Events emitted');
  }
}

module.exports = { KimiCodingAdapter };