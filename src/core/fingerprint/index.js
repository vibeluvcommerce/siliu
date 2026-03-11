// src/core/fingerprint/index.js
// 浏览器指纹修改器 - Chrome 完全模拟版

class FingerprintManager {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.enableWebGL = options.enableWebGL !== false; // 默认启用
    this.enableCanvas = options.enableCanvas === true;  // 默认关闭
  }

  generateInjectionScript() {
    if (!this.enabled) return '';
    
    return `
      (function() {
        'use strict';
        if (window.__siliuAntiDetectApplied) return;
        window.__siliuAntiDetectApplied = true;
        
        // ========== 基础清理（第1步测试）==========
        
        // 1. 删除 navigator.webdriver
        try {
          Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
            configurable: true,
            enumerable: true
          });
          delete navigator.webdriver;
        } catch(e) {}
        
        // 2. 清理 Electron 全局变量
        const electronVars = ['process', 'require', 'exports', 'module', 
          '__dirname', '__filename', 'Buffer', 'global'];
        electronVars.forEach(key => {
          try { 
            Object.defineProperty(window, key, {
              get: () => undefined,
              configurable: true
            });
            delete window[key]; 
          } catch(e) {}
        });
        
        // 3. 清理 Selenium/WebDriver 痕迹
        const automationVars = [
          '__webdriver_script_fn', '__selenium_evaluate', '__selenium_unwrapped',
          '__fxdriver_evaluate', '_phantom', '__phantomas', 'callPhantom',
          '_selenium', 'callSelenium', '__webdriver__chr', '__$webdriverAsyncExecutor',
          'cdc_adoQpoasnfa76pfcZLmcfl_', '$cdc_asdjflasutopfhvcZLmcfl_'
        ];
        automationVars.forEach(key => {
          try { delete window[key]; } catch(e) {}
        });
        
        console.log('[Fingerprint] Basic anti-detect applied (webdriver + electron cleanup)');
        
        // ========== Navigator 属性（除 plugins/mimeTypes）==========
        
        try {
          const chromeProps = {
            vendor: 'Google Inc.',
            vendorSub: '',
            productSub: '20030107',
            product: 'Gecko',
            appCodeName: 'Mozilla',
            appName: 'Netscape',
            appVersion: '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          };
          
          Object.keys(chromeProps).forEach(key => {
            try {
              Object.defineProperty(navigator, key, {
                get: () => chromeProps[key],
                configurable: true,
                enumerable: true
              });
            } catch(e) {}
          });
          
          console.log('[Fingerprint] Navigator props applied (no plugins/mimeTypes)');
        } catch(e) {}
        
        // ========== Screen 对象 ==========
        
        try {
          const realWidth = screen.width;
          const realHeight = screen.height;
          const realAvailWidth = screen.availWidth;
          const realAvailHeight = screen.availHeight;
          
          Object.defineProperty(screen, 'width', { get: () => realWidth, configurable: true });
          Object.defineProperty(screen, 'height', { get: () => realHeight, configurable: true });
          Object.defineProperty(screen, 'availWidth', { get: () => realAvailWidth, configurable: true });
          Object.defineProperty(screen, 'availHeight', { get: () => realAvailHeight, configurable: true });
        } catch(e) {}
        
        // ========== Chrome API（扩展）==========
        
        try {
          if (!window.chrome) window.chrome = {};
          
          // chrome.runtime
          window.chrome.runtime = {
            getManifest: () => ({ manifest_version: 2, name: '', version: '' }),
            getURL: (path) => 'chrome-extension://invalid/' + path,
          };
          
          // chrome.app
          window.chrome.app = {
            isInstalled: false,
          };
          
          // chrome.csi
          window.chrome.csi = () => ({
            startE: performance.timing?.navigationStart || Date.now(),
            onloadT: Date.now(),
            pageT: Date.now() - (performance.timing?.navigationStart || Date.now())
          });
          
          // chrome.loadTimes
          window.chrome.loadTimes = () => ({
            requestTime: 0,
            startLoadTime: 0,
            commitLoadTime: 0,
            finishDocumentLoadTime: 0,
            finishLoadTime: 0,
            firstPaintAfterLoadTime: 0,
            firstPaintTime: 0,
            navigationType: 'Other'
          });
          
          console.log('[Fingerprint] Chrome API (runtime + app + csi + loadTimes) applied');
        } catch(e) {}
        
        // ========== WebGL 伪装 ==========
        
        try {
          const getParameterProxy = {
            apply: function(target, thisArg, args) {
              const param = args[0];
              if (param === 0x9245) return 'Intel Inc.';
              if (param === 0x9246) return 'Intel Iris Xe Graphics';
              return target.apply(thisArg, args);
            }
          };
          
          const origGetContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(type, attrs) {
            const ctx = origGetContext.call(this, type, attrs);
            if (ctx && (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2')) {
              try {
                const origGetParameter = ctx.getParameter;
                ctx.getParameter = new Proxy(origGetParameter, getParameterProxy);
              } catch(e) {}
            }
            return ctx;
          };
          
          console.log('[Fingerprint] WebGL spoofing applied');
        } catch(e) {}
        
        // ========== Plugins 伪装（测试）==========
        
        try {
          const createFakePlugins = () => {
            const plugins = [
              {
                name: 'Chrome PDF Plugin',
                filename: 'internal-pdf-viewer',
                description: 'Portable Document Format',
                version: 'undefined',
                length: 2,
                item: function(idx) { return this[idx]; },
                namedItem: function(name) { return null; },
                [0]: { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: this }
              },
              {
                name: 'Widevine Content Decryption Module',
                filename: 'widevinecdmadapter.dll',
                description: 'Widevine Content Decryption Module',
                version: 'undefined',
                length: 0,
                item: function(idx) { return this[idx]; },
                namedItem: function(name) { return null; }
              }
            ];
            plugins.length = 2;
            plugins.item = function(idx) { return this[idx]; };
            plugins.namedItem = function(name) { 
              for (let i = 0; i < this.length; i++) {
                if (this[i].name === name) return this[i];
              }
              return null;
            };
            plugins.refresh = function() {};
            return plugins;
          };
          
          const fakePlugins = createFakePlugins();
          Object.setPrototypeOf(fakePlugins, PluginArray.prototype);
          Object.defineProperty(navigator, 'plugins', {
            get: () => fakePlugins,
            configurable: true,
            enumerable: true
          });
          
          console.log('[Fingerprint] Plugins spoofing applied');
        } catch(e) {}
        
        // ========== MIME Types 伪装（测试）==========
        
        try {
          const mimeTypes = [
            { type: 'application/pdf', suffixes: 'pdf', description: '', enabledPlugin: null },
            { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: '', enabledPlugin: null }
          ];
          mimeTypes.length = 2;
          mimeTypes.item = function(idx) { return this[idx]; };
          mimeTypes.namedItem = function(name) {
            for (let i = 0; i < this.length; i++) {
              if (this[i].type === name) return this[i];
            }
            return null;
          };
          Object.setPrototypeOf(mimeTypes, MimeTypeArray.prototype);
          Object.defineProperty(navigator, 'mimeTypes', {
            get: () => mimeTypes,
            configurable: true,
            enumerable: true
          });
          
          console.log('[Fingerprint] MIME Types spoofing applied');
        } catch(e) {}
      })();
    `;
  }

  applyToWebContents(webContents) {
    if (!this.enabled) return;
    const script = this.generateInjectionScript();
    webContents.on('dom-ready', () => {
      webContents.executeJavaScript(script, true).catch(() => {});
    });
  }

  applyToSession(session) {
    if (!this.enabled) return;
    
    // 【测试】恢复 User-Agent 修改
    const originalUA = session.getUserAgent?.() || '';
    const chromeVersion = originalUA.match(/Chrome\/([0-9.]+)/)?.[1] || '121.0.0.0';
    
    const platform = process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' :
                     process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' :
                     'X11; Linux x86_64';
    
    // 纯 Chrome UA
    const chromeUA = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    
    session.setUserAgent(chromeUA);
    console.log('[Fingerprint] UA modified:', chromeUA);
  }
}

module.exports = FingerprintManager;
