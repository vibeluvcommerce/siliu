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
