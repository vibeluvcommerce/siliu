// src/siliu-controller/system-controller.js
// 系统级键鼠控制器 - 已禁用
// 原实现已移除，避免与用户抢鼠标

const PlatformController = require('./platform-controller');

class SystemController extends PlatformController {
  constructor(options = {}) {
    super(options);
    console.log('[SystemController] Disabled - using CDP/JS mode only');
  }
}

module.exports = SystemController;
