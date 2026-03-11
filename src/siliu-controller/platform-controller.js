// src/siliu-controller/platform-controller.js
// 跨平台系统级键鼠控制器 - 已禁用，仅保留 CDP 和 JS 模式
// 原实现（xdotool/nut.js/robotjs）已移除，避免与用户抢鼠标

class PlatformController {
  constructor(options = {}) {
    console.log('[PlatformController] System-level control disabled, using CDP/JS only');
  }

  async click() {
    throw new Error('System-level control disabled. Use CDP or JS mode.');
  }

  async type() {
    throw new Error('System-level control disabled. Use CDP or JS mode.');
  }

  async scroll() {
    throw new Error('System-level control disabled. Use CDP or JS mode.');
  }
}

module.exports = PlatformController;
