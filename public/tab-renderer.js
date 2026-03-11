// src/tab-manager/tab-renderer.js
// 解耦的标签页渲染管理器

/**
 * 标签页渲染管理器
 * 只负责 UI 渲染，不处理业务逻辑
 */
class TabRenderer {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.options = {
      minTabWidth: 80,
      maxTabWidth: 200,
      defaultTabWidth: 160,
      ...options
    };

    this.tabs = new Map(); // viewId -> tabElement
    this.activeTabId = null;
    this.pinnedTabs = new Set();
    this.draggedTab = null;
    this.currentMenu = null; // 当前打开的菜单

    // 将 tab-controls 移动到容器内（如果存在）
    this.moveTabControlsToContainer();

    this.setupContainerListeners();
    this.setupGlobalListeners();
  }

  // 将 newtab 按钮移动到容器内
  moveTabControlsToContainer() {
    const tabControls = document.getElementById('tab-controls');
    if (tabControls && this.container) {
      this.container.appendChild(tabControls);
    }
  }

  // ========== 容器事件 ==========
  setupContainerListeners() {
    // 鼠标滚轮横向滚动
    this.container.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        this.container.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    // 窗口大小变化时调整宽度
    window.addEventListener('resize', () => this.adjustTabWidths());
  }

  // ========== 全局事件（用于菜单互斥） ==========
  setupGlobalListeners() {
    // 点击其他地方关闭菜单
    document.addEventListener('click', (e) => {
      if (this.currentMenu && !this.currentMenu.contains(e.target)) {
        this.closeCurrentMenu();
      }
    });

    // ESC 关闭菜单
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.currentMenu) {
        this.closeCurrentMenu();
      }
    });
  }

  // ========== 关闭当前菜单（互斥） ==========
  closeCurrentMenu() {
    if (this.currentMenu) {
      this.currentMenu.remove();
      this.currentMenu = null;
    }
  }

  // ========== 创建标签页 ==========
  createTab(viewId, options = {}) {
    const { title = '新标签页', url = '', favicon = '', isPinned = false } = options;

    // 确保 viewId 是字符串（统一键类型）
    const vid = String(viewId);

    const tab = document.createElement('div');
    tab.className = 'tab' + (isPinned ? ' pinned' : '');
    tab.dataset.viewId = vid;
    tab.dataset.url = url || ''; // 存储 URL 供拖拽使用

    const faviconHtml = favicon
      ? `<img src="${favicon}" class="tab-favicon" onerror="this.style.display='none'">`
      : `<i class="ph ph-globe tab-favicon" style="font-size: 16px;"></i>`;

    tab.innerHTML = `
      ${faviconHtml}
      <span class="tab-title">${this.escapeHtml(title)}</span>
      <button class="tab-close" title="关闭标签页">
        <i class="ph ph-x"></i>
      </button>
    `;

    // 绑定事件
    this.bindTabEvents(tab, vid);

    // 存储引用（统一使用字符串作为键）
    this.tabs.set(vid, tab);
    if (isPinned) this.pinnedTabs.add(vid);

    // 获取 newtab 按钮
    const tabControls = document.getElementById('tab-controls');

    // 添加到容器
    if (isPinned) {
      // 固定标签放在最前面
      const firstNormalTab = this.container.querySelector('.tab:not(.pinned)');
      if (firstNormalTab) {
        this.container.insertBefore(tab, firstNormalTab);
      } else {
        // 如果没有普通标签，插入到 newtab 按钮之前
        if (tabControls) {
          this.container.insertBefore(tab, tabControls);
        } else {
          this.container.appendChild(tab);
        }
      }
    } else {
      // 普通标签插入到 newtab 按钮之前
      if (tabControls) {
        this.container.insertBefore(tab, tabControls);
      } else {
        this.container.appendChild(tab);
      }
    }

    this.adjustTabWidths();
    this.scrollToTab(tab);

    return tab;
  }

  // ========== 绑定标签页事件 ==========
  bindTabEvents(tab, viewId) {
    // 点击切换
    tab.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) {
        // 点击关闭按钮
        this.emit('tab:close', viewId);
      } else {
        // 点击标签切换
        this.emit('tab:activate', viewId);
      }
    });

    // 双击阻止冒泡（防止触发标题栏双击最大化）
    tab.addEventListener('dblclick', (e) => {
      e.stopPropagation();
    });

    // 拖拽
    this.setupDragAndDrop(tab, viewId);

    // 右键菜单 - 使用鼠标位置
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // 关闭当前菜单（互斥）
      this.closeCurrentMenu();

      this.emit('tab:contextmenu', {
        viewId,
        isPinned: this.pinnedTabs.has(String(viewId)),
        x: e.clientX,  // 鼠标X坐标
        y: e.clientY   // 鼠标Y坐标
      });
    });
  }

  // ========== 拖拽功能 ==========
  setupDragAndDrop(tab, viewId) {
    tab.draggable = true;

    tab.addEventListener('dragstart', (e) => {
      this.draggedTab = tab;
      tab.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', viewId);
    });

    tab.addEventListener('dragend', (e) => {
      tab.classList.remove('dragging');

      // 检测是否拖出窗口（创建新窗口）
      const rect = document.body.getBoundingClientRect();
      if (e.clientX < 0 || e.clientX > rect.width || e.clientY < 0 || e.clientY > 40) {
        this.emit('tab:detach', viewId);
      }

      this.draggedTab = null;
      this.container.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over'));
    });

    tab.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (this.draggedTab && this.draggedTab !== tab) {
        tab.classList.add('drag-over');
      }
    });

    tab.addEventListener('dragleave', () => {
      tab.classList.remove('drag-over');
    });

    tab.addEventListener('drop', (e) => {
      e.preventDefault();
      tab.classList.remove('drag-over');

      if (this.draggedTab && this.draggedTab !== tab) {
        const allTabs = [...this.container.querySelectorAll('.tab')];
        const draggedIndex = allTabs.indexOf(this.draggedTab);
        const targetIndex = allTabs.indexOf(tab);

        if (draggedIndex < targetIndex) {
          tab.after(this.draggedTab);
        } else {
          tab.before(this.draggedTab);
        }

        // 通知外部顺序变化
        const newOrder = [...this.container.querySelectorAll('.tab')].map(t => t.dataset.viewId);
        this.emit('tab:reorder', newOrder);
      }
    });
  }

  // ========== 更新标签页 ==========
  updateTab(viewId, updates) {
    const vid = String(viewId);
    const tab = this.tabs.get(vid);
    if (!tab) return;

    if (updates.title !== undefined) {
      tab.querySelector('.tab-title').textContent = updates.title;
    }

    if (updates.favicon !== undefined) {
      this.updateFavicon(tab, updates.favicon);
    }

    if (updates.url !== undefined) {
      tab.dataset.url = updates.url; // 更新 URL
    }

    if (updates.isActive !== undefined) {
      tab.classList.toggle('active', updates.isActive);
      if (updates.isActive) {
        this.activeTabId = vid;
        this.scrollToTab(tab);
      }
    }

    if (updates.isMuted !== undefined) {
      this.updateMuteIndicator(tab, updates.isMuted);
    }
  }

  // ========== 更新静音标识 ==========
  updateMuteIndicator(tab, isMuted) {
    let muteIndicator = tab.querySelector('.tab-mute-indicator');

    if (isMuted) {
      if (!muteIndicator) {
        muteIndicator = document.createElement('i');
        muteIndicator.className = 'ph ph-speaker-slash tab-mute-indicator';
        muteIndicator.style.cssText = 'font-size: 12px; color: #5f6368; margin-left: 4px;';
        const titleEl = tab.querySelector('.tab-title');
        if (titleEl) {
          titleEl.after(muteIndicator);
        }
      }
    } else {
      if (muteIndicator) {
        muteIndicator.remove();
      }
    }
  }

  updateFavicon(tab, favicon) {
    let faviconEl = tab.querySelector('.tab-favicon');

    if (faviconEl?.tagName === 'IMG') {
      faviconEl.src = favicon;
      faviconEl.style.display = '';
    } else {
      if (faviconEl) faviconEl.remove();

      const img = document.createElement('img');
      img.className = 'tab-favicon';
      img.src = favicon;
      img.onerror = function() {
        this.outerHTML = '<i class="ph ph-globe tab-favicon" style="font-size: 16px;"></i>';
      };
      tab.insertBefore(img, tab.firstChild);
    }
  }

  // ========== 删除标签页 ==========
  removeTab(viewId) {
    const vid = String(viewId);
    const tab = this.tabs.get(vid);
    if (!tab) return;

    tab.style.opacity = '0';
    tab.style.transform = 'scale(0.9)';

    setTimeout(() => {
      tab.remove();
      this.tabs.delete(vid);
      this.pinnedTabs.delete(vid);
      this.adjustTabWidths();
    }, 150);
  }

  // ========== 固定/取消固定 ==========
  togglePin(viewId) {
    // 确保 viewId 是字符串（IPC 传递可能是数字）
    const vid = String(viewId);
    const tab = this.tabs.get(vid);
    if (!tab) {
      console.error('[TabRenderer] Tab not found for viewId:', vid, 'Available:', [...this.tabs.keys()]);
      return;
    }

    const isPinned = tab.classList.toggle('pinned');
    console.log('[TabRenderer] togglePin:', vid, 'isPinned:', isPinned, 'classList:', [...tab.classList]);

    if (isPinned) {
      this.pinnedTabs.add(vid);
      // 移动到固定区域末尾
      const lastPinned = [...this.container.querySelectorAll('.tab.pinned')].pop();
      if (lastPinned && lastPinned !== tab) {
        lastPinned.after(tab);
      }
    } else {
      this.pinnedTabs.delete(vid);
      // 移动到最后一个固定标签之后
      const lastPinned = [...this.container.querySelectorAll('.tab.pinned')].pop();
      if (lastPinned) {
        lastPinned.after(tab);
      } else {
        this.container.prepend(tab);
      }
      // 取消固定后激活该标签
      this.emit('tab:activate', vid);
    }

    this.adjustTabWidths();
  }

  // ========== 添加组颜色 ==========
  addGroupColor(viewId, color) {
    const vid = String(viewId);
    const tab = this.tabs.get(vid);
    if (tab) {
      tab.style.borderLeft = `3px solid ${color}`;
    }
  }

  // ========== 调整标签宽度 ==========
  // 使用固定宽度，不再随标签数量自动缩小
  adjustTabWidths() {
    const tabs = this.container.querySelectorAll('.tab');

    tabs.forEach(tab => {
      if (tab.classList.contains('pinned')) {
        tab.style.width = '36px';
        tab.style.minWidth = '36px';
        tab.style.maxWidth = '36px';
      } else {
        // 固定宽度 180px，不随数量变化
        tab.style.width = '180px';
        tab.style.minWidth = '180px';
        tab.style.maxWidth = '180px';
      }
    });
  }

  // ========== 获取所有标签数据（用于下拉列表） ==========
  getAllTabs() {
    const tabs = [];
    this.container.querySelectorAll('.tab').forEach(tab => {
      tabs.push({
        viewId: tab.dataset.viewId,
        title: tab.querySelector('.tab-title')?.textContent || '新标签页',
        isPinned: tab.classList.contains('pinned'),
        isActive: tab.classList.contains('active')
      });
    });
    return tabs;
  }

  // ========== 滚动到标签 ==========
  scrollToTab(tab) {
    const containerRect = this.container.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const relativeLeft = tabRect.left - containerRect.left + this.container.scrollLeft;

    if (tabRect.left < containerRect.left || tabRect.right > containerRect.right) {
      const scrollTarget = relativeLeft - (containerRect.width / 2) + (tabRect.width / 2);
      this.container.scrollTo({ left: scrollTarget, behavior: 'smooth' });
    }
  }

  // ========== 关闭其他/右侧标签 ==========
  closeOthers(exceptViewId) {
    const vid = String(exceptViewId);
    this.tabs.forEach((tab, viewId) => {
      if (viewId !== vid) {
        this.emit('tab:close', viewId);
      }
    });
  }

  closeRight(viewId) {
    const vid = String(viewId);
    const allTabs = [...this.container.querySelectorAll('.tab')];
    const index = allTabs.findIndex(t => t.dataset.viewId === vid);
    if (index === -1) return;
    allTabs.slice(index + 1).forEach(t => {
      this.emit('tab:close', t.dataset.viewId);
    });
  }

  // ========== 工具方法 ==========
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ========== 事件发射器（简单实现） ==========
  emit(eventName, data) {
    if (this._listeners?.[eventName]) {
      this._listeners[eventName].forEach(cb => cb(data));
    }
  }

  on(eventName, callback) {
    if (!this._listeners) this._listeners = {};
    if (!this._listeners[eventName]) this._listeners[eventName] = [];
    this._listeners[eventName].push(callback);
  }

  off(eventName, callback) {
    if (!this._listeners?.[eventName]) return;
    const index = this._listeners[eventName].indexOf(callback);
    if (index > -1) this._listeners[eventName].splice(index, 1);
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TabRenderer;
}
