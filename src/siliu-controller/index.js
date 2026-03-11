/**
 * SiliuController - 统一浏览器控制入口（双层架构）
 *
 * 双层架构（已移除 System 层，避免与用户抢鼠标）：
 * 1. CDPController - Chrome DevTools Protocol，优先使用
 * 2. NativeController - JS 注入，CDP 不可用时降级
 *
 * 自动降级：CDP → JS
 */

const { globalEventBus } = require('../core/event-bus');
const CDPController = require('./cdp-controller');

// 人类化配置默认值
const DEFAULT_HUMANIZE_CONFIG = {
  enabled: true,
  minDelay: 300,
  maxDelay: 800,
  typeDelay: 50,
  scrollDelay: 200
};

class SiliuController {
  constructor(options = {}) {
    this.core = options.core;
    this.windowManager = options.windowManager;
    this.tabManager = options.tabManager;
    this.configManager = options.configManager;
    this.isConnected = false;
    this.humanize = { ...DEFAULT_HUMANIZE_CONFIG };
    
    // 优先级模式：'cdp' | 'native' | 'auto'（已移除 'system'）
    this.priorityMode = options.priorityMode || 'auto';
    
    // 双层控制器（已移除 systemController）
    this.cdpController = null;
    this._reconnecting = false;

    // 加载配置
    if (this.configManager) {
      this._loadConfig(this.configManager);
    }

    // 创建控制器实例
    this._createControllers(options);
  }

  /**
   * 创建各层控制器
   */
  _createControllers(options) {
    // CDP 控制器
    this.cdpController = new CDPController({
      humanize: this.humanize,
      debugPort: options.debugPort || 9223
    });
    console.log('[SiliuController] CDPController created');
  }

  /**
   * 从配置管理器加载设置
   */
  _loadConfig(configManager) {
    const browserConfig = configManager.get('browser.humanize');
    if (browserConfig) {
      this.humanize = { ...this.humanize, ...browserConfig };
    }

    configManager.onChange('browser.humanize', ({ value }) => {
      this.humanize = { ...this.humanize, ...value };
    });
  }

  /**
   * 初始化
   */
  async initialize() {
    console.log('[SiliuController] Initializing...');
    console.log(`[SiliuController] Priority mode: ${this.priorityMode}`);
    console.log(`[SiliuController] CDPController: ${!!this.cdpController}`);
    
    // 延迟连接 CDP
    if (this.cdpController) {
      setTimeout(async () => {
        try {
          await this.cdpController.connect();
          console.log('[SiliuController] CDP connected');
        } catch (err) {
          console.error('[SiliuController] CDP connection failed:', err.message);
        }
      }, 3000);
    }

    this.isConnected = true;
    globalEventBus.emit('controller:ready', { controller: this });
    console.log('[SiliuController] Ready (CDP/JS mode only)');
  }

  /**
   * 获取当前最佳可用控制器
   */
  _getBestController(preferredMode = null) {
    const mode = preferredMode || this.priorityMode;
    
    if (mode === 'cdp' && this.cdpController?.isConnected) {
      return { controller: this.cdpController, name: 'CDP' };
    }
    
    // auto 模式：优先 CDP
    if (mode === 'auto') {
      if (this.cdpController?.isConnected) {
        return { controller: this.cdpController, name: 'CDP' };
      }
    }
    
    // 默认返回 CDP（即使未连接，会触发 fallback 到 JS）
    return { controller: this.cdpController, name: 'CDP' };
  }

  /**
   * 通用执行包装器（自动处理降级）
   * 返回 { result, mode, attempts: [{mode, success, error}] }
   */
  async _executeWithFallback(operationName, operationFn, fallbackFn = null, onModeChange = null) {
    const attempts = [];
    
    // 首先确保 CDP 连接到当前活动视图
    const cdpReady = await this._ensureCDPConnectedToActive();
    
    const { controller, name } = this._getBestController();
    
    console.log(`[SiliuController] ${operationName}: trying ${name} mode...`);
    if (onModeChange) onModeChange(name);
    
    try {
      const result = await operationFn(controller);
      return { ...result, mode: result.mode || name, attempts };
    } catch (err) {
      console.warn(`[SiliuController] ${operationName}: [${name} failed] - ${err.message}`);
      attempts.push({ mode: name, success: false, error: err.message });
      
      // 降级到 JS
      if (fallbackFn) {
        console.log(`[SiliuController] ${operationName}: falling back to JS...`);
        if (onModeChange) onModeChange('JS');
        const jsResult = await fallbackFn();
        return { ...jsResult, mode: 'JS', attempts };
      }
      
      throw err;
    }
  }

  // ========== 公共 API ==========

  /**
   * 全选文本框内容（Ctrl+A）
   * 返回 { result, mode, attempts }
   */
  async selectAll(selectorOrText) {
    return this._executeWithFallback(
      'selectAll',
      async (ctrl) => ctrl.selectAll(selectorOrText),
      async () => this._nativeSelectAll(selectorOrText)
    );
  }

  /**
   * 点击元素
   * 返回 { result, mode, attempts: [{mode, success, error}] }
   */
  async click(selectorOrText) {
    return this._executeWithFallback(
      'click',
      async (ctrl) => ctrl.click(selectorOrText),
      async () => this._nativeClick(selectorOrText)
    );
  }

  /**
   * 坐标点击（视觉驱动）
   * @param {number} xPercent - 百分比坐标 (0-1)
   * @param {number} yPercent - 百分比坐标 (0-1)
   * @param {boolean} preserveHover - 是否保持 hover 状态（hover 后的点击使用 JS 点击）
   * @returns { result, mode }
   */
  async clickAt(xPercent, yPercent, preserveHover = false) {
    // 如果 CDP 已连接，优先使用 CDP
    if (this.cdpController?.isConnected) {
      try {
        const result = await this.cdpController.clickAt(xPercent, yPercent, null, preserveHover);
        return { result, mode: preserveHover ? 'JS' : 'CDP' };
      } catch (err) {
        console.error('[SiliuController] CDP clickAt failed, falling back to native JS:', err.message);
        // CDP 失败，降级到原生 JS 点击
      }
    }
    
    // CDP 未连接或失败，使用原生 JS 点击（降级）
    try {
      const result = await this._nativeClickAt(xPercent, yPercent);
      return { result, mode: 'JS' };
    } catch (err) {
      console.error('[SiliuController] Native clickAt failed:', err.message);
      return { result: { success: false, error: err.message }, mode: 'JS' };
    }
  }

  /**
   * 原生 JS 坐标点击（CDP 断开时的降级）
   */
  async _nativeClickAt(xPercent, yPercent) {
    const view = this.getView();
    if (!view) {
      throw new Error('No active view for native click');
    }

    const rect = await this._getViewRect();
    const targetX = Math.round(xPercent * rect.width);
    const targetY = Math.round(yPercent * rect.height);

    console.log(`[SiliuController] Native JS click at: (${targetX}, ${targetY})`);

    const result = await view.webContents.executeJavaScript(`
      (function() {
        const el = document.elementFromPoint(${targetX}, ${targetY});
        if (!el) return { success: false, error: 'No element found' };
        
        const clickTarget = el.tagName === 'A' ? el : (el.closest('a') || el);
        
        // 触发点击
        clickTarget.click();
        clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        
        if (clickTarget.href) {
          window.location.assign(clickTarget.href);
        }
        
        return { 
          success: true, 
          element: clickTarget.tagName,
          text: clickTarget.textContent?.substring(0, 30)
        };
      })()
    `);

    return result;
  }

  /**
   * 输入文本
   * 返回 { result, mode, attempts: [{mode, success, error}] }
   */
  async type(selectorOrText, text) {
    return this._executeWithFallback(
      'type',
      async (ctrl) => ctrl.type(selectorOrText, text),
      async () => this._nativeType(selectorOrText, text)
    );
  }

  /**
   * 输入文本到当前活动元素（无需 selector）
   * 返回 { result, mode }
   */
  async typeActive(text) {
    if (this.cdpController?.isConnected) {
      try {
        const result = await this.cdpController.typeActive(text);
        return { ...result, mode: 'CDP' };
      } catch (err) {
        console.warn('[SiliuController] typeActive: CDP failed, using JS');
      }
    }
    
    // 降级到 JS
    return this._nativeTypeActive(text);
  }

  /**
   * 导航
   */
  async navigate(url) {
    // 导航用 CDP 最可靠
    if (this.cdpController?.isConnected) {
      try {
        const result = await this.cdpController.navigate(url);
        return { ...result, mode: 'CDP' };
      } catch (err) {
        console.warn('[SiliuController] navigate: CDP failed, using JS');
      }
    }
    
    // 降级到 JS
    return this._nativeNavigate(url);
  }

  /**
   * 滚动
   */
  async scroll(direction = 'down', amount = 500) {
    return this._executeWithFallback(
      'scroll',
      async (ctrl) => ctrl.scroll(direction, amount),
      async () => this._nativeScroll(direction, amount)
    );
  }

  /**
   * 滚轮事件（适用于抖音等）
   */
  async wheel(direction = 'down', amount = 500) {
    if (this.cdpController?.isConnected) {
      try {
        const result = await this.cdpController.wheel(direction, amount);
        return { ...result, mode: 'CDP' };
      } catch (err) {
        console.warn('[SiliuController] wheel: CDP failed, using JS scroll');
      }
    }
    // 降级到普通 scroll
    return this.scroll(direction, amount);
  }

  /**
   * 等待一段时间
   */
  async wait(ms = 1000) {
    await this._sleep(ms);
    return { success: true, mode: 'JS' };
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 按键（如 Enter, Tab, Escape 等）
   */
  async press(key) {
    if (this.cdpController?.isConnected) {
      try {
        await this.cdpController.press(key);
        return { success: true, mode: 'CDP' };
      } catch (err) {
        console.warn('[SiliuController] press: CDP failed, using JS');
      }
    }
    
    // 降级到 JS
    return this._nativePress(key);
  }

  /**
   * 鼠标悬停（hover）
   */
  async hover(selectorOrText, options = {}) {
    return this._executeWithFallback(
      'hover',
      async (ctrl) => ctrl.hover(selectorOrText, options),
      async () => this._nativeHover(selectorOrText, options)
    );
  }

  /**
   * 坐标悬停
   */
  async hoverAt(xPercent, yPercent, viewportInfo = null) {
    if (!this.cdpController?.isConnected) {
      return { result: { success: false, error: 'CDP not connected' }, mode: 'JS' };
    }
    
    try {
      const result = await this.cdpController.hover({ x: xPercent, y: yPercent });
      return { result, mode: 'CDP' };
    } catch (err) {
      console.error('[SiliuController] hoverAt failed:', err.message);
      return { result: { success: false, error: err.message }, mode: 'JS' };
    }
  }

  /**
   * 选择下拉框选项
   * @param {string|object} selector - CSS选择器或坐标对象 {type: 'coordinate', x, y}
   * @param {string} option - 选项值
   */
  async select(selector, option) {
    // 支持坐标方式（React Select 等自定义下拉）
    if (selector && typeof selector === 'object' && selector.x !== undefined) {
      // 坐标方式：先点击坐标展开下拉，然后选择选项
      return this._selectByCoordinate(selector, option);
    }
    
    return this._executeWithFallback(
      'select',
      async (ctrl) => ctrl.selectOption(selector, option),
      async () => this._nativeSelect(selector, option)
    );
  }

  /**
   * 通过坐标选择下拉框选项（用于 React Select 等自定义组件）
   * @param {object} coordinate - 坐标 {x, y}
   * @param {string} option - 选项文本
   */
  async _selectByCoordinate(coordinate, option) {
    const { x, y } = coordinate;
    console.log(`[SiliuController] Select by coordinate: (${x}, ${y}), option=${option}`);
    
    if (!this.cdpController?.isConnected) {
      return { success: false, error: 'CDP not connected for coordinate select', mode: 'JS' };
    }
    
    try {
      // 使用 CDP 执行选择
      const evalResult = await this.cdpController.cdp.evaluate(`
        (function() {
          const x = ${x};
          const y = ${y};
          const optionText = '${option.replace(/'/g, "\\'")}';
          
          // 1. 点击坐标展开下拉菜单
          const el = document.elementFromPoint(x * window.innerWidth, y * window.innerHeight);
          if (!el) return { success: false, error: 'No element at coordinate' };
          
          el.click();
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          
          // 2. 等待下拉菜单展开
          let attempts = 0;
          const maxAttempts = 10;
          
          while (attempts < maxAttempts) {
            // 查找下拉菜单中的选项
            const allOptions = document.querySelectorAll('[role="option"], [class*="option"]');
            
            for (const opt of allOptions) {
              const text = (opt.textContent || opt.innerText || '').trim();
              if (text.toLowerCase() === optionText.toLowerCase()) {
                opt.click();
                opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                return { success: true, method: 'click-exact', selected: text };
              }
            }
            
            // 如果没找到，等待一下再试
            attempts++;
            const start = Date.now();
            while (Date.now() - start < 50) {}
          }
          
          // 3. 如果没找到，尝试输入过滤
          const input = el.querySelector('input') || document.querySelector('input:focus');
          if (input) {
            input.value = optionText;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            
            // 再次查找
            const start = Date.now();
            while (Date.now() - start < 200) {}
            
            const filteredOptions = document.querySelectorAll('[role="option"], [class*="option"]');
            for (const opt of filteredOptions) {
              const text = (opt.textContent || opt.innerText || '').trim();
              if (text.toLowerCase().includes(optionText.toLowerCase())) {
                opt.click();
                return { success: true, method: 'type-filter', selected: text };
              }
            }
          }
          
          return { 
            success: false, 
            error: 'Option not found: ' + optionText,
            foundOptions: Array.from(document.querySelectorAll('[role="option"], [class*="option"]'))
              .map(o => o.textContent?.trim()).slice(0, 10)
          };
        })()
      `, { returnByValue: true });
      
      console.log(`[SiliuController] evaluate result:`, evalResult);
      
      // 确保有返回值
      const result = evalResult || { success: false, error: 'No result from evaluate' };
      return { ...result, mode: 'CDP' };
    } catch (err) {
      console.error('[SiliuController] Coordinate select failed:', err.message);
      return { success: false, error: err.message, mode: 'JS' };
    }
  }

  /**
   * 截图
   */
  async screenshot() {
    if (this.cdpController?.isConnected) {
      try {
        const result = await this.cdpController.screenshot();
        return { ...result, mode: 'CDP' };
      } catch (err) {
        console.warn('[SiliuController] screenshot: CDP failed');
      }
    }
    
    return this._nativeScreenshot();
  }

  /**
   * 获取内容
   */
  async getContent() {
    if (this.cdpController?.isConnected) {
      try {
        const result = await this.cdpController.getContent();
        return { ...result, mode: 'CDP' };
      } catch (err) {
        console.warn('[SiliuController] getContent: CDP failed');
      }
    }
    
    return this._nativeGetContent();
  }

  // ========== Native JS 备用方法 ==========

  _getActiveWebContents() {
    return this.tabManager?.getActiveView()?.view?.webContents;
  }

  /**
   * 获取当前活动视图的 target ID（用于 CDP 连接）
   */
  async _getActiveTargetId() {
    const activeView = this.tabManager?.getActiveView();
    if (!activeView?.view?.webContents) {
      return null;
    }
    
    const wc = activeView.view.webContents;
    const wcId = wc.id;
    const wcUrl = wc.getURL();
    
    try {
      // 获取所有可用的调试目标
      const targets = await this.cdpController.cdp.listTargets();
      
      // 首先尝试通过 URL 匹配
      let target = targets.find(t => t.url === wcUrl && t.type === 'page');
      
      // 如果找不到，尝试通过标题或其他属性匹配
      if (!target) {
        // 获取当前页面的标题
        const title = wc.getTitle();
        target = targets.find(t => t.title === title && t.type === 'page');
      }
      
      // 如果还是找不到，返回第一个非 devtools 页面
      if (!target) {
        target = targets.find(t => !t.url.includes('devtools') && t.type === 'page');
      }
      
      return target?.id || null;
    } catch (err) {
      console.error('[SiliuController] Failed to get active target:', err.message);
      return null;
    }
  }

  /**
   * 确保 CDP 连接到当前活动视图
   */
  async _ensureCDPConnectedToActive() {
    if (!this.cdpController?.cdp) {
      return false;
    }
    
    try {
      const targetId = await this._getActiveTargetId();
      if (!targetId) {
        return false;
      }
      
      // 如果已经连接到正确的 target，直接返回
      if (this.cdpController.cdp.targetId === targetId && this.cdpController.isConnected) {
        return true;
      }
      
      // 需要重新连接
      console.log('[SiliuController] Switching CDP to target:', targetId);
      
      // 断开当前连接
      this.cdpController.cdp.disconnect();
      
      // 连接到新的 target
      await this.cdpController.cdp.connect(targetId);
      
      return true;
    } catch (err) {
      console.error('[SiliuController] Failed to switch CDP target:', err.message);
      return false;
    }
  }

  async _nativeClick(selectorOrText) {
    const wc = this._getActiveWebContents();
    if (!wc) throw new Error('无法获取页面');

    await wc.executeJavaScript(`
      (function() {
        let el;
        if ('${selectorOrText}'.startsWith('.') || '${selectorOrText}'.startsWith('#') || '${selectorOrText}'.startsWith('[')) {
          el = document.querySelector('${selectorOrText}');
        } else {
          const elements = document.querySelectorAll('*');
          for (const e of elements) {
            if ((e.innerText || '').includes('${selectorOrText}') ||
                (e.textContent || '').includes('${selectorOrText}')) {
              el = e;
              break;
            }
          }
        }
        if (el) {
          el.click();
          return true;
        }
        return false;
      })()
    `);

    return { success: true };
  }

  async _nativeType(selectorOrText, text) {
    const wc = this._getActiveWebContents();
    if (!wc) throw new Error('无法获取页面');

    await wc.executeJavaScript(`
      (function() {
        let el;
        if ('${selectorOrText}'.startsWith('.') || '${selectorOrText}'.startsWith('#') || '${selectorOrText}'.startsWith('[')) {
          el = document.querySelector('${selectorOrText}');
        } else {
          const elements = document.querySelectorAll('*');
          for (const e of elements) {
            if ((e.innerText || '').includes('${selectorOrText}') ||
                (e.textContent || '').includes('${selectorOrText}')) {
              el = e;
              break;
            }
          }
        }
        if (el) {
          // 检查是否是 contenteditable
          const isContentEditable = el.isContentEditable || el.contentEditable === 'true';
          
          if (isContentEditable) {
            el.textContent = '${text.replace(/'/g, "\\'")}';
          } else {
            el.value = '${text.replace(/'/g, "\\'")}';
          }
          
          // 触发完整的事件链
          const events = ['focus', 'input', 'change', 'keyup'];
          events.forEach(eventType => {
            if (eventType === 'input') {
              const inputEvent = new InputEvent('input', { 
                bubbles: true, 
                cancelable: true,
                inputType: 'insertText',
                data: '${text.replace(/'/g, "\\'")}'
              });
              el.dispatchEvent(inputEvent);
            } else {
              el.dispatchEvent(new Event(eventType, { bubbles: true }));
            }
          });
          
          return true;
        }
        return false;
      })()
    `);

    return { success: true };
  }

  async _nativeTypeActive(text) {
    const wc = this._getActiveWebContents();
    if (!wc) throw new Error('无法获取页面');

    await wc.executeJavaScript(`
      (function() {
        const el = document.activeElement;
        if (!el) return { success: false, error: 'No focused element' };
        
        const chars = '${text.replace(/'/g, "\\'")}'.split('');
        for (const char of chars) {
          // 触发 keydown
          const keydownEvent = new KeyboardEvent('keydown', {
            key: char,
            code: 'Key' + char.toUpperCase(),
            bubbles: true
          });
          el.dispatchEvent(keydownEvent);
          
          // 设置值
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.value += char;
          } else if (el.isContentEditable) {
            el.textContent += char;
          }
          
          // 触发 input
          const inputEvent = new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: char
          });
          el.dispatchEvent(inputEvent);
          
          // 触发 keyup
          const keyupEvent = new KeyboardEvent('keyup', {
            key: char,
            code: 'Key' + char.toUpperCase(),
            bubbles: true
          });
          el.dispatchEvent(keyupEvent);
        }
        
        return { success: true };
      })()
    `);

    return { success: true };
  }

  async _nativeNavigate(url) {
    const wc = this._getActiveWebContents();
    if (!wc) throw new Error('无法获取页面');

    let targetUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      targetUrl = 'https://' + url;
    }

    await wc.loadURL(targetUrl);
    return { success: true, url: targetUrl };
  }

  async _nativeScroll(direction, amount) {
    const wc = this._getActiveWebContents();
    if (!wc) throw new Error('无法获取页面');

    const y = direction === 'up' ? -amount : amount;
    await wc.executeJavaScript(`window.scrollBy(0, ${y})`);
    return { success: true };
  }

  async _nativeSelectAll(selectorOrText) {
    const wc = this._getActiveWebContents();
    if (!wc) throw new Error('无法获取页面');

    await wc.executeJavaScript(`
      (function() {
        let el;
        if ('${selectorOrText}'.startsWith('.') || '${selectorOrText}'.startsWith('#') || '${selectorOrText}'.startsWith('[')) {
          el = document.querySelector('${selectorOrText}');
        } else {
          const elements = document.querySelectorAll('*');
          for (const e of elements) {
            if ((e.innerText || '').includes('${selectorOrText}') ||
                (e.textContent || '').includes('${selectorOrText}')) {
              el = e;
              break;
            }
          }
        }
        if (!el) return { success: false, error: 'Element not found' };
        
        // 聚焦元素
        el.focus();
        
        // 全选
        if (el.select) {
          el.select();
        } else if (el.setSelectionRange) {
          el.setSelectionRange(0, el.value?.length || 0);
        }
        
        // 触发事件
        el.dispatchEvent(new Event('select', { bubbles: true }));
        
        return { success: true };
      })()
    `);

    return { success: true };
  }

  async _nativePress(key) {
    const wc = this._getActiveWebContents();
    if (!wc) throw new Error('无法获取页面');

    await wc.executeJavaScript(`
      (function() {
        const el = document.activeElement || document.body;
        
        // 触发 keydown
        const keydownEvent = new KeyboardEvent('keydown', {
          key: '${key}',
          code: '${key}',
          bubbles: true
        });
        el.dispatchEvent(keydownEvent);
        
        // 触发 keypress（某些旧代码可能依赖这个）
        const keypressEvent = new KeyboardEvent('keypress', {
          key: '${key}',
          bubbles: true
        });
        el.dispatchEvent(keypressEvent);
        
        // 触发 keyup
        const keyupEvent = new KeyboardEvent('keyup', {
          key: '${key}',
          code: '${key}',
          bubbles: true
        });
        el.dispatchEvent(keyupEvent);
        
        // 如果是 Enter 且是表单输入框，尝试提交表单
        if ('${key}' === 'Enter' && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
          const form = el.closest('form');
          if (form) {
            form.dispatchEvent(new Event('submit', { bubbles: true }));
          }
        }
        
        return { success: true };
      })()
    `);

    return { success: true };
  }

  async _nativeScreenshot() {
    const wc = this._getActiveWebContents();
    if (!wc) throw new Error('无法获取页面');

    const image = await wc.capturePage();
    return {
      success: true,
      dataUrl: image.toDataURL(),
      width: image.getSize().width,
      height: image.getSize().height
    };
  }

  async _nativeGetContent() {
    const wc = this._getActiveWebContents();
    if (!wc) throw new Error('无法获取页面');

    const content = await wc.executeJavaScript(`
      document.body.innerText.substring(0, 10000)
    `);
    return { success: true, content };
  }

  /**
   * JS 降级：鼠标悬停
   */
  async _nativeHover(selectorOrText, options = {}) {
    const wc = this._getActiveWebContents();
    if (!wc) throw new Error('无法获取页面');

    const result = await wc.executeJavaScript(`
      (function() {
        let el;
        if ('${selectorOrText}'.startsWith('.') || '${selectorOrText}'.startsWith('#') || '${selectorOrText}'.startsWith('[')) {
          el = document.querySelector('${selectorOrText}');
        } else {
          const elements = document.querySelectorAll('*');
          for (const e of elements) {
            if ((e.innerText || '').includes('${selectorOrText}') ||
                (e.textContent || '').includes('${selectorOrText}')) {
              el = e;
              break;
            }
          }
        }
        if (el) {
          // 触发 mouseenter 和 mouseover 事件
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }));
          // 添加 hover class（某些框架依赖）
          el.classList.add('hover');
          
          // 向上冒泡，触发父元素的 hover
          let parent = el.parentElement;
          while (parent) {
            parent.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            parent.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            parent.classList.add('hover');
            parent = parent.parentElement;
          }
          
          return { success: true, element: el.tagName, className: el.className };
        }
        return { success: false, error: 'Element not found' };
      })()
    `);

    return result;
  }

  /**
   * JS 降级：选择下拉框选项
   */
  async _nativeSelect(selector, option) {
    const wc = this._getActiveWebContents();
    if (!wc) throw new Error('无法获取页面');

    const result = await wc.executeJavaScript(`
      (function() {
        const select = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!select) return { success: false, error: 'Select element not found' };
        if (select.tagName !== 'SELECT') return { success: false, error: 'Element is not a SELECT' };

        const optionValue = '${option.replace(/'/g, "\\'")}';
        let targetOption = null;

        // 1. 尝试匹配 value
        targetOption = Array.from(select.options).find(opt => opt.value === optionValue);

        // 2. 尝试匹配 text
        if (!targetOption) {
          targetOption = Array.from(select.options).find(opt => 
            opt.text.trim() === optionValue || 
            opt.text.trim().includes(optionValue)
          );
        }

        // 3. 尝试匹配 index
        if (!targetOption && /^\\d+$/.test(optionValue)) {
          const index = parseInt(optionValue);
          if (index >= 0 && index < select.options.length) {
            targetOption = select.options[index];
          }
        }

        if (!targetOption) {
          return { 
            success: false, 
            error: 'Option not found: ' + optionValue,
            availableOptions: Array.from(select.options).map(o => ({ value: o.value, text: o.text }))
          };
        }

        // 设置选中值
        select.value = targetOption.value;
        
        // 触发事件
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.dispatchEvent(new Event('input', { bubbles: true }));

        return { 
          success: true, 
          selectedValue: targetOption.value, 
          selectedText: targetOption.text 
        };
      })()
    `);

    return result;
  }
}

module.exports = SiliuController;
