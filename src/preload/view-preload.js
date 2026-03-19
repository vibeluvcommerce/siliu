/**
 * BrowserView Preload Script
 * 在页面加载前注入滚动条样式（仅主滚动条）
 * 同时处理链接右键菜单和暴露必要的 API
 */

const { contextBridge, ipcRenderer } = require('electron');

// 暴露 API 给设置页面等内部页面使用
contextBridge.exposeInMainWorld('siliuAPI', {
  // Copilot 配置相关
  copilotGetConfig: () => ipcRenderer.invoke('copilot:getConfig'),
  copilotSaveConfig: (config) => ipcRenderer.invoke('copilot:saveConfig', config),
  copilotResetConfig: (serviceType) => ipcRenderer.invoke('copilot:resetConfig', serviceType),
  copilotTestConnection: (config) => ipcRenderer.invoke('copilot:testConnection', config),

  // 窗口控制
  openDevTools: () => ipcRenderer.invoke('window:openDevTools'),

  // 关闭当前视图（设置页面用）
  closeCurrentView: () => ipcRenderer.send('view:closeCurrent'),

  // 显示 Toast（设置页面用）
  showToast: (message, type, duration) => ipcRenderer.invoke('view:showToast', { message, type, duration }),

  // 事件监听
  on: (channel, callback) => {
    const validChannels = ['copilot:configSaved', 'copilot:connectionTested'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  }
});

// ========== Agent Editor: 标注点击消息转发 ==========
// 监听页面内脚本发来的 postMessage，转发到主进程
console.log('[Agent Editor Preload] Setting up message listener');
window.addEventListener('message', (e) => {
  console.log('[Agent Editor Preload] Message received, type:', e.data?.type);
  if (e.data?.type === 'AGENT_EDITOR_CLICK') {
    console.log('[Agent Editor Preload] Forwarding click to main process, data:', e.data);
    // 转发到主进程（包含完整坐标信息）
    ipcRenderer.send('view:annotationClick', {
      type: e.data.type,
      viewportX: e.data.viewportX,
      viewportY: e.data.viewportY,
      docX: e.data.docX,
      docY: e.data.docY,
      scrollX: e.data.scrollX,
      scrollY: e.data.scrollY,
      tag: e.data.tag || 'element',
      selector: e.data.selector || '',
      url: e.data.url || location.href,
      viewId: null // 主进程会根据 sender 识别
    });
  }
  if (e.data?.type === 'AGENT_EDITOR_NAME_CONFIRMED') {
    console.log('[Agent Editor Preload] Name confirmed, forwarding to main:', e.data.name);
    // 转发所有必要字段到主进程
    ipcRenderer.send('view:annotationNameConfirmed', {
      name: e.data.name,
      viewportX: e.data.viewportX,
      viewportY: e.data.viewportY,
      docX: e.data.docX,
      docY: e.data.docY,
      scrollX: e.data.scrollX,
      scrollY: e.data.scrollY,
      viewportWidth: e.data.viewportWidth,
      viewportHeight: e.data.viewportHeight,
      tag: e.data.tag,
      selector: e.data.selector,
      url: e.data.url
      // 注意：截图由主进程捕获并保存，不通过 IPC 传递
    });
  }
  if (e.data?.type === 'AGENT_EDITOR_CANCEL') {
    console.log('[Agent Editor Preload] Cancel clicked, forwarding to shell');
    ipcRenderer.send('view:agentEditorCancel', {});
  }
  if (e.data?.type === 'AGENT_EDITOR_CLOSE') {
    console.log('[Agent Editor Preload] Close clicked, forwarding to shell');
    ipcRenderer.send('view:agentEditorClose', {});
  }
  if (e.data?.type === 'AGENT_EDITOR_CANCEL_ALL') {
    console.log('[Agent Editor Preload] Cancel all clicked, forwarding to shell');
    ipcRenderer.send('view:agentEditorCancelAll', {});
  }
  if (e.data?.type === 'AGENT_EDITOR_PAUSE_STATE') {
    console.log('[Agent Editor Preload] Pause state change:', e.data.isPaused);
    ipcRenderer.send('view:agentEditorPauseState', { isPaused: e.data.isPaused });
  }
  if (e.data?.type === 'AGENT_EDITOR_SAVE') {
    console.log('[Agent Editor Preload] Save agent clicked, forwarding to main:', e.data.config?.metadata?.name);
    ipcRenderer.send('view:agentEditorSave', { config: e.data.config });
  }
});

// 主滚动条美化 CSS - 只针对 html/body
const MAIN_SCROLLBAR_CSS = `
  html::-webkit-scrollbar,
  body::-webkit-scrollbar {
    width: 8px !important;
    height: 8px !important;
  }
  html::-webkit-scrollbar-track,
  body::-webkit-scrollbar-track {
    background: #f1f5f9 !important;
    border-radius: 4px !important;
  }
  html::-webkit-scrollbar-thumb,
  body::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, #94a3b8 0%, #64748b 100%) !important;
    border-radius: 4px !important;
  }
  html::-webkit-scrollbar-thumb:hover,
  body::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(180deg, #64748b 0%, #475569 100%) !important;
  }
  html::-webkit-scrollbar-corner,
  body::-webkit-scrollbar-corner {
    background: transparent !important;
  }
  html, body {
    scrollbar-width: thin !important;
    scrollbar-color: #94a3b8 #f1f5f9 !important;
  }
`;

// 立即注入（同步执行，确保在页面渲染前）
(function injectMainScrollbar() {
  const style = document.createElement('style');
  style.textContent = MAIN_SCROLLBAR_CSS;

  if (document.documentElement) {
    document.documentElement.appendChild(style);
  } else {
    const observer = new MutationObserver((mutations, obs) => {
      if (document.documentElement) {
        document.documentElement.appendChild(style);
        obs.disconnect();
      }
    });
    observer.observe(document, { childList: true });
  }
})();

// DOM 就绪后再注入一次（确保覆盖页面可能设置的样式）
document.addEventListener('DOMContentLoaded', () => {
  const existing = document.querySelector('style[data-siliu-main-scrollbar]');
  if (!existing) {
    const style = document.createElement('style');
    style.setAttribute('data-siliu-main-scrollbar', 'true');
    style.textContent = MAIN_SCROLLBAR_CSS;
    document.head.appendChild(style);
  }

  // 注入到现有 Shadow DOM
  injectIntoShadowRoots(document.body);

  // 监听 Shadow DOM 创建
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          injectIntoShadowRoots(node);
        }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // 设置链接和图片右键菜单
  setupContextMenu();

  // 设置文本编辑操作监听
  setupTextEditHandlers();

  // 设置文件选择器拦截
  setupFileChooserInterception();
});

// 注入样式到 Shadow DOM
function injectIntoShadowRoots(element) {
  if (element.shadowRoot) {
    const existing = element.shadowRoot.querySelector('style[data-siliu-scrollbar]');
    if (!existing) {
      const style = document.createElement('style');
      style.setAttribute('data-siliu-scrollbar', 'true');
      style.textContent = MAIN_SCROLLBAR_CSS;
      element.shadowRoot.appendChild(style);
    }
  }
  element.querySelectorAll('*').forEach((child) => {
    if (child.shadowRoot) {
      const existing = child.shadowRoot.querySelector('style[data-siliu-scrollbar]');
      if (!existing) {
        const style = document.createElement('style');
        style.setAttribute('data-siliu-scrollbar', 'true');
        style.textContent = MAIN_SCROLLBAR_CSS;
        child.shadowRoot.appendChild(style);
      }
    }
  });
}

// 保存右键时的焦点元素
let lastFocusedElement = null;

/**
 * 设置文本编辑操作监听
 */
function setupTextEditHandlers() {
  // 执行剪切
  ipcRenderer.on('editor:cut', () => {
    // 剪切命令依赖于当前选区，而不是焦点元素
    // 对于输入框和普通页面文本都适用
    document.execCommand('cut');
  });

  // 执行复制
  ipcRenderer.on('editor:copy', () => {
    // 复制命令依赖于当前选区，而不是焦点元素
    // 对于输入框和普通页面文本都适用
    document.execCommand('copy');
  });

  // 执行粘贴
  ipcRenderer.on('editor:paste', () => {
    if (lastFocusedElement && document.contains(lastFocusedElement)) {
      lastFocusedElement.focus();
      document.execCommand('paste');
      // 使用 requestAnimationFrame 延迟恢复光标位置
      requestAnimationFrame(() => {
        if (lastFocusedElement && document.contains(lastFocusedElement)) {
          lastFocusedElement.focus();
          // 粘贴后将光标移到末尾
          const isInput = lastFocusedElement.tagName === 'INPUT' || lastFocusedElement.tagName === 'TEXTAREA';
          if (isInput && lastFocusedElement.setSelectionRange) {
            const len = lastFocusedElement.value.length;
            lastFocusedElement.setSelectionRange(len, len);
          }
        }
      });
    }
  });

  // 执行全选
  ipcRenderer.on('editor:select-all', () => {
    // 检查当前是否有选中的文本（在普通页面上）
    const selection = window.getSelection();
    const hasSelection = selection && selection.toString().trim().length > 0;

    // 如果 lastFocusedElement 是可编辑元素，全选该元素内容
    if (lastFocusedElement && document.contains(lastFocusedElement)) {
      const isEditable = lastFocusedElement.tagName === 'INPUT' ||
                        lastFocusedElement.tagName === 'TEXTAREA' ||
                        lastFocusedElement.isContentEditable;

      if (isEditable) {
        lastFocusedElement.focus();
        if (lastFocusedElement.select) {
          // input/textarea 使用 select() 方法
          lastFocusedElement.select();
          return;
        } else if (lastFocusedElement.isContentEditable) {
          // contenteditable 元素
          const range = document.createRange();
          range.selectNodeContents(lastFocusedElement);
          selection.removeAllRanges();
          selection.addRange(range);
          return;
        }
      }
    }

    // 在普通页面上，全选整个文档内容
    if (hasSelection || !lastFocusedElement) {
      // 使用 Selection API 全选文档
      const range = document.createRange();
      range.selectNodeContents(document.body);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });

  // 恢复焦点到之前的输入框
  ipcRenderer.on('editor:restore-focus', () => {
    if (lastFocusedElement && document.contains(lastFocusedElement)) {
      lastFocusedElement.focus();
    }
  });
}

/**
 * 设置链接、图片和文本右键菜单
 */
function setupContextMenu() {
  document.addEventListener('contextmenu', (e) => {
    // 查找点击的元素
    let target = e.target;
    let linkElement = null;
    let imageElement = null;

    // 向上查找最多 5 层
    for (let i = 0; i < 5; i++) {
      if (!target) break;
      if (target.tagName === 'A' && target.href) {
        linkElement = target;
      }
      if (target.tagName === 'IMG' && target.src) {
        imageElement = target;
      }
      if (linkElement && imageElement) break;
      target = target.parentElement;
    }

    // 优先处理图片（如果在链接内的图片）
    if (imageElement) {
      e.preventDefault();
      e.stopPropagation();

      // 使用 screenX/Y，它直接是屏幕坐标
      const imageData = {
        src: imageElement.src,
        alt: imageElement.alt || '',
        x: e.screenX,
        y: e.screenY
      };

      ipcRenderer.send('image:contextmenu', imageData);
      return;
    }

    // 处理链接
    if (linkElement) {
      e.preventDefault();
      e.stopPropagation();

      // 使用 screenX/Y，它直接是屏幕坐标
      const linkData = {
        url: linkElement.href,
        text: linkElement.textContent?.trim() || '',
        x: e.screenX,
        y: e.screenY
      };

      ipcRenderer.send('link:contextmenu', linkData);
      return;
    }

    // 处理文本选中或可编辑区域
    const selection = window.getSelection();
    const selectedText = selection?.toString()?.trim();

    // 检查是否可编辑（input/textarea 或 contenteditable）
    const isEditable = e.target.isContentEditable ||
                      e.target.tagName === 'INPUT' ||
                      e.target.tagName === 'TEXTAREA';

    // 如果有选中文本，或者在可编辑区域（即使无选中文本）
    if (selectedText || isEditable) {
      e.preventDefault();
      e.stopPropagation();

      // 保存右键点击的目标元素（这才是用户想要操作的元素）
      // 如果 e.target 本身就是 input/textarea，直接保存它
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        lastFocusedElement = e.target;
      } else {
        // 向上查找到最近的输入框或可编辑元素
        let targetElement = e.target;
        while (targetElement && targetElement !== document.body) {
          if (targetElement.tagName === 'INPUT' ||
              targetElement.tagName === 'TEXTAREA' ||
              targetElement.isContentEditable) {
            lastFocusedElement = targetElement;
            break;
          }
          targetElement = targetElement.parentElement;
        }
      }

      const textData = {
        text: selectedText || '',
        isEditable: isEditable,
        hasSelection: !!selectedText
      };

      ipcRenderer.send('text:contextmenu', textData);
    }
  }, true);
}

/**
 * 文件选择器拦截系统
 * 阻止系统文件选择器弹出，允许通过 CDP 控制文件上传
 */
function setupFileChooserInterception() {
  console.log('[Siliu Preload] Setting up file chooser interception...');

  // 创建全局拦截器对象
  window.__siliuFileInterceptor = {
    // 存储被拦截的 file input
    interceptedInputs: new Map(),
    
    // 存储待上传的文件路径
    pendingFilePath: null,
    
    // 存储最后捕获的 input
    lastCapturedInput: null,
    
    // 设置待上传文件路径（由 CDP 调用）
    setPendingFile: function(filePath) {
      console.log('[Siliu FileInterceptor] Setting pending file:', filePath);
      this.pendingFilePath = filePath;
      return { success: true };
    },
    
    // 获取最后捕获的 input
    getLastCapturedInput: function() {
      return this.lastCapturedInput;
    },
    
    // 处理文件上传
    handleUpload: function(input) {
      if (!this.pendingFilePath) {
        console.log('[Siliu FileInterceptor] No pending file path');
        return false;
      }
      
      console.log('[Siliu FileInterceptor] Handling upload for:', this.pendingFilePath);
      
      // 通知主进程设置文件
      ipcRenderer.invoke('filechooser:setFile', this.pendingFilePath).then(result => {
        console.log('[Siliu FileInterceptor] Set file result:', result);
        
        // 触发 change 事件
        if (input) {
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('input', { bubbles: true }));
          
          // 触发自定义事件通知页面
          input.dispatchEvent(new CustomEvent('siliuFileSelected', {
            detail: { filePath: this.pendingFilePath },
            bubbles: true
          }));
        }
        
        this.pendingFilePath = null;
      }).catch(err => {
        console.error('[Siliu FileInterceptor] Failed to set file:', err);
      });
      
      return true;
    },
    
    // 创建受控的 file input（作为备用）
    createControlledInput: function() {
      let input = document.getElementById('__siliu_controlled_input__');
      if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.id = '__siliu_controlled_input__';
        input.accept = 'image/*';
        input.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;z-index:-1;';
        
        // 监听 change 事件
        input.addEventListener('change', (e) => {
          console.log('[Siliu FileInterceptor] Controlled input changed:', e);
        });
        
        document.body.appendChild(input);
      }
      return input;
    }
  };

  // 拦截所有 input[type=file] 的创建
  const originalCreateElement = Document.prototype.createElement;
  Document.prototype.createElement = function(tagName, options) {
    const element = originalCreateElement.call(this, tagName, options);
    
    if (tagName.toLowerCase() === 'input') {
      // 使用 MutationObserver 监听 type 属性变化
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.attributeName === 'type' && element.type === 'file') {
            setupInputInterception(element);
          }
        });
      });
      
      observer.observe(element, { attributes: true });
      
      // 立即检查（如果创建时已经设置了 type=file）
      if (element.type === 'file') {
        setupInputInterception(element);
      }
    }
    
    return element;
  };

  // 拦截 input[type=file] 的点击
  function setupInputInterception(input) {
    if (input.__siliu_intercepted__) return;
    input.__siliu_intercepted__ = true;
    
    console.log('[Siliu FileInterceptor] Setting up interception for input:', input);
    
    // 拦截 click 方法
    const originalClick = input.click;
    input.click = function() {
      console.log('[Siliu FileInterceptor] Intercepted click on file input');
      
      window.__siliuFileInterceptor.lastCapturedInput = input;
      
      // 如果有待上传文件，直接处理
      if (window.__siliuFileInterceptor.pendingFilePath) {
        window.__siliuFileInterceptor.handleUpload(input);
        return;
      }
      
      // 否则通知主进程准备上传
      ipcRenderer.send('filechooser:opened', {
        id: input.id,
        name: input.name,
        className: input.className
      });
      
      // 不调用原始 click，阻止系统选择器
      console.log('[Siliu FileInterceptor] Prevented system file chooser');
    };
    
    // 拦截 showPicker 方法（现代浏览器）
    if (input.showPicker) {
      const originalShowPicker = input.showPicker;
      input.showPicker = function() {
        console.log('[Siliu FileInterceptor] Intercepted showPicker');
        window.__siliuFileInterceptor.lastCapturedInput = input;
        
        if (window.__siliuFileInterceptor.pendingFilePath) {
          window.__siliuFileInterceptor.handleUpload(input);
          return Promise.resolve();
        }
        
        ipcRenderer.send('filechooser:opened', {
          id: input.id,
          name: input.name,
          className: input.className
        });
        
        return Promise.resolve();
      };
    }
  }

  // 监听 document 上的点击事件，捕获对 file input 的点击
  document.addEventListener('click', function(e) {
    const target = e.target;
    
    // 检查是否点击了 file input
    if (target.tagName === 'INPUT' && target.type === 'file') {
      console.log('[Siliu FileInterceptor] Click on file input detected');
      window.__siliuFileInterceptor.lastCapturedInput = target;
      setupInputInterception(target);
      
      // 如果有待上传文件，阻止默认行为并处理
      if (window.__siliuFileInterceptor.pendingFilePath) {
        e.preventDefault();
        e.stopPropagation();
        window.__siliuFileInterceptor.handleUpload(target);
        return false;
      }
    }
    
    // 检查是否点击了上传按钮（可能触发 file input）
    // 通过查找父元素中的 file input
    const parent = target.closest?.('[class*="upload"], [class*="image"], [class*="file"], label');
    if (parent) {
      const fileInput = parent.querySelector('input[type="file"]');
      if (fileInput) {
        console.log('[Siliu FileInterceptor] Found file input in parent:', fileInput);
        window.__siliuFileInterceptor.lastCapturedInput = fileInput;
        setupInputInterception(fileInput);
      }
    }
  }, true);

  // 处理已存在的 file input
  document.querySelectorAll('input[type="file"]').forEach(setupInputInterception);
  
  // 监听新添加的 file input
  const bodyObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName === 'INPUT' && node.type === 'file') {
            setupInputInterception(node);
          }
          node.querySelectorAll?.('input[type="file"]').forEach(setupInputInterception);
        }
      });
    });
  });
  
  bodyObserver.observe(document.body, { childList: true, subtree: true });

  console.log('[Siliu Preload] File chooser interception ready');
}

// 暴露文件选择器 API 给页面
contextBridge.exposeInMainWorld('siliuFileChooser', {
  // 设置待上传文件路径
  setPendingFile: (filePath) => {
    if (window.__siliuFileInterceptor) {
      return window.__siliuFileInterceptor.setPendingFile(filePath);
    }
    return { success: false, error: 'Interceptor not ready' };
  },
  
  // 获取最后捕获的 input
  getLastCapturedInput: () => {
    if (window.__siliuFileInterceptor) {
      return window.__siliuFileInterceptor.getLastCapturedInput();
    }
    return null;
  },
  
  // 监听文件选择器打开事件
  onFileChooserOpened: (callback) => {
    ipcRenderer.on('filechooser:opened', (event, data) => {
      callback(data);
    });
  }
});
