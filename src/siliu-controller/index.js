/**
 * SiliuController - 统一浏览器控制入口（双层架构）
 *
 * 双层架构（已移除 System 层，避免与用户抢鼠标）：
 * 1. CDPController - Chrome DevTools Protocol，优先使用
 * 2. NativeController - JS 注入，CDP 不可用时降级
 *
 * 自动降级：CDP → JS
 */

const path = require('path');
const fs = require('fs');
const { globalEventBus } = require('../core/event-bus');
const CDPController = require('./cdp-controller');
const { resolveHomePath } = require('../core/path-utils');

// 人类化配置默认值
const DEFAULT_HUMANIZE_CONFIG = {
  enabled: true,
  minDelay: 150,
  maxDelay: 400,
  typeDelay: 25,
  scrollDelay: 100
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
   * 上传文件
   * 返回 { success, filePath, mode }
   * 
   * 流程：
   * 1. 优先尝试 CDP 直接设置文件（标准 file input）
   * 2. 如果 CDP 失败（无 file input），尝试系统级对话框拦截
   * 3. 系统级拦截：先设置待选文件，再点击上传按钮，自动填充系统对话框
   */
  async upload(selectorOrText, filePath, options = {}) {
    // 解析 ~ 路径
    filePath = resolveHomePath(filePath);
    
    // 【简化】只使用系统级对话框拦截上传
    // 如果此方法失败，其他方法（CDP直接上传/原生JS）同样会失败，无需降级
    if (!this.tabManager?.fileManager) {
      throw new Error('Upload failed: file manager not available');
    }
    
    console.log('[SiliuController] upload: using system dialog interceptor...');
    return await this._uploadWithSystemInterceptor(selectorOrText, filePath);
  }
  
  /**
   * 扫描文件夹获取文件列表
   * @param {string} folderPath - 文件夹路径
   * @param {Object} options - 选项
   * @param {string[]} options.extensions - 文件扩展名过滤，如 ['.jpg', '.png']
   * @param {boolean} options.recursive - 是否递归子文件夹
   * @returns {Promise<{success: boolean, files: string[], error?: string}>}
   */
  async listFiles(folderPath, options = {}) {
    const fs = require('fs');
    const path = require('path');
    
    try {
      if (!fs.existsSync(folderPath)) {
        return { success: false, files: [], error: 'Folder not found: ' + folderPath };
      }
      
      const { extensions = [], recursive = false } = options;
      let files = [];
      
      const scanDir = (dir) => {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory() && recursive) {
            scanDir(fullPath);
          } else if (stat.isFile()) {
            const ext = path.extname(item).toLowerCase();
            if (extensions.length === 0 || extensions.includes(ext)) {
              files.push(fullPath);
            }
          }
        }
      };
      
      scanDir(folderPath);
      console.log(`[SiliuController] Scanned ${folderPath}, found ${files.length} files`);
      return { success: true, files };
      
    } catch (err) {
      console.error('[SiliuController] listFiles error:', err.message);
      return { success: false, files: [], error: err.message };
    }
  }
  
  /**
   * 根据上下文情绪选择表情图片
   * @param {string} folderPath - 表情文件夹路径
   * @param {string} context - 上下文文本（如评论内容）
   * @returns {Promise<{success: boolean, selectedFile?: string, emotion?: string, error?: string}>}
   */
  async selectEmojiByContext(folderPath, context) {
    // 1. 获取所有表情文件
    const listResult = await this.listFiles(folderPath, { 
      extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp'] 
    });
    
    if (!listResult.success || listResult.files.length === 0) {
      return { success: false, error: listResult.error || 'No emoji files found' };
    }
    
    // 2. 情绪关键词映射
    const emotionKeywords = {
      'happy': ['happy', 'joy', 'smile', 'laugh', '开心', '高兴', '笑', '喜', '乐'],
      'sad': ['sad', 'cry', 'tear', 'sorrow', '伤心', '难过', '哭', '悲', '泪'],
      'angry': ['angry', 'rage', 'mad', 'furious', '生气', '愤怒', '怒', '气'],
      'surprise': ['surprise', 'shock', 'wow', 'amazing', '惊讶', '震惊', '惊', '哇'],
      'love': ['love', 'heart', 'like', 'favorite', '爱', '喜欢', '心', '赞'],
      'confused': ['confused', 'question', 'doubt', '困惑', '疑惑', '疑问', '懵'],
      'cool': ['cool', 'awesome', 'chill', '酷', '帅', '淡定', '冷静'],
      'embarrassed': ['embarrassed', 'shy', 'awkward', '尴尬', '害羞', '囧'],
      'sleepy': ['sleepy', 'tired', 'sleep', '困', '累', '睡', '倦'],
      'excited': ['excited', 'exciting', '激动', '兴奋', '燃', '嗨']
    };
    
    // 3. 分析上下文情绪
    const contextLower = context.toLowerCase();
    let detectedEmotion = null;
    let maxScore = 0;
    
    for (const [emotion, keywords] of Object.entries(emotionKeywords)) {
      let score = 0;
      for (const keyword of keywords) {
        if (contextLower.includes(keyword.toLowerCase())) {
          score += keyword.length; // 越长匹配度越高
        }
      }
      if (score > maxScore) {
        maxScore = score;
        detectedEmotion = emotion;
      }
    }
    
    // 4. 根据情绪选择文件
    const path = require('path');
    let selectedFile = null;
    
    if (detectedEmotion) {
      // 找匹配情绪的文件
      const matchingFiles = listResult.files.filter(file => {
        const fileName = path.basename(file, path.extname(file)).toLowerCase();
        const keywords = emotionKeywords[detectedEmotion] || [];
        return keywords.some(kw => fileName.includes(kw.toLowerCase()));
      });
      
      if (matchingFiles.length > 0) {
        // 随机选择一个匹配的
        selectedFile = matchingFiles[Math.floor(Math.random() * matchingFiles.length)];
      }
    }
    
    // 如果没有匹配到，随机选择一个
    if (!selectedFile) {
      selectedFile = listResult.files[Math.floor(Math.random() * listResult.files.length)];
      detectedEmotion = 'random';
    }
    
    console.log(`[SiliuController] Selected emoji: ${selectedFile} (emotion: ${detectedEmotion})`);
    return { 
      success: true, 
      selectedFile, 
      emotion: detectedEmotion,
      allFiles: listResult.files 
    };
  }
  
  /**
   * 使用系统级对话框拦截器上传
   * 适用于 B站等自定义上传组件
   * 
   * 注意：如果 selectorOrText 为 undefined，表示上传按钮已经被点击过了
   * 系统对话框可能已经弹出，此时只需等待拦截器工作
   */
  async _uploadWithSystemInterceptor(selectorOrText, filePath) {
    const fileManager = this.tabManager.fileManager;
    
    // 1. 检查拦截器是否可用
    const interceptorAvailable = fileManager.interceptor?.isAvailable() || false;
    const interceptorRunning = fileManager.interceptor?.isRunning || false;
    
    console.log('[SiliuController] Interceptor status:', { 
      available: interceptorAvailable, 
      running: interceptorRunning 
    });
    
    // 2. 先设置 Promise 和事件监听器（确保在准备上传前监听就绪）
    console.log('[SiliuController] Setting up upload promise for:', filePath);
    
    const timeout = 30000; // 30秒总超时
    let resolved = false;
    
    const uploadPromise = new Promise((resolve) => {
      // 监听事件（事件触发时立即响应）
      const onSelected = (data) => {
        if (resolved) return;
        resolved = true;
        fileManager.off('file:selected', onSelected);
        fileManager.off('dialog:manual-required', onManual);
        console.log('[SiliuController] File selected via interceptor:', data);
        resolve({ 
          success: true, 
          filePath: data.filePath, 
          mode: 'SYSTEM_DIALOG' 
        });
      };
      
      const onManual = (data) => {
        if (resolved) return;
        resolved = true;
        fileManager.off('dialog:manual-required', onManual);
        fileManager.off('file:selected', onSelected);
        console.warn('[SiliuController] Manual intervention required:', data);
        resolve({ 
          success: false, 
          error: 'Manual dialog intervention required',
          mode: 'SYSTEM_MANUAL',
          hwnd: data.hwnd
        });
      };
      
      fileManager.once('file:selected', onSelected);
      fileManager.once('dialog:manual-required', onManual);
      
      // 超时检查
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        fileManager.off('file:selected', onSelected);
        fileManager.off('dialog:manual-required', onManual);
        fileManager.clearNextFile();
        console.error('[SiliuController] Upload timeout - dialog not intercepted');
        resolve({ 
          success: false, 
          error: 'Upload timeout - dialog not intercepted',
          mode: 'SYSTEM_TIMEOUT'
        });
      }, timeout);
    });
    
    // 3. 准备上传（设置待选文件到拦截器）
    console.log('[SiliuController] Preparing upload:', filePath);
    const prepared = fileManager.prepareUpload(filePath);
    if (!prepared) {
      throw new Error('Failed to prepare upload');
    }
    
    // 【注意】upload 方法不再负责点击按钮
    // 应由 AI 先执行 click 操作触发系统对话框，然后调用 upload 只负责填充文件路径
    
    // 4. 等待拦截器完成或超时
    console.log('[SiliuController] Waiting for dialog interception...');
    return uploadPromise;
  }

  /**
   * 点击元素
   * 返回 { result, mode, attempts: [{mode, success, error}] }
   */
  async click(selectorOrText, options = {}) {
    return this._executeWithFallback(
      'click',
      async (ctrl) => ctrl.click(selectorOrText, options),
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
  async type(selectorOrText, text, options = {}) {
    return this._executeWithFallback(
      'type',
      async (ctrl) => ctrl.type(selectorOrText, text, options),
      async () => this._nativeType(selectorOrText, text, options)
    );
  }

  /**
   * 输入文本到当前活动元素（无需 selector）
   * 返回 { result, mode }
   */
  async typeActive(text, options = {}) {
    if (this.cdpController?.isConnected) {
      try {
        const result = await this.cdpController.typeActive(text, options);
        return { ...result, mode: result.mode || 'CDP' };
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
   * 浏览器后退
   */
  async goBack() {
    if (this.core?.tabManager) {
      try {
        const result = this.core.tabManager.goBack(this.windowId);
        return { success: result, mode: 'native' };
      } catch (err) {
        console.error('[SiliuController] goBack failed:', err.message);
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: 'TabManager not available' };
  }

  /**
   * 浏览器前进
   */
  async goForward() {
    if (this.core?.tabManager) {
      try {
        const result = this.core.tabManager.goForward(this.windowId);
        return { success: result, mode: 'native' };
      } catch (err) {
        console.error('[SiliuController] goForward failed:', err.message);
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: 'TabManager not available' };
  }

  /**
   * 切换标签页
   */
  async switchTab(index) {
    if (this.core?.tabManager) {
      try {
        // 获取所有视图
        const views = this.core.tabManager.getAllViews();
        if (index >= 0 && index < views.length) {
          const targetViewId = views[index].id;
          // 【关键】传递 sidebarOpen 状态，确保 Copilot 侧边栏空间被保留
          const sidebarOpen = this.core.tabManager.sidebarOpen;
          this.core.tabManager.setActiveView(targetViewId, sidebarOpen);
          return { success: true, mode: 'native', viewId: targetViewId };
        }
        return { success: false, error: `Invalid tab index: ${index}` };
      } catch (err) {
        console.error('[SiliuController] switchTab failed:', err.message);
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: 'TabManager not available' };
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
   * @param {string} direction - 方向 'down' 或 'up'
   * @param {number} amount - 滚动量
   * @param {object} coordinate - 可选，坐标 {x, y}，在指定位置滚动
   */
  async wheel(direction = 'down', amount = 500, coordinate = null) {
    if (this.cdpController?.isConnected) {
      try {
        const result = await this.cdpController.wheel(direction, amount, coordinate);
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
    console.log(`[SiliuController] press: called with key=${key}, CDP connected=${this.cdpController?.isConnected}`);
    if (this.cdpController?.isConnected) {
      try {
        const result = await this.cdpController.press(key);
        console.log('[SiliuController] press: CDP success, result=', result);
        return result;
      } catch (err) {
        console.warn('[SiliuController] press: CDP failed, using JS:', err.message);
      }
    }
    
    // 降级到 JS
    console.log('[SiliuController] press: using JS fallback');
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
   * 策略：
   * 1. 传统 <select> 元素 → 使用原生 selectOption
   * 2. 带输入框的自定义下拉（React Select）→ 使用输入+点击模式
   * 3. 需要滚动查找的下拉框 → 【禁用】请使用 click + wheel + screenshot 手动查找
   * @param {string|object} selector - CSS选择器或坐标对象 {type: 'coordinate', x, y}
   * @param {string} option - 选项值
   * @param {object} options - 可选配置 { method: 'input' }
   */
  async select(selector, option, options = {}) {
    console.error(`[SELECT_MODE] selector type=${typeof selector}, has x=${selector?.x !== undefined}, method=${options.method}`);
    
    // 【禁用】hover-wheel 模式，因为无法准确定位下拉框选项区域
    if (options.method === 'hover-wheel') {
      console.error(`[SELECT_MODE] HOVER+WHEEL mode is disabled. Please use click + wheel + screenshot manually.`);
      return { 
        success: false, 
        error: 'hover-wheel mode disabled. Use click to expand, then wheel + screenshot to find option manually.',
        mode: 'CDP'
      };
    }
    
    // 如果是坐标方式，使用输入+点击模式
    if (selector && typeof selector === 'object' && selector.x !== undefined) {
      console.error(`[SELECT_MODE] Using INPUT+CLICK mode (coordinate)`);
      return this._selectByInput(selector, option);
    }
    
    // 如果是字符串选择器，先检测元素类型
    if (typeof selector === 'string') {
      console.error(`[SELECT_MODE] String selector, detecting element type...`);
      // 检测是否是原生 select
      const isNativeSelect = await this._isNativeSelect(selector);
      console.error(`[SELECT_MODE] isNativeSelect=${isNativeSelect}`);
      
      if (isNativeSelect) {
        console.error(`[SELECT_MODE] Using TRADITIONAL mode (native select)`);
        // 原生 select 使用传统方式
        return this._executeWithFallback(
          'select',
          async (ctrl) => ctrl.selectOption(selector, option),
          async () => this._nativeSelect(selector, option)
        );
      } else {
        console.error(`[SELECT_MODE] Using INPUT+CLICK mode (custom dropdown)`);
        // 自定义下拉使用输入+点击模式
        return this._selectByInput(null, option, selector);
      }
    }
    
    console.error(`[SELECT_MODE] Using INPUT+CLICK mode (default)`);
    // 默认使用输入+点击模式
    return this._selectByInput(selector, option);
  }

  /**
   * 检测是否是原生 <select> 元素
   */
  async _isNativeSelect(selector) {
    if (!this.cdpController?.isConnected) {
      return false;
    }
    
    try {
      const result = await this.cdpController.cdp.evaluate(`
        (function() {
          const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
          if (!el) return false;
          return el.tagName === 'SELECT';
        })()
      `, { returnByValue: true });
      
      return result === true;
    } catch (err) {
      return false;
    }
  }

  /**
   * 通过输入+点击模式选择选项（用于 React Select 等带输入框的自定义下拉）
   * 流程：点击展开 → 输入过滤 → 点击选项
   * @param {object} coordinate - 可选，坐标 {x, y}
   * @param {string} option - 选项文本
   * @param {string} selector - 可选，CSS选择器
   */
  async _selectByInput(coordinate, option, selector = null) {
    console.log(`[SiliuController] Select by input: coordinate=${JSON.stringify(coordinate)}, selector=${selector}, option=${option}`);
    
    if (!this.cdpController?.isConnected) {
      return { success: false, error: 'CDP not connected', mode: 'JS' };
    }
    
    try {
      const evalResult = await this.cdpController.cdp.evaluate(`
        (function() {
          const optionText = '${option.replace(/'/g, "\\'")}';
          let container = null;
          
          // 1. 找到下拉框容器
          ${coordinate && coordinate.x !== undefined ? `
            // 通过坐标找
            const x = ${coordinate.x};
            const y = ${coordinate.y};
            container = document.elementFromPoint(x * window.innerWidth, y * window.innerHeight);
          ` : selector ? `
            // 通过选择器找
            container = document.querySelector('${selector.replace(/'/g, "\\'")}');
          ` : `
            return { success: false, error: 'No coordinate or selector provided' };
          `}
          
          if (!container) {
            return { success: false, error: 'Dropdown container not found' };
          }
          
          // 2. 点击展开下拉菜单
          container.click();
          container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          
          // 3. 找到输入框并输入过滤文本
          let input = null;
          const start = Date.now();
          
          // 等待输入框出现（可能在容器内或body上）
          while (Date.now() - start < 500) {
            input = container.querySelector('input') || 
                    document.querySelector('input[class*="input"]') ||
                    document.querySelector('[class*="menu"] input');
            if (input) break;
          }
          
          if (!input) {
            return { success: false, error: 'No input found in dropdown' };
          }
          
          // 聚焦并输入文本
          input.focus();
          input.click();
          
          // 清空并输入
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          
          // 逐个字符输入
          for (const char of optionText) {
            input.value += char;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
          }
          
          // 4. 等待过滤结果并点击匹配选项
          const searchStart = Date.now();
          while (Date.now() - searchStart < 500) {
            const options = document.querySelectorAll('[role="option"], [class*="option"]');
            
            // 优先精确匹配
            for (const opt of options) {
              const text = (opt.textContent || opt.innerText || '').trim();
              if (text.toLowerCase() === optionText.toLowerCase()) {
                opt.click();
                opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                return { success: true, method: 'input-click-exact', selected: text };
              }
            }
            
            // 其次包含匹配
            for (const opt of options) {
              const text = (opt.textContent || opt.innerText || '').trim();
              if (text.toLowerCase().includes(optionText.toLowerCase())) {
                opt.click();
                opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                return { success: true, method: 'input-click-contains', selected: text };
              }
            }
          }
          
          // 如果没找到，返回可用选项
          const allOptions = Array.from(document.querySelectorAll('[role="option"], [class*="option"]'))
            .map(o => o.textContent?.trim())
            .filter(Boolean)
            .slice(0, 10);
            
          return { 
            success: false, 
            error: 'Option not found after input: ' + optionText,
            availableOptions: allOptions
          };
        })()
      `, { returnByValue: true });
      
      console.log(`[SiliuController] Input select result:`, evalResult);
      
      // cdp.evaluate 返回的结果在 .value 属性中
      const result = evalResult?.value || { success: false, error: 'No result from evaluate' };
      return { ...result, mode: 'CDP' };
    } catch (err) {
      console.error('[SiliuController] Input select failed:', err.message);
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

  async _nativeType(selectorOrText, text, options = {}) {
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

    // 处理坐标对象
    if (selectorOrText && typeof selectorOrText === 'object' && selectorOrText.x !== undefined) {
      // 坐标方式：点击获取焦点，然后全选
      await this._nativeClickAt(selectorOrText.x, selectorOrText.y);
      await this._sleep(100);
      
      await wc.executeJavaScript(`
        (function() {
          const el = document.activeElement;
          if (!el) return { success: false, error: 'No focused element' };
          
          if (el.select) {
            el.select();
          } else if (el.setSelectionRange) {
            el.setSelectionRange(0, el.value?.length || 0);
          }
          el.dispatchEvent(new Event('select', { bubbles: true }));
          return { success: true };
        })()
      `);
      return { success: true };
    }

    // 字符串选择器方式
    if (selectorOrText && typeof selectorOrText === 'string') {
      const escapedSelector = selectorOrText.replace(/'/g, "\\'");
      await wc.executeJavaScript(`
        (function() {
          let el;
          if ('${escapedSelector}'.startsWith('.') || '${escapedSelector}'.startsWith('#') || '${escapedSelector}'.startsWith('[')) {
            el = document.querySelector('${escapedSelector}');
          } else {
            const elements = document.querySelectorAll('*');
            for (const e of elements) {
              if ((e.innerText || '').includes('${escapedSelector}') ||
                  (e.textContent || '').includes('${escapedSelector}')) {
                el = e;
                break;
              }
            }
          }
          if (!el) return { success: false, error: 'Element not found' };
          
          el.focus();
          if (el.select) {
            el.select();
          } else if (el.setSelectionRange) {
            el.setSelectionRange(0, el.value?.length || 0);
          }
          el.dispatchEvent(new Event('select', { bubbles: true }));
          return { success: true };
        })()
      `);
      return { success: true };
    }

    // 无参数：直接全选当前焦点元素
    await wc.executeJavaScript(`
      (function() {
        const el = document.activeElement;
        if (!el) return { success: false, error: 'No focused element' };
        
        if (el.select) {
          el.select();
        } else if (el.setSelectionRange) {
          el.setSelectionRange(0, el.value?.length || 0);
        }
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

    return { success: true, mode: 'JS' };
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

  // ========== 下载功能 ==========

  /**
   * 从 URL 提取文件名
   * @param {string} url - 下载链接 URL
   * @returns {string|null} - 文件名或 null
   */
  _extractFilenameFromUrl(url) {
    try {
      if (!url) return null;
      
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      
      // 从 pathname 提取文件名
      // 例如: /path/to/file.pdf → file.pdf
      // 例如: /download.php?id=123 → null (没有有效文件名)
      const filename = pathname.split('/').pop();
      
      // 检查是否是有效的文件名（有扩展名）
      if (filename && filename.includes('.') && !filename.endsWith('.')) {
        // 清理文件名中的非法字符
        const cleanFilename = filename.replace(/[<>:"/\\|?*]/g, '_');
        console.log('[SiliuController] Extracted filename from URL:', cleanFilename);
        return cleanFilename;
      }
      
      return null;
    } catch (err) {
      console.error('[SiliuController] Error extracting filename from URL:', err.message);
      return null;
    }
  }

  /**
   * 触发下载
   * 使用系统对话框拦截，像上传一样处理 Chrome 保存对话框
   * 
   * 工作流程：
   * 1. AI click 点击下载链接触发保存对话框
   * 2. download 操作准备保存路径，拦截器自动填充并确认
   * 
   * @param {string} downloadPath - 下载保存路径（可选，默认使用工作区downloads目录）
   * @param {string} sourceUrl - 可选，下载来源URL，用于自动提取文件名
   * @returns {Promise<Object>}
   */
  async download(downloadPath = null, sourceUrl = null) {
    console.log('[SiliuController] download:', { downloadPath, sourceUrl });

    if (!this.tabManager?.fileManager) {
      throw new Error('Download failed: file manager not available');
    }

    const path = require('path');
    const { getWorkspaceManager } = require('../core/workspace-manager');
    const workspace = getWorkspaceManager();
    const downloadsDir = workspace.getDownloadsDir();

    // 如果没有指定路径，尝试从 URL 提取文件名或生成默认文件名
    if (!downloadPath) {
      // 1. 尝试从 sourceUrl 提取文件名
      let filename = null;
      if (sourceUrl) {
        filename = this._extractFilenameFromUrl(sourceUrl);
      }
      
      // 2. 如果无法提取，使用默认命名
      if (!filename) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        filename = `download-${timestamp}.txt`;
      }
      
      downloadPath = path.join(downloadsDir, filename);
    }

    // 解析 ~ 路径
    downloadPath = resolveHomePath(downloadPath);
    
    // 确保路径有文件名（不是目录）
    if (!path.extname(downloadPath)) {
      // 如果没有扩展名，添加时间戳避免覆盖
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadPath = path.join(downloadPath, `download-${timestamp}.txt`);
    }

    return await this._downloadWithSystemInterceptor(downloadPath);
  }

  /**
   * 使用系统对话框拦截器执行下载
   */
  async _downloadWithSystemInterceptor(downloadPath) {
    const fileManager = this.tabManager.fileManager;
    
    console.log('[SiliuController] Interceptor status:', { 
      hasInterceptor: !!fileManager.interceptor, 
      running: fileManager.interceptor?.isRunning || false 
    });

    // 1. 先设置 Promise 和事件监听器（对话框处理）
    console.log('[SiliuController] Setting up download promise for:', downloadPath);
    
    const dialogTimeout = 30000; // 30秒对话框超时
    let resolved = false;
    
    const dialogPromise = new Promise((resolve) => {
      // 监听对话框处理成功事件
      const onSelected = (data) => {
        if (resolved) return;
        resolved = true;
        fileManager.off('file:selected', onSelected);
        fileManager.off('dialog:manual-required', onManual);
        console.log('[SiliuController] File saved via interceptor:', data);
        resolve({ 
          success: true, 
          dialogHandled: true,
          downloadPath: data.filePath,
          filePath: data.filePath,
          fileName: data.fileName || path.basename(data.filePath),
          fileSize: data.fileSize
        });
      };
      
      const onManual = (data) => {
        if (resolved) return;
        resolved = true;
        fileManager.off('dialog:manual-required', onManual);
        fileManager.off('file:selected', onSelected);
        console.warn('[SiliuController] Manual intervention required:', data);
        resolve({ 
          success: false, 
          error: 'Manual dialog intervention required',
          mode: 'SYSTEM_MANUAL',
          hwnd: data.hwnd
        });
      };
      
      fileManager.once('file:selected', onSelected);
      fileManager.once('dialog:manual-required', onManual);
      
      // 超时检查
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        fileManager.off('file:selected', onSelected);
        fileManager.off('dialog:manual-required', onManual);
        fileManager.clearNextFile();
        console.error('[SiliuController] Download timeout - dialog not intercepted');
        resolve({ 
          success: false, 
          error: 'Download timeout - dialog not intercepted',
          mode: 'SYSTEM_TIMEOUT'
        });
      }, dialogTimeout);
    });
    
    // 2. 准备下载（设置保存路径到拦截器）
    console.log('[SiliuController] Preparing download:', downloadPath);
    const prepared = fileManager.prepareDownload(downloadPath);
    if (!prepared) {
      throw new Error('Failed to prepare download');
    }
    
    // 【注意】AI 需要先执行 click 操作触发保存对话框
    
    // 3. 等待对话框处理完成
    console.log('[SiliuController] Waiting for save dialog interception...');
    const dialogResult = await dialogPromise;
    
    if (!dialogResult.success) {
      return dialogResult;
    }
    
    // 4. 等待文件实际下载完成
    console.log('[SiliuController] Waiting for file download to complete...');
    const downloadCompleteResult = await this._waitForDownloadComplete(fileManager, downloadPath);
    
    return {
      ...dialogResult,
      ...downloadCompleteResult,
      mode: 'SYSTEM_DIALOG'
    };
  }
  
  /**
   * 等待文件下载完成
   */
  async _waitForDownloadComplete(fileManager, downloadPath) {
    return new Promise((resolve) => {
      let resolved = false;
      
      // 路径标准化用于比较（处理大小写和分隔符差异）
      const normalizePath = (p) => p ? require('path').normalize(p).toLowerCase() : '';
      const normalizedDownloadPath = normalizePath(downloadPath);
      
      // 监听下载完成事件
      const onComplete = (data) => {
        if (resolved) return;
        // 使用标准化路径进行宽松比较
        if (normalizePath(data.filePath) !== normalizedDownloadPath) {
          console.log(`[SiliuController] Download path mismatch: ${data.filePath} !== ${downloadPath}`);
          return;
        }
        
        resolved = true;
        fileManager.off('download:complete', onComplete);
        fileManager.off('download:timeout', onTimeout);
        
        console.log('[SiliuController] Download complete:', data);
        resolve({
          success: true,
          downloadComplete: true,
          filePath: data.filePath,
          fileName: data.fileName,
          fileSize: data.fileSize,
          message: data.message
        });
      };
      
      const onTimeout = (data) => {
        if (resolved) return;
        if (normalizePath(data.filePath) !== normalizedDownloadPath) return;
        
        resolved = true;
        fileManager.off('download:complete', onComplete);
        fileManager.off('download:timeout', onTimeout);
        
        console.warn('[SiliuController] Download monitoring timeout:', data);
        resolve({
          success: true, // 对话框已处理，但无法确认下载是否完成
          downloadComplete: false,
          filePath: downloadPath,
          warning: 'Download progress monitoring timeout, but dialog was handled'
        });
      };
      
      fileManager.once('download:complete', onComplete);
      fileManager.once('download:timeout', onTimeout);
      
      // 下载监控超时（60秒）
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        fileManager.off('download:complete', onComplete);
        fileManager.off('download:timeout', onTimeout);
        
        resolve({
          success: true,
          downloadComplete: false,
          filePath: downloadPath,
          warning: 'Download monitoring timeout'
        });
      }, 65000);
    });
  }
  
  /**
   * 保存图片（直接下载）
   * AI 在指定坐标定位图片，系统自动获取图片URL并下载保存
   * 
   * @param {Object} target - 图片坐标 {type: 'coordinate', x, y}
   * @param {string} savePath - 保存路径（可选，默认使用工作区downloads目录，强制限制在工作区内）
   * @returns {Promise<Object>} 保存结果
   */
  async saveImage(target, savePath = null) {
    console.log('[SiliuController] saveImage:', { target, savePath });
    
    // 获取工作区目录
    const { getWorkspaceManager } = require('../core/workspace-manager');
    const workspace = getWorkspaceManager();
    const downloadsDir = workspace.getDownloadsDir();
    const workspaceDir = workspace.getWorkspaceDir();
    
    // 获取当前激活的 view
    const activeView = this.tabManager.getActiveView();
    if (!activeView || !activeView.view) {
      throw new Error('No active view');
    }
    
    const webContents = activeView.view.webContents;
    const x = target.x;
    const y = target.y;
    
    console.log(`[SiliuController] Getting image at (${x}, ${y})`);
    
    // 注入脚本获取图片 URL
    const imageInfo = await webContents.executeJavaScript(`
      (function() {
        const x = ${x} * window.innerWidth;
        const y = ${y} * window.innerHeight;
        const elem = document.elementFromPoint(x, y);
        if (!elem) return { success: false, error: 'No element at position' };
        
        // 查找图片元素
        let img = elem;
        if (elem.tagName !== 'IMG') {
          img = elem.closest('img') || elem.querySelector('img');
        }
        
        if (!img || img.tagName !== 'IMG') {
          return { success: false, error: 'No image found at position' };
        }
        
        // 获取图片 URL（优先使用 srcset 中的最大图，否则用 src）
        let imageUrl = img.src;
        if (img.srcset) {
          // 解析 srcset 获取最大尺寸图片
          const srcsetParts = img.srcset.split(',').map(s => s.trim());
          let maxWidth = 0;
          for (const part of srcsetParts) {
            const [url, widthStr] = part.split(' ');
            if (widthStr) {
              const width = parseInt(widthStr.replace('w', ''));
              if (width > maxWidth) {
                maxWidth = width;
                imageUrl = url;
              }
            }
          }
        }
        
        // 处理相对路径
        if (imageUrl && !imageUrl.startsWith('http')) {
          imageUrl = new URL(imageUrl, window.location.href).href;
        }
        
        return { 
          success: true, 
          src: imageUrl,
          alt: img.alt,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight
        };
      })();
    `);
    
    console.log('[SiliuController] Image info:', imageInfo);
    
    if (!imageInfo.success) {
      throw new Error(imageInfo.error || 'Failed to find image');
    }
    
    // 如果没有指定路径，根据图片 URL 生成文件名
    if (!savePath) {
      const url = new URL(imageInfo.src);
      const ext = path.extname(url.pathname) || '.jpg';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      savePath = path.join(downloadsDir, `image-${timestamp}${ext}`);
    } else {
      savePath = resolveHomePath(savePath);
      
      // 【强制限制】所有文件必须保存在 workspace 目录下
      const resolvedSavePath = path.resolve(savePath);
      const resolvedWorkspaceDir = path.resolve(workspaceDir);
      
      if (!resolvedSavePath.startsWith(resolvedWorkspaceDir)) {
        console.warn(`[SiliuController] saveImage: path ${savePath} is outside workspace, forcing to downloads dir`);
        const filename = path.basename(savePath);
        savePath = path.join(downloadsDir, filename);
      }
    }
    
    // 确保有扩展名
    if (!path.extname(savePath)) {
      savePath += '.jpg';
    }
    
    // 【防止重复】如果文件已存在，添加序号
    const originalPath = savePath;
    let counter = 1;
    const ext = path.extname(savePath);
    const baseName = path.basename(savePath, ext);
    const dir = path.dirname(savePath);
    
    while (fs.existsSync(savePath)) {
      savePath = path.join(dir, `${baseName}(${counter})${ext}`);
      counter++;
      if (counter > 1000) {
        const timestamp = Date.now();
        savePath = path.join(dir, `${baseName}-${timestamp}${ext}`);
        break;
      }
    }
    
    if (savePath !== originalPath) {
      console.log(`[SiliuController] saveImage: file already exists, using ${savePath}`);
    }
    
    // 确保目录存在
    const finalDir = path.dirname(savePath);
    if (!fs.existsSync(finalDir)) {
      fs.mkdirSync(finalDir, { recursive: true });
    }
    
    // 【添加蓝色标记】在图片位置显示视觉标记
    await this._showRightClickMarker(activeView.view, x, y);
    
    console.log(`[SiliuController] Triggering download via downloadURL: ${imageInfo.src}`);
    
    // 设置监听器获取下载信息（不阻止对话框弹出）
    const downloadInfo = await new Promise((resolve) => {
      const ses = webContents.session;
      let downloadItem = null;
      
      const onWillDownload = (event, item, wc) => {
        // 不调用 event.preventDefault()，让对话框正常弹出
        const fileName = item.getFilename();
        const totalBytes = item.getTotalBytes();
        
        console.log(`[SiliuController] Download started: ${fileName} (${totalBytes} bytes)`);
        
        // 监听下载完成
        item.once('done', (evt, state) => {
          ses.removeListener('will-download', onWillDownload);
          
          if (state === 'completed') {
            const savePath = item.getSavePath();
            let fileSize = 0;
            try {
              const fs = require('fs');
              fileSize = fs.statSync(savePath).size;
            } catch (e) {
              fileSize = totalBytes;
            }
            
            resolve({
              success: true,
              fileName: path.basename(savePath),
              filePath: savePath,
              fileSize: fileSize,
              state: 'completed'
            });
          } else {
            resolve({
              success: false,
              fileName: fileName,
              state: state,
              error: `下载失败: ${state}`
            });
          }
        });
        
        // 30秒超时保护
        let resolved = false;
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            ses.removeListener('will-download', onWillDownload);
            resolve({
              success: false,
              fileName: fileName,
              state: 'timeout',
              error: '下载超时'
            });
          }
        }, 30000);
      };
      
      // 临时监听 will-download
      ses.once('will-download', onWillDownload);
      
      // 触发下载
      webContents.downloadURL(imageInfo.src);
      
      // 5秒超时（如果对话框未被处理）
      setTimeout(() => {
        ses.removeListener('will-download', onWillDownload);
        resolve({
          success: true,
          downloadTriggered: true,
          waitingForDialog: true,
          message: '下载已触发，等待系统对话框处理...'
        });
      }, 5000);
    });
    
    // 如果下载已完成，返回完整信息
    if (downloadInfo.state === 'completed') {
      return {
        success: true,
        saveComplete: true,
        fileName: downloadInfo.fileName,
        filePath: downloadInfo.filePath,
        fileSize: downloadInfo.fileSize,
        imageSrc: imageInfo.src,
        message: `图片 "${downloadInfo.fileName}" (${this._formatFileSize(downloadInfo.fileSize)}) 已保存完成，路径: ${downloadInfo.filePath}`
      };
    }
    
    // 如果还在等待对话框处理，返回提示信息
    return {
      success: true,
      downloadTriggered: true,
      suggestedPath: savePath,
      fileName: path.basename(savePath),
      imageSrc: imageInfo.src,
      nextStep: 'download',
      message: `已触发图片下载（蓝色标记处），系统保存对话框已弹出，请使用 download 操作完成保存，建议路径: ${savePath}`
    };
  }
  
  /**
   * 显示右键位置的视觉标记（蓝色圆圈，区别于点击的红色）
   */
  async _showRightClickMarker(webContentsView, xPercent, yPercent) {
    try {
      const viewSize = webContentsView.getBounds();
      const x = Math.round(xPercent * viewSize.width);
      const y = Math.round(yPercent * viewSize.height);
      
      await webContentsView.webContents.executeJavaScript(`
        (function() {
          const marker = document.createElement('div');
          marker.id = 'siliu-rightclick-marker';
          marker.style.cssText = 
            'position: fixed;' +
            'left: ' + ${x} + 'px;' +
            'top: ' + ${y} + 'px;' +
            'width: 24px;' +
            'height: 24px;' +
            'border-radius: 50%;' +
            'background: rgba(0, 100, 255, 0.8);' +
            'border: 3px solid white;' +
            'box-shadow: 0 0 12px rgba(0,100,255,0.6);' +
            'transform: translate(-50%, -50%);' +
            'z-index: 999999;' +
            'pointer-events: none;' +
            'animation: siliu-rightclick-pulse 0.6s ease-in-out 3;';
          
          const style = document.createElement('style');
          style.textContent = 
            '@keyframes siliu-rightclick-pulse {' +
            '0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }' +
            '50% { transform: translate(-50%, -50%) scale(1.4); opacity: 0.8; }' +
            '}';
          document.head.appendChild(style);
          document.body.appendChild(marker);
          
          // 添加"右键"标签
          const label = document.createElement('div');
          label.textContent = '右键';
          label.style.cssText = 
            'position: fixed;' +
            'left: ' + (${x} + 18) + 'px;' +
            'top: ' + (${y} - 28) + 'px;' +
            'background: rgba(0, 100, 255, 0.9);' +
            'color: white;' +
            'padding: 4px 10px;' +
            'border-radius: 4px;' +
            'font-size: 12px;' +
            'font-weight: bold;' +
            'z-index: 999999;' +
            'pointer-events: none;' +
            'box-shadow: 0 2px 8px rgba(0,0,0,0.3);';
          label.id = 'siliu-rightclick-label';
          document.body.appendChild(label);
          
          // 2秒后移除
          setTimeout(() => {
            const m = document.getElementById('siliu-rightclick-marker');
            const l = document.getElementById('siliu-rightclick-label');
            const s = document.querySelector('style[data-rightclick-style]');
            if (m) m.remove();
            if (l) l.remove();
          }, 2000);
          
          return true;
        })();
      `);
    } catch (err) {
      console.error('[SiliuController] Failed to show right-click marker:', err);
    }
  }

  /**
   * 格式化文件大小
   */
  _formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

module.exports = SiliuController;
