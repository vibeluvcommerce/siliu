/**
 * ConfigManager - 统一配置管理
 * 集中管理所有模块配置，支持本地文件和内存存储
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { globalEventBus } = require('../core/event-bus');

const CONFIG_DIR = path.join(os.homedir(), '.siliu');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// 默认配置
const DEFAULT_CONFIG = {
  version: 1,
  serviceType: 'cloud', // 'cloud' | 'local'
  
  // 云端配置
  cloud: {
    apiEndpoint: 'https://api.siliu.ai/v1',
    apiKey: '',
    model: 'kimi-k2.5'
  },
  
  // 本地 OpenClaw 配置
  local: {
    url: 'ws://127.0.0.1:18789',
    token: '',
    sessionKey: 'agent:main:main'
  },
  
  // UI 配置
  ui: {
    theme: 'system', // 'light' | 'dark' | 'system'
    sidebarCollapsed: false,
    devTools: false
  },
  
  // 浏览器配置
  browser: {
    defaultUrl: 'https://www.google.com',
    blockAds: true,
    humanize: {
      enabled: true,
      minDelay: 300,
      maxDelay: 800,
      typeDelay: 50,
      scrollDelay: 200
    }
  },
  
  // Copilot 配置
  copilot: {
    maxSteps: 30,
    autoStart: false,
    enableThinking: true
  }
};

class ConfigManager {
  constructor() {
    this.config = null;
    this.watcher = null;
    this._load();
  }

  /**
   * 加载配置
   */
  _load() {
    try {
      // 确保配置目录存在
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }

      // 读取配置文件
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, 'utf8');
        const loaded = JSON.parse(data);
        this.config = this._mergeDeep(DEFAULT_CONFIG, loaded);
        console.log('[ConfigManager] Config loaded from', CONFIG_FILE);
      } else {
        this.config = { ...DEFAULT_CONFIG };
        this._save();
        console.log('[ConfigManager] Created default config at', CONFIG_FILE);
      }
    } catch (err) {
      console.error('[ConfigManager] Failed to load config:', err.message);
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  /**
   * 保存配置
   */
  _save() {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
      globalEventBus.emit('config:changed', this.config);
      return true;
    } catch (err) {
      console.error('[ConfigManager] Failed to save config:', err.message);
      return false;
    }
  }

  /**
   * 深度合并对象
   */
  _mergeDeep(target, source) {
    const output = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        output[key] = this._mergeDeep(output[key] || {}, source[key]);
      } else {
        output[key] = source[key];
      }
    }
    
    return output;
  }

  /**
   * 获取完整配置或指定路径配置
   * @param {string} path - 配置路径，如 'local.url' 或 'browser.humanize'
   */
  get(path = null) {
    if (!path) return { ...this.config };
    
    const keys = path.split('.');
    let value = this.config;
    
    for (const key of keys) {
      if (value && typeof value === 'object') {
        value = value[key];
      } else {
        return undefined;
      }
    }
    
    return value;
  }

  /**
   * 设置配置
   * @param {string} path - 配置路径
   * @param {*} value - 配置值
   */
  set(path, value) {
    const keys = path.split('.');
    let target = this.config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!target[key] || typeof target[key] !== 'object') {
        target[key] = {};
      }
      target = target[key];
    }
    
    const lastKey = keys[keys.length - 1];
    const oldValue = target[lastKey];
    target[lastKey] = value;
    
    // 触发特定配置变更事件
    globalEventBus.emit(`config:changed:${path}`, { path, value, oldValue });
    
    this._save();
    return true;
  }

  /**
   * 批量设置配置
   * @param {Object} updates - 配置更新对象
   */
  update(updates) {
    this.config = this._mergeDeep(this.config, updates);
    this._save();
    return true;
  }

  /**
   * 检查是否有有效配置
   */
  hasValidConfig() {
    const cloud = this.get('cloud');
    const local = this.get('local');
    
    const hasCloud = cloud?.apiKey && cloud.apiKey.length > 10;
    const hasLocal = local?.token && local.token.length > 0;
    
    return hasCloud || hasLocal;
  }

  /**
   * 获取配置文件路径
   */
  getConfigPath() {
    return CONFIG_FILE;
  }

  /**
   * 获取配置目录
   */
  getConfigDir() {
    return CONFIG_DIR;
  }

  /**
   * 重置为默认配置
   */
  reset() {
    this.config = { ...DEFAULT_CONFIG };
    this._save();
    globalEventBus.emit('config:reset', this.config);
  }

  /**
   * 订阅配置变更
   * @param {string} path - 配置路径
   * @param {Function} callback - 回调函数
   */
  onChange(path, callback) {
    return globalEventBus.on(`config:changed:${path}`, callback);
  }
}

module.exports = ConfigManager;
