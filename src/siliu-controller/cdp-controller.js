// src/siliu-controller/cdp-controller.js
// 基于 CDP 的浏览器控制器

const CDPManager = require('./cdp-manager');

class CDPController {
  constructor(options = {}) {
    this.cdp = new CDPManager(options);
    // 【调试模式】关闭所有拟人化功能以测试执行速度
    // this.humanize = { enabled: false };
    this.humanize = options.humanize || { enabled: true, minDelay: 300, maxDelay: 800 };
    this.nodeIdMap = new Map(); // 缓存节点 ID
  }

  /**
   * 获取连接状态
   */
  get isConnected() {
    return this.cdp?.isConnected === true;
  }

  /**
   * 连接到浏览器
   */
  async connect(targetFilter) {
    return this.cdp.connect(targetFilter);
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.cdp.disconnect();
  }

  /**
   * 随机延迟
   */
  async randomDelay(min = null, max = null) {
    if (!this.humanize.enabled) return;

    const minMs = min || this.humanize.minDelay;
    const maxMs = max || this.humanize.maxDelay;
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;

    await this.sleep(delay);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 贝塞尔曲线鼠标移动（模拟人类自然移动轨迹）
   */
  async humanLikeMouseMove(startX, startY, endX, endY, duration = 300) {
    const steps = Math.max(10, Math.floor(duration / 16)); // 约60fps
    const points = [];

    // 生成贝塞尔曲线控制点（随机偏移）
    const offsetX = (Math.random() - 0.5) * 100;
    const offsetY = (Math.random() - 0.5) * 100;
    const cp1x = startX + (endX - startX) * 0.3 + offsetX;
    const cp1y = startY + (endY - startY) * 0.3 + offsetY;
    const cp2x = startX + (endX - startX) * 0.7 - offsetX;
    const cp2y = startY + (endY - startY) * 0.7 - offsetY;

    // 三次贝塞尔曲线
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Math.pow(1-t, 3) * startX +
                3 * Math.pow(1-t, 2) * t * cp1x +
                3 * (1-t) * Math.pow(t, 2) * cp2x +
                Math.pow(t, 3) * endX;
      const y = Math.pow(1-t, 3) * startY +
                3 * Math.pow(1-t, 2) * t * cp1y +
                3 * (1-t) * Math.pow(t, 2) * cp2y +
                Math.pow(t, 3) * endY;
      points.push({ x: Math.round(x), y: Math.round(y) });
    }

    // 执行鼠标移动（带轻微抖动）
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      // 添加微小抖动（最后几个点不抖动，确保精准点击）
      const jitterX = i < points.length - 3 ? (Math.random() - 0.5) * 2 : 0;
      const jitterY = i < points.length - 3 ? (Math.random() - 0.5) * 2 : 0;

      await this.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x + jitterX,
        y: point.y + jitterY
      });

      // 随机间隔，不是匀速
      const delay = 16 + Math.random() * 8;
      await this.sleep(delay);
    }
  }

  /**
   * 随机停顿（模拟人类思考和反应）
   */
  async humanPause(type = 'normal') {
    const pauses = {
      normal: [200, 500],      // 正常停顿
      think: [800, 1500],      // 思考
      read: [1500, 3000],      // 阅读
      hesitate: [100, 300]     // 犹豫
    };

    const [min, max] = pauses[type] || pauses.normal;
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await this.sleep(delay);
  }

  /**
   * 模拟人类阅读行为（随机滚动）
   */
  async simulateReading() {
    // 随机决定是否滚动
    if (Math.random() > 0.5) {
      const scrollAmount = Math.floor(Math.random() * 200) + 50;
      const direction = Math.random() > 0.5 ? 1 : -1;

      await this.cdp.evaluate(`
        window.scrollBy({ top: ${scrollAmount * direction}, behavior: 'smooth' });
      `);

      await this.humanPause('read');
    }
  }

  /**
   * 获取当前鼠标位置
   */
  async getMousePosition() {
    try {
      const result = await this.cdp.evaluate(`
        ({ x: window.__lastMouseX || 0, y: window.__lastMouseY || 0 })
      `, { returnByValue: true });
      return result.value || { x: 0, y: 0 };
    } catch (e) {
      return { x: 0, y: 0 };
    }
  }

  // ========== 导航操作 ==========

  /**
   * 导航到 URL
   */
  async navigate(url) {
    await this.randomDelay(200, 500);

    let targetUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      targetUrl = 'https://' + url;
    }

    // 使用 CDP 导航
    await this.cdp.send('Page.navigate', { url: targetUrl });

    // 等待加载完成
    await this.cdp.waitForLoad();

    // 额外等待网络空闲（确保动态内容加载）
    try {
      await this.cdp.waitForNetworkIdle(3000, 500);
    } catch (e) {
      // 网络空闲超时没关系，继续
    }

    // 最后再等待一下确保渲染完成
    await this.sleep(500);

    return { success: true, url: targetUrl };
  }

  /**
   * 等待页面加载
   */
  async waitForLoad(timeout = 30000) {
    return this.cdp.waitForLoad(timeout);
  }

  /**
   * 等待网络空闲
   */
  async waitForNetworkIdle(timeout = 5000, idleTime = 500) {
    return this.cdp.waitForNetworkIdle(timeout, idleTime);
  }

  // ========== 元素查询 ==========

  /**
   * 获取文档根节点
   */
  async getDocument() {
    const result = await this.cdp.send('DOM.getDocument');
    return result.root;
  }

  /**
   * 通过选择器查询节点
   */
  async querySelector(selector, nodeId = null) {
    if (!nodeId) {
      const doc = await this.getDocument();
      nodeId = doc.nodeId;
    }

    try {
      const result = await this.cdp.send('DOM.querySelector', {
        nodeId,
        selector
      });
      return result.nodeId;
    } catch (e) {
      return 0; // 未找到
    }
  }

  /**
   * 通过选择器查询所有节点
   */
  async querySelectorAll(selector, nodeId = null) {
    if (!nodeId) {
      const doc = await this.getDocument();
      nodeId = doc.nodeId;
    }

    try {
      const result = await this.cdp.send('DOM.querySelectorAll', {
        nodeId,
        selector
      });
      return result.nodeIds || [];
    } catch (e) {
      return [];
    }
  }

  /**
   * 智能查找元素（通过文本内容）
   * 支持 Shadow DOM 和 iframe
   */
  async findByText(text, tagName = '*') {
    const expression = `
      (function() {
        const targetText = '${text.replace(/'/g, "\\'")}';

        // 检查元素是否匹配
        function matchesText(el) {
          if (!el) return false;
          const inner = (el.innerText || '').trim();
          const textContent = (el.textContent || '').trim();
          const value = (el.value || '').trim();
          const ariaLabel = (el.getAttribute('aria-label') || '').trim();
          const title = (el.title || '').trim();

          return inner === targetText ||
                 inner.includes(targetText) ||
                 textContent === targetText ||
                 textContent.includes(targetText) ||
                 value === targetText ||
                 ariaLabel === targetText ||
                 title === targetText;
        }

        // 搜索普通 DOM
        function searchInDocument(doc) {
          const elements = doc.getElementsByTagName('${tagName}');
          for (let el of elements) {
            if (matchesText(el)) return el;
          }
          return null;
        }

        // 搜索 Shadow DOM
        function searchShadowDOM(root) {
          const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_ELEMENT,
            null,
            false
          );

          let node;
          while (node = walker.nextNode()) {
            if (matchesText(node)) return node;

            // 搜索 shadow root
            if (node.shadowRoot) {
              const found = searchShadowDOM(node.shadowRoot);
              if (found) return found;
            }
          }
          return null;
        }

        // 搜索所有 iframe
        function searchIframes() {
          const frames = document.querySelectorAll('iframe');
          for (let frame of frames) {
            try {
              const frameDoc = frame.contentDocument || frame.contentWindow?.document;
              if (frameDoc) {
                const found = searchInDocument(frameDoc);
                if (found) return found;
              }
            } catch (e) {
              // 跨域 iframe 无法访问，忽略
            }
          }
          return null;
        }

        // 先搜索普通 DOM
        let found = searchInDocument(document);
        if (found) return found;

        // 搜索 Shadow DOM
        found = searchShadowDOM(document);
        if (found) return found;

        // 搜索 iframe
        found = searchIframes();
        if (found) return found;

        return null;
      })()
    `;

    const result = await this.cdp.evaluate(expression, { returnByValue: false });

    if (result.objectId) {
      // 获取节点 ID
      const nodeResult = await this.cdp.send('DOM.requestNode', { objectId: result.objectId });
      return nodeResult.nodeId;
    }

    return 0;
  }

  /**
   * 通过 XPath 查找元素
   */
  async findByXPath(xpath) {
    const expression = `
      (function() {
        const result = document.evaluate(
          '${xpath.replace(/'/g, "\\'")}',
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        return result.singleNodeValue;
      })()
    `;

    const result = await this.cdp.evaluate(expression, { returnByValue: false });

    if (result.objectId) {
      const nodeResult = await this.cdp.send('DOM.requestNode', { objectId: result.objectId });
      return nodeResult.nodeId;
    }

    return 0;
  }

  /**
   * 智能查找 - 尝试多种方法
   */
  async smartFind(selectorOrText) {
    // 防御性检查：处理 undefined 或 null
    if (!selectorOrText) {
      console.warn('[CDPController] smartFind: selectorOrText is null/undefined');
      return 0;
    }
    
    let searchText = selectorOrText;
    
    // 处理 text= 前缀
    if (typeof selectorOrText === 'string' && selectorOrText.startsWith('text=')) {
      searchText = selectorOrText.substring(5);
      return this.findByText(searchText);
    }
    
    // 1. 如果是 XPath
    if (typeof selectorOrText === 'string' && (selectorOrText.startsWith('//') || selectorOrText.startsWith('xpath:'))) {
      const xpath = selectorOrText.replace(/^xpath:/, '');
      return this.findByXPath(xpath);
    }

    // 2. 如果是 CSS 选择器（必须是字符串）
    if (typeof selectorOrText === 'string' && this._isCSSSelector(selectorOrText)) {
      return this.querySelector(selectorOrText);
    }

    // 3. 按文本查找
    return this.findByText(searchText);
  }

  /**
   * 获取节点属性
   */
  async getAttributes(nodeId) {
    try {
      const result = await this.cdp.send('DOM.getAttributes', { nodeId });
      const attrs = {};
      const arr = result.attributes || [];
      for (let i = 0; i < arr.length; i += 2) {
        attrs[arr[i]] = arr[i + 1];
      }
      return attrs;
    } catch (e) {
      return {};
    }
  }

  /**
   * 获取节点文本内容
   */
  async getTextContent(nodeId) {
    try {
      const result = await this.cdp.send('DOM.resolveNode', { nodeId });
      if (result.object) {
        const evalResult = await this.cdp.evaluate(
          `(${result.object.objectId}).textContent`,
          { returnByValue: true }
        );
        return evalResult.value;
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  // ========== 元素交互 ==========

  /**
   * 点击元素（带反爬人类行为模拟）
   * 支持 CSS 选择器、文本内容、XPath
   */
  async click(selectorOrText, options = {}) {
    // 防御性检查
    if (!selectorOrText) {
      throw new Error(`Invalid selector for click: ${selectorOrText}`);
    }
    
    // 【快速模式】如果关闭拟人化，使用简单点击
    if (!this.humanize.enabled) {
      return this._fastClick(selectorOrText, options);
    }

    // 随机初始停顿（模拟人类反应时间）
    await this.humanPause('normal');

    // 智能等待元素出现（减少重试，增加单次等待时间）
    let nodeId = 0;
    let attempts = 0;
    const maxAttempts = 3; // 减少重试次数

    while (nodeId === 0 && attempts < maxAttempts) {
      nodeId = await this.smartFind(selectorOrText);

      if (nodeId === 0) {
        attempts++;
        if (attempts < maxAttempts) {
          console.log(`[CDPController] Element not found, waiting... (${attempts}/${maxAttempts})`);
          // 增加等待时间，更自然
          await this.sleep(1000 + Math.random() * 500);
        }
      }
    }

    if (!nodeId) {
      throw new Error(`Element not found: ${selectorOrText}`);
    }

    // 随机阅读停顿（模拟找到元素后的反应）
    await this.humanPause('hesitate');

    // 滚动到元素可见
    try {
      await this.cdp.send('DOM.scrollIntoViewIfNeeded', { nodeId });
      await this.humanPause('normal'); // 滚动后停顿
    } catch (e) {
      // 某些 CDP 版本不支持，忽略
    }

    // 获取元素位置
    const boxModel = await this.cdp.send('DOM.getBoxModel', { nodeId });
    const { content } = boxModel.model;

    // 计算点击位置（在元素范围内随机，不是中心点）
    const padding = 3; // 边缘留白
    const minX = Math.min(content[0], content[2], content[4], content[6]) + padding;
    const maxX = Math.max(content[0], content[2], content[4], content[6]) - padding;
    const minY = Math.min(content[1], content[3], content[5], content[7]) + padding;
    const maxY = Math.max(content[1], content[3], content[5], content[7]) - padding;
    
    const targetX = minX + Math.random() * (maxX - minX);
    const targetY = minY + Math.random() * (maxY - minY);

    // 获取当前鼠标位置（或从屏幕中心开始）
    const startPos = await this.getMousePosition();
    const startX = startPos.x || 100;
    const startY = startPos.y || 100;

    // 模拟人类鼠标移动轨迹
    const moveDuration = 200 + Math.random() * 300; // 200-500ms 移动时间
    await this.humanLikeMouseMove(startX, startY, targetX, targetY, moveDuration);

    // 停顿一下再点击（模拟瞄准）
    await this.humanPause('hesitate');

    // 模拟鼠标按下
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: targetX,
      y: targetY,
      button: 'left',
      clickCount: options.doubleClick ? 2 : 1
    });

    // 随机按压时间（人类不会瞬间松开）
    await this.sleep(50 + Math.random() * 100);

    // 模拟鼠标释放
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: targetX,
      y: targetY,
      button: 'left',
      clickCount: options.doubleClick ? 2 : 1
    });

    // 点击后随机停顿
    await this.randomDelay(100, 400);

    // 偶尔模拟阅读行为
    if (Math.random() > 0.7) {
      await this.simulateReading();
    }

    return { success: true, position: { x: targetX, y: targetY } };
  }

  /**
   * 快速点击模式（无拟人化）
   */
  async _fastClick(selectorOrText, options = {}) {
    // 查找元素
    let nodeId = await this.smartFind(selectorOrText);
    
    if (!nodeId) {
      // 等待一下再试
      await this.sleep(500);
      nodeId = await this.smartFind(selectorOrText);
      if (!nodeId) {
        throw new Error(`Element not found: ${selectorOrText}`);
      }
    }

    // 滚动到元素可见
    try {
      await this.cdp.send('DOM.scrollIntoViewIfNeeded', { nodeId });
    } catch (e) {
      // 忽略
    }

    // 获取元素中心位置
    const boxModel = await this.cdp.send('DOM.getBoxModel', { nodeId });
    const { content } = boxModel.model;
    const targetX = (content[0] + content[4]) / 2;
    const targetY = (content[1] + content[5]) / 2;

    // 直接点击（无动画）
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: targetX,
      y: targetY,
      button: 'left',
      clickCount: options.doubleClick ? 2 : 1
    });
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: targetX,
      y: targetY,
      button: 'left',
      clickCount: options.doubleClick ? 2 : 1
    });

    return { success: true, position: { x: targetX, y: targetY } };
  }

  /**
   * 在页面上显示点击位置的视觉标记（调试用途）
   * 显示一个红色圆点，持续1.5秒后消失
   */
  async showClickMarker(x, y, width, height) {
    try {
      // 在页面注入视觉标记
      const markerScript = `
        (function() {
          // 创建标记元素
          const marker = document.createElement('div');
          marker.id = 'siliu-click-marker';
          marker.style.cssText = 
            'position: fixed;' +
            'left: ' + ${x} + 'px;' +
            'top: ' + ${y} + 'px;' +
            'width: 20px;' +
            'height: 20px;' +
            'border-radius: 50%;' +
            'background: rgba(255, 0, 0, 0.8);' +
            'border: 3px solid white;' +
            'box-shadow: 0 0 10px rgba(0,0,0,0.5);' +
            'transform: translate(-50%, -50%);' +
            'z-index: 999999;' +
            'pointer-events: none;' +
            'animation: siliu-marker-pulse 0.5s ease-in-out 3;';
          
          // 添加动画样式
          const style = document.createElement('style');
          style.textContent = 
            '@keyframes siliu-marker-pulse {' +
            '0%, 100% { transform: translate(-50%, -50%) scale(1); }' +
            '50% { transform: translate(-50%, -50%) scale(1.3); }' +
            '}';
          document.head.appendChild(style);
          
          // 添加标记到页面
          document.body.appendChild(marker);
          
          // 添加坐标标签
          const label = document.createElement('div');
          label.textContent = '${x}, ${y}';
          label.style.cssText = 
            'position: fixed;' +
            'left: ' + (${x} + 15) + 'px;' +
            'top: ' + (${y} - 25) + 'px;' +
            'background: rgba(0, 0, 0, 0.7);' +
            'color: white;' +
            'padding: 4px 8px;' +
            'border-radius: 4px;' +
            'font-size: 12px;' +
            'font-family: monospace;' +
            'z-index: 999999;' +
            'pointer-events: none;';
          document.body.appendChild(label);
          
          // 1.5秒后移除
          setTimeout(() => {
            marker.remove();
            label.remove();
            style.remove();
          }, 1500);
        })()
      `;
      
      await this.cdp.send('Runtime.evaluate', {
        expression: markerScript,
        awaitPromise: false
      });
      
      console.log(`[CDPController] Showed click marker at (${x}, ${y})`);
    } catch (err) {
      // 标记显示失败不影响点击操作
      console.log(`[CDPController] Failed to show click marker:`, err.message);
    }
  }

  /**
   * 坐标点击（视觉驱动）
   * @param {number} xPercent - 百分比坐标 (0-1)
   * @param {number} yPercent - 百分比坐标 (0-1)
   * @param {object} viewportInfo - 视口信息
   * @param {boolean} preserveHover - 是否保持 hover 状态（使用 JS 点击）
   */
  async clickAt(xPercent, yPercent, viewportInfo = null, preserveHover = false) {
    let width, height, dpr = 1;
    
    if (viewportInfo) {
      // 【关键】使用截图时的视口信息来校准坐标
      width = viewportInfo.width;
      height = viewportInfo.height;
      dpr = viewportInfo.devicePixelRatio || 1;
      console.log(`[CDPController] Using recorded viewport: ${width}x${height}, DPR: ${dpr}`);
    } else {
      // 回退到获取当前视口大小
      const metrics = await this.cdp.send('Page.getLayoutMetrics');
      width = metrics.cssVisualViewport?.clientWidth || 1920;
      height = metrics.cssVisualViewport?.clientHeight || 1080;
      // 获取 DPR
      try {
        dpr = await this.cdp.send('Runtime.evaluate', {
          expression: 'window.devicePixelRatio'
        }).then(r => r.result?.value || 1);
      } catch(e) {
        dpr = 1;
      }
      console.log(`[CDPController] Using current viewport: ${width}x${height}, DPR: ${dpr}`);
    }

    // 百分比转像素（CSS 逻辑像素）
    // 如果 viewportInfo 来自截图（可能是物理像素），需要除以 DPR
    let cssWidth = width;
    let cssHeight = height;
    
    // 如果 width/height 是物理像素（来自截图），转换为 CSS 像素
    if (viewportInfo && viewportInfo.devicePixelRatio > 1) {
      cssWidth = width / dpr;
      cssHeight = height / dpr;
    }
    
    const targetX = Math.round(xPercent * cssWidth);
    const targetY = Math.round(yPercent * cssHeight);

    console.log(`[CDPController] Clicking at: (${targetX}, ${targetY}) [${xPercent}, ${yPercent}] preserveHover=${preserveHover}`);
    
    // 【调试】在页面上显示点击位置的视觉标记
    await this.showClickMarker(targetX, targetY, cssWidth, cssHeight);

    // 【关键】hover 后的点击使用 JS 点击，不移动鼠标，保持 hover 状态
    if (preserveHover) {
      console.log(`[CDPController] Using JS click to preserve hover state`);
      
      const clickResult = await this.cdp.evaluate(`
        (function() {
          const x = ${targetX};
          const y = ${targetY};
          
          const el = document.elementFromPoint(x, y);
          if (!el) return { success: false, error: 'No element found' };
          
          let clickTarget = el;
          let link = el.tagName === 'A' ? el : el.closest('a');
          
          if (!link && el.querySelector) {
            const innerLink = el.querySelector('a');
            if (innerLink) {
              link = innerLink;
              clickTarget = innerLink;
            }
          }
          
          clickTarget.click();
          clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          
          if (link && link.href) {
            window.location.assign(link.href);
          }
          
          return { 
            success: true, 
            element: clickTarget.tagName,
            className: clickTarget.className,
            text: clickTarget.textContent?.substring(0, 50),
            href: link?.href || null
          };
        })()
      `, { returnByValue: true });
      
      console.log(`[CDPController] JS click result:`, clickResult);
      return { success: clickResult?.success ?? true, position: { x: targetX, y: targetY }, jsClick: true };
    }
    
    // 【普通点击】使用 CDP 鼠标点击，有视觉反馈
    if (!this.humanize.enabled) {
      // 【快速模式】直接点击，不移动鼠标
      await this.cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: targetX,
        y: targetY,
        button: 'left',
        clickCount: 1
      });
      await this.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: targetX,
        y: targetY,
        button: 'left',
        clickCount: 1
      });
      return { success: true, position: { x: targetX, y: targetY } };
    }

    // 拟人化模式：带鼠标移动动画
    await this.humanPause('normal');

    // 获取当前鼠标位置
    const startPos = await this.getMousePosition();
    const startX = startPos.x || 100;
    const startY = startPos.y || 100;

    // 模拟人类鼠标移动
    const moveDuration = 200 + Math.random() * 300;
    await this.humanLikeMouseMove(startX, startY, targetX, targetY, moveDuration);

    // 停顿一下再点击
    await this.humanPause('hesitate');

    // 鼠标按下
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: targetX,
      y: targetY,
      button: 'left',
      clickCount: 1
    });

    // 随机按压时间
    await this.sleep(50 + Math.random() * 100);

    // 鼠标释放
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: targetX,
      y: targetY,
      button: 'left',
      clickCount: 1
    });

    return { success: true, position: { x: targetX, y: targetY } };
  }

  /**
   * 全选文本框内容（Ctrl+A）
   * 支持 CSS 选择器、文本内容、XPath
   */
  async selectAll(selectorOrText) {
    await this.randomDelay(200, 400);

    // 如果提供了选择器，先找到并聚焦元素
    if (selectorOrText) {
      // 处理坐标对象
      if (typeof selectorOrText === 'object' && selectorOrText.x !== undefined) {
        // 坐标方式：直接点击获取焦点
        await this.clickAt(selectorOrText.x, selectorOrText.y);
        await this.sleep(100);
      } else if (typeof selectorOrText === 'string') {
        // 字符串选择器方式
        // 查找元素
        let nodeId = await this.smartFind(selectorOrText);
        if (!nodeId) {
          await this.sleep(500);
          nodeId = await this.smartFind(selectorOrText);
          if (!nodeId) {
            throw new Error(`Element not found: ${selectorOrText}`);
          }
        }

        // 滚动到元素可见
        try {
          await this.cdp.send('DOM.scrollIntoViewIfNeeded', { nodeId });
          await this.sleep(200);
        } catch (e) {
          // 忽略
        }

        // 点击聚焦
        await this.click(selectorOrText, { fast: true });
        await this.sleep(100);
      }
    }

    // 使用 JS 方式全选（比 CDP 键盘事件更可靠）
    await this.cdp.evaluate(`
      (function() {
        const el = document.activeElement;
        if (!el) return { success: false, error: 'No focused element' };
        
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          el.select();
          // 触发 select 事件
          el.dispatchEvent(new Event('select', { bubbles: true }));
          return { success: true, method: 'select', tagName: el.tagName };
        } else if (el.isContentEditable) {
          const range = document.createRange();
          range.selectNodeContents(el);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          return { success: true, method: 'contenteditable' };
        }
        return { success: false, error: 'Element not selectable' };
      })()
    `);

    await this.sleep(100);

    return { success: true };
  }

  /**
   * 上传文件到文件输入框（标准 file input）
   * 使用 JavaScript DataTransfer API，支持普通 DOM 和 Shadow DOM
   * @param {string|object} selectorOrText - CSS选择器、文本或坐标对象 {x, y}
   * @param {string} filePath - 本地文件绝对路径
   */
  async upload(selectorOrText, filePath) {
    await this.randomDelay(300, 600);
    console.log('[CDPController] Upload starting, file:', filePath);

    const path = require('path');
    const fileName = path.basename(filePath);

    // 辅助函数：查找所有 file input
    const findAllFileInputs = async () => {
      const { result } = await this.cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            let inputs = Array.from(document.querySelectorAll('input[type="file"]'));
            const searchShadow = (root) => {
              const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
              let node;
              while (node = walker.nextNode()) {
                if (node.shadowRoot) {
                  inputs.push(...node.shadowRoot.querySelectorAll('input[type="file"]'));
                  searchShadow(node.shadowRoot);
                }
              }
            };
            searchShadow(document.body);
            return { count: inputs.length, inputs: inputs.map((i, idx) => ({index: idx, id: i.id, name: i.name})) };
          })()
        `,
        returnByValue: true
      });
      return result?.value;
    };

    // 步骤1: 查找现有的 file input
    let fileInputs = await findAllFileInputs();
    console.log('[CDPController] Found file inputs:', fileInputs);

    // 步骤2: 如果没有找到，且提供了选择器/坐标，点击触发 file input 创建
    if (!fileInputs || fileInputs.count === 0) {
      if (!selectorOrText) {
        throw new Error('No file input found on page. Please provide a selector or coordinate to click.');
      }
      
      console.log('[CDPController] No file input found, clicking trigger...');
      
      if (typeof selectorOrText === 'object' && selectorOrText.x !== undefined) {
        await this.clickAt(selectorOrText.x, selectorOrText.y);
      } else if (typeof selectorOrText === 'string') {
        await this.click(selectorOrText);
      }

      // 等待 file input 出现
      for (let i = 0; i < 5; i++) {
        await this.sleep(300);
        fileInputs = await findAllFileInputs();
        if (fileInputs?.count > 0) {
          console.log(`[CDPController] File input appeared after ${(i + 1) * 300}ms`);
          break;
        }
      }
    }

    if (!fileInputs || fileInputs.count === 0) {
      throw new Error('No file input found. The page may not support standard file upload.');
    }

    // 步骤3: 在页面中设置文件并触发事件
    console.log('[CDPController] Setting file via JavaScript...');
    
    const { result: setResult } = await this.cdp.send('Runtime.evaluate', {
      expression: `
        (async function() {
          try {
            // 收集所有 file input
            let inputs = Array.from(document.querySelectorAll('input[type="file"]'));
            const searchShadow = (root) => {
              const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
              let node;
              while (node = walker.nextNode()) {
                if (node.shadowRoot) {
                  inputs.push(...node.shadowRoot.querySelectorAll('input[type="file"]'));
                  searchShadow(node.shadowRoot);
                }
              }
            };
            searchShadow(document.body);
            
            // 选择最后一个（通常是最近创建的）
            const input = inputs[inputs.length - 1];
            if (!input) {
              return { success: false, error: 'No file input available' };
            }
            
            // 尝试读取并设置文件
            try {
              const response = await fetch('file://' + ${JSON.stringify(filePath.replace(/\\/g, '/'))});
              const blob = await response.blob();
              const file = new File([blob], ${JSON.stringify(fileName)}, { 
                type: blob.type || 'application/octet-stream'
              });
              
              const dt = new DataTransfer();
              dt.items.add(file);
              input.files = dt.files;
              
              // 触发事件
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new Event('input', { bubbles: true }));
              
              return { 
                success: true, 
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
                inputId: input.id || '(no id)',
                inputName: input.name || '(no name)'
              };
            } catch (fetchErr) {
              // 如果 fetch 失败，至少触发事件
              input.dispatchEvent(new Event('change', { bubbles: true }));
              return { 
                success: true, 
                warning: 'Could not read file content, but events triggered',
                inputId: input.id || '(no id)'
              };
            }
          } catch (err) {
            return { success: false, error: err.message };
          }
        })()
      `,
      returnByValue: true,
      awaitPromise: true
    });

    console.log('[CDPController] Upload result:', setResult?.value);

    if (!setResult?.value?.success) {
      throw new Error(setResult?.value?.error || 'Failed to set file');
    }

    return {
      success: true,
      filePath,
      details: setResult?.value
    };
  }

  /**
   * 输入文本（带反爬人类行为模拟）
   * 支持 CSS 选择器、文本内容、XPath
   */
  async type(selectorOrText, text, options = {}) {
    // 防御性检查
    if (!selectorOrText) {
      throw new Error(`Invalid selector for type: ${selectorOrText}`);
    }
    
    // 随机停顿
    await this.humanPause('normal');

    // 智能等待元素出现（减少重试）
    let nodeId = 0;
    let attempts = 0;
    const maxAttempts = 3;

    while (nodeId === 0 && attempts < maxAttempts) {
      nodeId = await this.smartFind(selectorOrText);

      if (nodeId === 0) {
        attempts++;
        if (attempts < maxAttempts) {
          console.log(`[CDPController] Element not found for type, waiting... (${attempts}/${maxAttempts})`);
          await this.sleep(1000 + Math.random() * 500);
        }
      }
    }

    if (!nodeId) {
      throw new Error(`Element not found: ${selectorOrText}`);
    }

    // 使用自然的点击来获取焦点（如果未指定 skipClick）
    if (!options.skipClick) {
      await this.click(selectorOrText, options);
      // 停顿一下再输入
      await this.humanPause('hesitate');
    }

    // 清空现有内容（模拟人类行为：Ctrl+A 然后 Delete）
    // 注意：如果之前已经执行了 selectAll，应该设置 clear: false 避免重复操作
    if (options.clear !== false) {
      // Ctrl+A 全选
      await this.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'a',
        modifiers: 2 // Ctrl
      });
      await this.sleep(30 + Math.random() * 20);
      await this.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'a',
        modifiers: 2
      });
      await this.sleep(50 + Math.random() * 30);
      
      // Delete 删除
      await this.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Delete'
      });
      await this.sleep(20 + Math.random() * 10);
      await this.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Delete'
      });
      await this.humanPause('normal');
    }

    // 【快速模式】如果关闭拟人化，使用 CDP dispatchKeyEvent 快速输入
    if (!this.humanize.enabled) {
      const chars = text.split('');
      for (const char of chars) {
        await this.cdp.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          text: char
        });
        await this.cdp.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          text: char
        });
      }
      return { success: true, text };
    }

    // 模拟人类打字（带错误和修正）
    const chars = text.split('');
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      
      // 偶尔停顿（模拟思考）
      if (Math.random() > 0.9) {
        await this.humanPause('hesitate');
      }
      
      // 【已禁用】模拟打字错误（极低概率）
      // 为避免输入错误累积，暂时关闭此功能
      // if (Math.random() > 0.98 && char !== ' ') {
      //   const wrongChar = String.fromCharCode(char.charCodeAt(0) + 1);
      //   ...
      // }
      
      // 输入正确字符
      await this.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: char
      });
      await this.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        text: char
      });

      // 模拟人类打字速度（不是匀速）
      // 根据字符类型调整速度
      let baseDelay = 50;
      if (char === ' ') baseDelay = 80; // 空格后稍微停顿
      if (char === ',' || char === '.' || char === '，' || char === '。') baseDelay = 150; // 标点停顿
      if (char >= '\u4e00' && char <= '\u9fff') baseDelay = 120; // 中文字符稍慢
      
      const delay = baseDelay + Math.random() * 80 - 40; // 添加随机波动
      await this.sleep(Math.max(20, delay));
    }

    // 输入完成后停顿
    await this.humanPause('normal');

    return { success: true, text };
  }

  /**
   * 输入文本到当前活动元素（无需先查找元素）
   * 直接使用 CDP dispatchKeyEvent 向当前焦点元素输入
   */
  async typeActive(text) {
    const chars = text.split('');
    for (const char of chars) {
      await this.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: char
      });
      await this.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        text: char
      });
    }
    return { success: true, text };
  }

  /**
   * 按键（如 Enter, Tab, Escape 等）
   */
  async press(key) {
    // 特殊键的映射
    const keyMap = {
      'Enter': { key: 'Enter', code: 'Enter', keyCode: 13, windowsVirtualKeyCode: 13 },
      'Tab': { key: 'Tab', code: 'Tab', keyCode: 9, windowsVirtualKeyCode: 9 },
      'Escape': { key: 'Escape', code: 'Escape', keyCode: 27, windowsVirtualKeyCode: 27 },
      'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, windowsVirtualKeyCode: 40 },
      'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, windowsVirtualKeyCode: 38 },
      'ArrowLeft': { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, windowsVirtualKeyCode: 37 },
      'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, windowsVirtualKeyCode: 39 },
    };
    
    const keyInfo = keyMap[key] || { key, code: key, keyCode: key.charCodeAt(0), windowsVirtualKeyCode: key.charCodeAt(0) };
    
    await this.cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: keyInfo.key,
      code: keyInfo.code,
      keyCode: keyInfo.keyCode,
      windowsVirtualKeyCode: keyInfo.windowsVirtualKeyCode,
      nativeVirtualKeyCode: keyInfo.windowsVirtualKeyCode,
    });
    await this.cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: keyInfo.key,
      code: keyInfo.code,
      keyCode: keyInfo.keyCode,
      windowsVirtualKeyCode: keyInfo.windowsVirtualKeyCode,
      nativeVirtualKeyCode: keyInfo.windowsVirtualKeyCode,
    });
    return { success: true, mode: 'CDP', key };
  }

  /**
   * 滚动页面
   */
  async scroll(direction = 'down', amount = 500) {
    await this.randomDelay();

    const x = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
    const y = direction === 'up' ? -amount : direction === 'down' ? amount : 0;

    await this.cdp.evaluate(`window.scrollBy(${x}, ${y})`);

    await this.sleep(this.humanize.scrollDelay || 200);

    return { success: true, scrollX: x, scrollY: y };
  }

  /**
   * 模拟滚轮事件（适用于抖音等需要 wheel 事件的场景）
   */
  async wheel(direction = 'down', amount = 500) {
    const deltaY = direction === 'up' ? -amount : amount;
    
    // 使用 CDP dispatchMouseEvent 模拟滚轮
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: 0,
      y: 0,
      deltaX: 0,
      deltaY: deltaY
    });

    // 同时在页面中触发 WheelEvent
    await this.cdp.evaluate(`
      (function() {
        const event = new WheelEvent('wheel', {
          deltaY: ${deltaY},
          deltaMode: 0, // DOM_DELTA_PIXEL
          bubbles: true,
          cancelable: true
        });
        document.dispatchEvent(event);
        
        // 同时也触发 scroll 事件作为备选
        window.scrollBy({ top: ${deltaY}, behavior: 'smooth' });
      })()
    `);

    return { success: true, deltaY };
  }

  /**
   * 滚动到元素
   */
  async scrollToElement(selectorOrText) {
    await this.randomDelay();

    let nodeId = 0;

    // 防御性检查
    if (!selectorOrText || typeof selectorOrText !== 'string') {
      throw new Error(`Invalid selector: ${selectorOrText}`);
    }
    
    if (this._isCSSSelector(selectorOrText)) {
      nodeId = await this.querySelector(selectorOrText);
    } else {
      nodeId = await this.findByText(selectorOrText);
    }

    if (!nodeId) {
      throw new Error(`Element not found: ${selectorOrText}`);
    }

    await this.cdp.evaluate(`
      (function() {
        const el = document.querySelector('${selectorOrText.replace(/'/g, "\\'")}');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      })()
    `);

    await this.sleep(500);

    return { success: true };
  }

  // ========== 内容获取 ==========

  /**
   * 获取页面标题
   */
  async getTitle() {
    const result = await this.cdp.evaluate('document.title', { returnByValue: true });
    return result.value;
  }

  /**
   * 获取当前 URL
   */
  async getURL() {
    const result = await this.cdp.evaluate('window.location.href', { returnByValue: true });
    return result.value;
  }

  /**
   * 获取页面内容
   */
  async getContent() {
    const result = await this.cdp.evaluate(`
      document.body.innerText || document.body.textContent || ''
    `, { returnByValue: true });
    return result.value;
  }

  /**
   * 获取页面 HTML
   */
  async getHTML() {
    const result = await this.cdp.evaluate(`
      document.documentElement.outerHTML
    `, { returnByValue: true });
    return result.value;
  }

  /**
   * 获取元素 HTML
   */
  async getElementHTML(selector) {
    const expression = `
      (function() {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        return el ? el.outerHTML : null;
      })()
    `;
    const result = await this.cdp.evaluate(expression, { returnByValue: true });
    return result.value;
  }

  /**
   * 获取元素文本
   */
  async getElementText(selector) {
    const expression = `
      (function() {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        return el ? (el.innerText || el.textContent || '') : null;
      })()
    `;
    const result = await this.cdp.evaluate(expression, { returnByValue: true });
    return result.value;
  }

  /**
   * 获取所有链接
   */
  async getLinks() {
    const result = await this.cdp.evaluate(`
      Array.from(document.querySelectorAll('a[href]')).map(a => ({
        text: a.innerText || a.textContent || '',
        href: a.href
      }))
    `, { returnByValue: true });
    return result.value || [];
  }

  /**
   * 获取所有按钮
   */
  async getButtons() {
    const result = await this.cdp.evaluate(`
      Array.from(document.querySelectorAll('button, [role=\"button\"], input[type=\"submit\"], input[type=\"button\"]')).map(b => ({
        text: b.innerText || b.value || b.textContent || '',
        id: b.id,
        className: b.className
      }))
    `, { returnByValue: true });
    return result.value || [];
  }

  /**
   * 获取所有表单字段
   */
  async getFormFields() {
    const result = await this.cdp.evaluate(`
      Array.from(document.querySelectorAll('input, textarea, select')).map(f => ({
        tag: f.tagName.toLowerCase(),
        type: f.type,
        name: f.name,
        id: f.id,
        placeholder: f.placeholder,
        value: f.value?.substring(0, 100) || ''
      }))
    `, { returnByValue: true });
    return result.value || [];
  }

  // ========== 截图 ==========

  /**
   * 截图
   */
  async screenshot(options = {}) {
    const params = {
      format: options.format || 'png',
      quality: options.quality,
      fromSurface: true
    };

    if (options.fullPage) {
      // 获取完整页面尺寸
      const metrics = await this.cdp.send('Page.getLayoutMetrics');
      params.clip = {
        x: 0,
        y: 0,
        width: metrics.cssContentSize.width,
        height: metrics.cssContentSize.height,
        scale: 1
      };
    }

    const result = await this.cdp.send('Page.captureScreenshot', params);
    return Buffer.from(result.data, 'base64');
  }

  /**
   * 鼠标悬停（hover）- 支持 CSS 选择器、文本内容、XPath、坐标
   * 【注意】CDP 合成鼠标事件无法触发 CSS :hover，需要主动触发 JS 事件
   */
  async hover(selectorOrText, options = {}) {
    await this.randomDelay(200, 400);

    // 支持坐标 hover
    if (options.coordinate || (typeof selectorOrText === 'object' && selectorOrText.x !== undefined)) {
      const { x, y } = options.coordinate || selectorOrText;
      
      // 将百分比坐标转换为像素坐标
      const metrics = await this.cdp.send('Page.getLayoutMetrics');
      const cssWidth = metrics.cssVisualViewport?.clientWidth || 1920;
      const cssHeight = metrics.cssVisualViewport?.clientHeight || 1080;
      const pixelX = Math.round(x * cssWidth);
      const pixelY = Math.round(y * cssHeight);

      // 移动鼠标（视觉反馈）
      const startPos = await this.getMousePosition();
      await this.humanLikeMouseMove(startPos.x || 100, startPos.y || 100, pixelX, pixelY, 300);

      // 【关键】在对应坐标位置触发 hover 效果
      await this.cdp.evaluate(`
        (function() {
          const x = ${pixelX};
          const y = ${pixelY};
          
          // 获取该位置的元素
          const el = document.elementFromPoint(x, y);
          if (!el) return { success: false, error: 'No element at position' };
          
          // 触发 mouseenter 和 mouseover 事件
          const mouseenterEvent = new MouseEvent('mouseenter', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y
          });
          el.dispatchEvent(mouseenterEvent);
          
          const mouseoverEvent = new MouseEvent('mouseover', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y
          });
          el.dispatchEvent(mouseoverEvent);
          
          // 触发 mousemove（某些框架依赖）
          const mousemoveEvent = new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y
          });
          el.dispatchEvent(mousemoveEvent);
          
          // 添加 hover 类（兼容某些 CSS 框架）
          el.classList.add('hover');
          
          // 向上冒泡，触发父元素的 hover
          let parent = el.parentElement;
          while (parent) {
            parent.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            parent.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            parent.classList.add('hover');
            parent = parent.parentElement;
          }
          
          return { 
            success: true, 
            element: el.tagName,
            className: el.className,
            id: el.id
          };
        })()
      `, { returnByValue: true });

      // 悬停一段时间（保持 hover 状态）
      await this.humanPause('normal');

      return { success: true, position: { x: pixelX, y: pixelY }, mode: 'CDP' };
    }

    // 查找元素
    let nodeId = await this.smartFind(selectorOrText);

    if (!nodeId) {
      await this.sleep(500);
      nodeId = await this.smartFind(selectorOrText);
      if (!nodeId) {
        throw new Error(`Element not found: ${selectorOrText}`);
      }
    }

    // 滚动到元素可见
    try {
      await this.cdp.send('DOM.scrollIntoViewIfNeeded', { nodeId });
      await this.sleep(200);
    } catch (e) {
      // 忽略
    }

    // 获取元素信息
    const boxModel = await this.cdp.send('DOM.getBoxModel', { nodeId });
    const { content } = boxModel.model;
    const targetX = (content[0] + content[4]) / 2;
    const targetY = (content[1] + content[5]) / 2;

    // 移动鼠标到元素位置
    const startPos = await this.getMousePosition();
    await this.humanLikeMouseMove(startPos.x || 100, startPos.y || 100, targetX, targetY, 300);

    // 【关键】在元素上触发 hover 事件
    const objectId = (await this.cdp.send('DOM.resolveNode', { nodeId })).object.objectId;
    await this.cdp.evaluate(`
      (function() {
        const el = ${objectId};
        if (!el) return { success: false, error: 'Element not found' };
        
        // 触发 mouseenter 和 mouseover
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }));
        
        // 添加 hover 类
        el.classList.add('hover');
        
        // 向上冒泡
        let parent = el.parentElement;
        while (parent) {
          parent.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          parent.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          parent.classList.add('hover');
          parent = parent.parentElement;
        }
        
        return { 
          success: true, 
          element: el.tagName,
          className: el.className,
          id: el.id
        };
      })()
    `, { returnByValue: true });

    // 悬停一段时间
    await this.humanPause('normal');

    return { success: true, position: { x: targetX, y: targetY }, mode: 'CDP' };
  }

  /**
   * 选择下拉框选项 - 支持 select 标签和 React Select 等自定义组件
   * @param {string} selector - select 元素的选择器
   * @param {string} option - 选项值（可以是 value、text 或 index）
   */
  async selectOption(selector, option) {
    await this.randomDelay(200, 400);

    // 使用 CDP 执行选择
    const result = await this.cdp.evaluate(`
      (function() {
        const selector = '${selector.replace(/'/g, "\\'")}';
        const optionValue = '${option.replace(/'/g, "\\'")}';
        const select = document.querySelector(selector);
        
        if (!select) return { success: false, error: 'Select element not found: ' + selector };
        
        // 【策略1】原生 SELECT 元素
        if (select.tagName === 'SELECT') {
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
              availableOptions: Array.from(select.options).map(o => ({ value: o.value, text: o.text })),
              type: 'native-select'
            };
          }

          // 设置选中值
          select.value = targetOption.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          select.dispatchEvent(new Event('input', { bubbles: true }));

          return { 
            success: true, 
            selectedValue: targetOption.value, 
            selectedText: targetOption.text,
            type: 'native-select'
          };
        }
        
        // 【策略2】React Select / 自定义下拉组件
        // 1. 先点击展开下拉菜单
        select.click();
        select.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        
        // 2. 尝试找到输入框并输入文本来过滤（React Select 支持）
        const input = select.querySelector('input');
        if (input) {
          input.focus();
          // 清空现有内容
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          // 输入目标值
          input.value = optionValue;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keydown', { key: optionValue[0], bubbles: true }));
        }
        
        // 3. 查找并点击匹配的选项（同步执行）
        const findAndClickOption = () => {
          // 查找下拉菜单（React Select 通常使用这些类名）
          const dropdownSelectors = [
            '.css-*-menu',  // React Select 默认类名
            '[class*="-menu"]',
            '[class*="dropdown"]',
            '[class*="options"]', 
            '#react-select-*-listbox'
          ];
          
          let dropdown = null;
          for (const ds of dropdownSelectors) {
            dropdown = document.querySelector(ds);
            if (dropdown) break;
          }
          
          // 如果没找到特定下拉菜单，查找页面上所有可能的选项元素
          if (!dropdown) {
            const allOptions = document.querySelectorAll('[role="option"], [class*="option"]');
            for (const opt of allOptions) {
              const text = (opt.textContent || opt.innerText || '').trim();
              if (text.toLowerCase() === optionValue.toLowerCase()) {
                opt.click();
                opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                return { success: true, type: 'custom-select', method: 'click-exact', text };
              }
            }
            return { success: false, error: 'Option not found in page', searched: optionValue };
          }
          
          // 在下拉菜单中查找
          const options = dropdown.querySelectorAll('[role="option"], [class*="option"]');
          
          for (const opt of options) {
            const text = (opt.textContent || opt.innerText || '').trim();
            // 精确匹配
            if (text.toLowerCase() === optionValue.toLowerCase()) {
              opt.click();
              opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              return { success: true, type: 'custom-select', method: 'click-exact', text };
            }
            // 包含匹配
            if (text.toLowerCase().includes(optionValue.toLowerCase())) {
              opt.click();
              opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              return { success: true, type: 'custom-select', method: 'click-contains', text };
            }
          }
          
          return { 
            success: false, 
            error: 'Option not found in dropdown', 
            searched: optionValue,
            availableOptions: Array.from(options).map(o => o.textContent?.trim()).slice(0, 10)
          };
        };
        
        // 立即执行查找（给 React 一点时间渲染）
        // 使用 Date.now 来强制浏览器刷新
        const start = Date.now();
        while (Date.now() - start < 50) { /* 短暂等待渲染 */ }
        
        return findAndClickOption();
      })()
    `, { returnByValue: true });

    await this.humanPause('normal');

    return { success: result?.success ?? false, selector, option, ...result };
  }

  // ========== 辅助方法 ==========

  _isCSSSelector(str) {
    if (typeof str !== 'string') return false;
    return /^[.#\[\w]/.test(str) || str.includes(' ') || str.includes('>') || str.includes(':');
  }
}

module.exports = CDPController;