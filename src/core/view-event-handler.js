// src/core/view-event-handler.js
// 视图事件处理器 - 处理页面事件（title、favicon、loading等）
// 主滚动条美化（仅 html/body）

// 主滚动条 CSS - 只针对 html/body
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

class ViewEventHandler {
  constructor(tabManager, windowManager) {
    this.tabManager = tabManager;
    this.windowManager = windowManager;
  }

  setupEvents(viewId) {
    const viewData = this.tabManager.getViewData(viewId);
    if (!viewData) return;

    const wc = viewData.view.webContents;

    this.injectMainScrollbarCSS(wc);

    wc.on('will-navigate', () => {
      this.injectMainScrollbarCSS(wc);
    });

    wc.on('page-title-updated', (e, title) => {
      viewData.title = title;
      this.sendToRenderer('tab-title-updated', { id: viewId, title });
      if (this.isActiveView(viewId)) {
        this.sendActiveViewUpdate(viewId);
      }
    });

    wc.on('did-start-loading', () => {
      if (viewData.isLoading) return;
      viewData.isLoading = true;
      viewData.url = wc.getURL();
      this.sendToRenderer('tab-loading-started', { id: viewId, url: viewData.url });
      this.tabManager.emit('taskbar:progress', 0);
      if (this.isActiveView(viewId)) {
        this.sendActiveViewUpdate(viewId, { isLoading: true });
      }
    });

    wc.on('did-start-navigation', () => {
      this.tabManager.emit('taskbar:update-buttons', viewId);
    });

    wc.on('did-navigate', () => {
      this.tabManager.emit('taskbar:update-buttons', viewId);
    });

    wc.on('did-stop-loading', () => {
      const wasLoading = viewData.isLoading;
      viewData.isLoading = false;
      viewData.title = wc.getTitle();
      viewData.url = wc.getURL();
      this.sendToRenderer('tab-loading-stopped', {
        id: viewId,
        title: viewData.title,
        url: viewData.url,
        canGoBack: wc.canGoBack(),
        canGoForward: wc.canGoForward(),
      });
      this.tabManager.emit('taskbar:progress', -1);
      this.tabManager.emit('taskbar:update-buttons', viewId);
      if (this.isActiveView(viewId)) {
        this.sendActiveViewUpdate(viewId, { isLoading: false });
      }
      this.injectMainScrollbarCSS(wc);
    });

    wc.on('dom-ready', () => {
      this.injectMainScrollbarCSS(wc);
      if (this.isActiveView(viewId)) {
        this.sendActiveViewUpdate(viewId);
      }
    });

    wc.on('did-navigate', () => {
      viewData.url = wc.getURL();
      if (this.isActiveView(viewId)) {
        this.sendActiveViewUpdate(viewId);
      }
    });

    wc.on('did-navigate-in-page', () => {
      if (this.isActiveView(viewId)) {
        this.sendActiveViewUpdate(viewId);
      }
    });

    wc.on('page-favicon-updated', (e, favicons) => {
      if (favicons?.length > 0) {
        viewData.favicon = favicons[0];
        this.sendToRenderer('tab-favicon-updated', {
          id: viewId,
          favicon: favicons[0],
        });
      }
    });

    wc.setWindowOpenHandler(({ url }) => {
      this.tabManager.createView(url, this.tabManager.sidebarOpen);
      return { action: 'deny' };
    });
  }

  injectMainScrollbarCSS(webContents) {
    try {
      webContents.insertCSS(MAIN_SCROLLBAR_CSS);
    } catch (err) {}
  }

  isActiveView(viewId) {
    return this.tabManager.getActiveViewId() === viewId;
  }

  sendActiveViewUpdate(viewId, extra = {}) {
    const viewData = this.tabManager.getViewData(viewId);
    if (!viewData) return;
    const wc = viewData.view.webContents;
    this.sendToRenderer('tab-activated', {
      id: viewId,
      url: viewData.url,
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
      isLoading: viewData.isLoading,
      ...extra
    });
  }

  sendToRenderer(channel, data) {
    this.windowManager.sendToRenderer(channel, data);
  }
}

module.exports = ViewEventHandler;
