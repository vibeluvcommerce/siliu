// src/services/image-uploader.js
// 统一图片上传适配器 - 支持多种免费图床

const axios = require('axios');
const FormData = require('form-data');

class ImageUploader {
  constructor(config = {}) {
    this.provider = config.provider || 'catbox';  // catbox | smms | imgur | oxo
    this.config = config;
  }

  async upload(buffer, filename = 'screenshot.jpg') {
    switch (this.provider) {
      case 'catbox':
        return this._uploadCatbox(buffer, filename);
      case 'smms':
        return this._uploadSmms(buffer, filename);
      case 'imgur':
        return this._uploadImgur(buffer, filename);
      case 'oxo':
        return this._uploadOxo(buffer, filename);
      default:
        throw new Error(`Unknown provider: ${this.provider}`);
    }
  }

  // Catbox.moe - 无需注册，永久保存
  async _uploadCatbox(buffer, filename) {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', buffer, {
      filename,
      contentType: 'image/jpeg'
    });

    const response = await axios.post('https://catbox.moe/user/api.php', form, {
      headers: form.getHeaders(),
      timeout: 30000,
      maxBodyLength: 200 * 1024 * 1024
    });

    return {
      url: response.data.trim(),
      provider: 'catbox',
      expires: null,
      deleteUrl: null
    };
  }

  // SM.MS - 需要 API Token，5张/天
  async _uploadSmms(buffer, filename) {
    if (!this.config.smmsToken) {
      throw new Error('SM.MS token required');
    }

    const form = new FormData();
    form.append('smfile', buffer, { filename, contentType: 'image/jpeg' });

    const response = await axios.post('https://sm.ms/api/v2/upload', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': this.config.smmsToken
      },
      timeout: 30000
    });

    if (!response.data.success) {
      throw new Error(response.data.message);
    }

    return {
      url: response.data.data.url,
      provider: 'smms',
      expires: null,
      deleteUrl: response.data.data.delete
    };
  }

  // Imgur - 需要 Client ID，1250张/天
  async _uploadImgur(buffer, filename) {
    if (!this.config.imgurClientId) {
      throw new Error('Imgur Client ID required');
    }

    const base64 = buffer.toString('base64');

    const response = await axios.post('https://api.imgur.com/3/image', {
      image: base64,
      type: 'base64',
      name: filename
    }, {
      headers: {
        'Authorization': `Client-ID ${this.config.imgurClientId}`
      },
      timeout: 30000
    });

    return {
      url: response.data.data.link,
      provider: 'imgur',
      expires: null,
      deleteHash: response.data.data.deletehash
    };
  }

  // 0x0.st - 无需注册，30天+
  async _uploadOxo(buffer, filename) {
    const form = new FormData();
    form.append('file', buffer, { filename, contentType: 'image/jpeg' });
    form.append('expires', '1w');  // 1周后过期

    const response = await axios.post('https://0x0.st', form, {
      headers: form.getHeaders(),
      timeout: 30000
    });

    return {
      url: response.data.trim(),
      provider: '0x0',
      expires: '7 days'
    };
  }

  // 测试所有可用图床
  async testAll() {
    const testBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    
    const results = [];
    
    // Test Catbox (always works)
    try {
      const result = await this._uploadCatbox(testBuffer, 'test.jpg');
      results.push({ provider: 'catbox', status: 'ok', url: result.url });
    } catch (e) {
      results.push({ provider: 'catbox', status: 'error', error: e.message });
    }

    // Test 0x0
    try {
      const result = await this._uploadOxo(testBuffer, 'test.jpg');
      results.push({ provider: '0x0', status: 'ok', url: result.url });
    } catch (e) {
      results.push({ provider: '0x0', status: 'error', error: e.message });
    }

    return results;
  }
}

module.exports = { ImageUploader };
