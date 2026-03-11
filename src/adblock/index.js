/**
 * Module 5: AdBlock Extension
 * 广告拦截 - 页面加载完成后显示统计
 */

const { session, webContents } = require('electron');

class AdBlockExtension {
  constructor(options) {
    this.core = options.core;
    this.windowManager = options.windowManager;
    this.enabled = true;
    this.stats = { total: 0, today: 0 };
    
    // 白名单 - 为空表示拦截所有广告域名（不保护任何网站）
    this.whitelist = new Set([]);
    
    // 广告域名
    this.adDomains = new Set([
      'doubleclick.net',
      'googleadservices.com',
      'googlesyndication.com',
      'google-analytics.com',
      'googleads.g.doubleclick.net',
      'facebook.com',
      'connect.facebook.net',
      'amazon-adsystem.com',
      'adnxs.com',
      'adsrvr.org',
      'adsafeprotected.com',
      'moatads.com',
      'outbrain.com',
      'taboola.com',
      'criteo.com',
      'criteo.net',
      'scorecardresearch.com',
      'quantserve.com',
      'hotjar.com',
      'googletagmanager.com',
      'googletagservices.com',
      'pos.baidu.com',
      'cpro.baidu.com',
      'hm.baidu.com'
    ]);
    
    // 缓存
    this.hostnameCache = new Map();
    this.CACHE_SIZE = 1000;
    
    // 每个 webContents 的拦截计数和监听状态
    this.blockedCounts = new Map();
    this.loadingStates = new Map();
    this.setupListeners = new Set();
    
    // 窗口映射
    this.windows = new Map();
    if (this.windowManager) {
      const mainWindow = this.windowManager.getWindow();
      if (mainWindow) {
        this.windows.set(mainWindow.id, { windowManager: this.windowManager });
      }
    }
  }

  async activate() {
    this.setupInterceptor();
  }

  // 为 webContents 设置加载监听
  ensureListener(wcId) {
    if (this.setupListeners.has(wcId)) return;
    
    try {
      const wc = webContents.fromId(wcId);
      if (!wc) return;
      
      const type = wc.getType();
      if (type === 'remote' || type === 'devtools') return;
      
      this.setupListeners.add(wcId);
      
      // 初始化计数
      this.blockedCounts.set(wcId, 0);
      
      wc.on('did-start-loading', () => {
        this.blockedCounts.set(wcId, 0);
        this.loadingStates.set(wcId, true);
      });
      
      wc.on('did-stop-loading', () => {
        this.loadingStates.set(wcId, false);
        this.showStats(wcId);
      });
      
      wc.on('did-fail-load', () => {
        this.loadingStates.set(wcId, false);
        this.showStats(wcId);
      });
      
      // 清理
      wc.on('destroyed', () => {
        this.setupListeners.delete(wcId);
        this.blockedCounts.delete(wcId);
        this.loadingStates.delete(wcId);
      });
      
    } catch (e) {}
  }
  
  showStats(wcId) {
    const count = this.blockedCounts.get(wcId) || 0;
    if (count > 0) {
      const targetWindow = this.findWindowForWebContents(wcId);
      if (targetWindow) {
        targetWindow.sendToRenderer('toast:adblock', { blocked: count });
      } else if (this.windowManager) {
        this.windowManager.sendToRenderer('toast:adblock', { blocked: count });
      }
      this.core.sendToRenderer('adblock:stats', this.stats);
    }
    this.blockedCounts.delete(wcId);
  }

  setupInterceptor() {
    const defaultSession = session.defaultSession;
    
    try {
      defaultSession.webRequest.onBeforeRequest(null);
    } catch (e) {}

    const filter = {
      urls: ['<all_urls>'],
      types: ['script', 'image', 'xhr', 'subFrame', 'object', 'media']
    };

    defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
      if (!this.enabled) {
        callback({ cancel: false });
        return;
      }

      if (details.resourceType === 'mainFrame') {
        callback({ cancel: false });
        return;
      }

      try {
        const url = details.url;
        
        if (url.startsWith('data:') || url.startsWith('blob:')) {
          callback({ cancel: false });
          return;
        }

        const hostname = this.fastExtractHostname(url);

        // 确保设置了监听器
        this.ensureListener(details.webContentsId);

        const cached = this.hostnameCache.get(hostname);
        if (cached !== undefined) {
          if (cached) {
            this.blockRequest(details, callback);
          } else {
            callback({ cancel: false });
          }
          return;
        }

        if (this.isWhitelisted(hostname)) {
          this.cacheHostname(hostname, false);
          callback({ cancel: false });
          return;
        }

        if (this.isAdDomain(hostname)) {
          this.cacheHostname(hostname, true);
          this.blockRequest(details, callback);
          return;
        }

        this.cacheHostname(hostname, false);
        callback({ cancel: false });
      } catch (err) {
        callback({ cancel: false });
      }
    });
  }

  fastExtractHostname(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.toLowerCase();
    } catch {
      const start = url.indexOf('://') + 3;
      if (start < 3) return '';
      const end = url.indexOf('/', start);
      const host = end > 0 ? url.slice(start, end) : url.slice(start);
      return host.split(':')[0].toLowerCase();
    }
  }

  cacheHostname(hostname, isBlocked) {
    if (this.hostnameCache.size >= this.CACHE_SIZE) {
      const entries = Array.from(this.hostnameCache.entries());
      this.hostnameCache.clear();
      for (let i = entries.length / 2; i < entries.length; i++) {
        this.hostnameCache.set(entries[i][0], entries[i][1]);
      }
    }
    this.hostnameCache.set(hostname, isBlocked);
  }

  isWhitelisted(hostname) {
    if (this.whitelist.has(hostname)) return true;
    const parts = hostname.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const domain = parts.slice(i).join('.');
      if (this.whitelist.has(domain)) return true;
    }
    return false;
  }

  isAdDomain(hostname) {
    if (this.adDomains.has(hostname)) return true;
    const parts = hostname.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const domain = parts.slice(i).join('.');
      if (this.adDomains.has(domain)) return true;
    }
    return false;
  }

  blockRequest(details, callback) {
    this.stats.total++;
    this.stats.today++;
    
    const wcId = details.webContentsId;
    const current = this.blockedCounts.get(wcId) || 0;
    this.blockedCounts.set(wcId, current + 1);
    
    callback({ cancel: true });
  }

  findWindowForWebContents(wcId) {
    try {
      const wc = webContents.fromId(wcId);
      if (wc) {
        const win = wc.getOwnerBrowserWindow();
        if (win) {
          const data = this.windows.get(win.id);
          if (data) return data.windowManager;
        }
      }
    } catch (e) {}
    return null;
  }

  registerWindow(windowManager) {
    const win = windowManager.getWindow();
    if (win) {
      this.windows.set(win.id, { windowManager });
    }
  }

  deactivate() {
    this.enabled = false;
    try {
      session.defaultSession.webRequest.onBeforeRequest(null);
    } catch (e) {}
  }

  toggle() {
    this.enabled = !this.enabled;
    this.core.sendToRenderer('adblock:toggled', { enabled: this.enabled });
    return this.enabled;
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    this.core.sendToRenderer('adblock:toggled', { enabled: this.enabled });
    return this.enabled;
  }
}

module.exports = AdBlockExtension;
