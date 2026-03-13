// src/core/agent-panel-window.js
// Agent 栏悬浮窗口 - 每个主窗口独立

const { BrowserWindow } = require('electron');
const path = require('path');

class AgentPanelWindow {
  constructor(mainWindow, options = {}) {
    this.mainWindow = mainWindow;
    this.window = null;
    this.isVisible = false;
    
    // 配置
    this.config = {
      width: 64,
      itemHeight: 56,
      padding: 8,
      ...options
    };
    
    // 预置 Agents（第一版硬编码）
    this.agents = [
      { id: 'general', name: '通用助手', icon: '🤖', color: '#1A73E8' },
      { id: 'bilibili', name: 'B站助手', icon: '📺', color: '#00A1D6' },
      { id: 'taobao', name: '淘宝助手', icon: '🛒', color: '#FF5000' },
      { id: 'data', name: '数据采集', icon: '📊', color: '#34A853' },
    ];
    
    this.currentAgent = this.agents[0];
  }

  async create() {
    if (this.window) return;

    this.window = new BrowserWindow({
      width: this.config.width,
      height: this.calculateHeight(),
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      focusable: false, // 不抢焦点
      skipTaskbar: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload/agent-panel-preload.js'),
      },
    });

    // 加载页面
    await this.window.loadFile(path.join(__dirname, '../../public/agent-panel.html'));

    // 初始化位置
    this.updatePosition();

    // 发送初始数据
    this.window.webContents.send('init-agents', {
      agents: this.agents,
      current: this.currentAgent.id,
    });

    // 监听主窗口移动/大小变化
    this.mainWindow.on('move', () => this.updatePosition());
    this.mainWindow.on('resize', () => this.updatePosition());
    this.mainWindow.on('show', () => this.show());
    this.mainWindow.on('hide', () => this.hide());
    this.mainWindow.on('closed', () => this.destroy());

    // IPC 监听
    this.setupIPC();

    this.isVisible = true;
    console.log('[AgentPanel] Created for window');
  }

  calculateHeight() {
    // 计算高度：agents + 分隔线 + 添加按钮 + 上下padding
    const contentHeight = (this.agents.length * this.config.itemHeight) + 48 + 40;
    return contentHeight + (this.config.padding * 2);
  }

  updatePosition() {
    if (!this.window || this.window.isDestroyed()) return;

    const mainBounds = this.mainWindow.getBounds();
    const panelBounds = this.window.getBounds();

    // 计算位置：主窗口左侧居中
    const x = mainBounds.x - this.config.width + 8; // 稍微重叠一点
    const y = mainBounds.y + (mainBounds.height - panelBounds.height) / 2;

    this.window.setPosition(Math.round(x), Math.round(y));
  }

  setupIPC() {
    // 接收来自渲染进程的消息
    this.window.webContents.ipc.on('agent-select', (event, agentId) => {
      this.currentAgent = this.agents.find(a => a.id === agentId);
      console.log('[AgentPanel] Selected:', agentId);
      
      // TODO: 通知主窗口切换 Agent
      this.mainWindow.webContents.send('agent-changed', this.currentAgent);
    });

    this.window.webContents.ipc.on('agent-add', () => {
      console.log('[AgentPanel] Add new agent clicked');
      // TODO: 打开创建 Agent 界面
    });
  }

  show() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.showInactive(); // 不抢焦点
      this.isVisible = true;
    }
  }

  hide() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
      this.isVisible = false;
    }
  }

  destroy() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
      this.window = null;
    }
  }

  // 添加新 Agent
  addAgent(agent) {
    this.agents.push(agent);
    this.updateHeight();
    this.window?.webContents.send('agents-updated', this.agents);
  }

  // 删除 Agent
  removeAgent(agentId) {
    this.agents = this.agents.filter(a => a.id !== agentId);
    this.updateHeight();
    this.window?.webContents.send('agents-updated', this.agents);
  }

  updateHeight() {
    if (!this.window) return;
    const newHeight = this.calculateHeight();
    this.window.setSize(this.config.width, newHeight);
    this.updatePosition();
  }
}

module.exports = AgentPanelWindow;
