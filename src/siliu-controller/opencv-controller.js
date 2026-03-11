// src/siliu-controller/opencv-controller.js
// 基于 OpenCV 图像识别的元素定位 - 已禁用
// 原实现使用 xdotool 进行系统级鼠标点击，已移除以避免与用户抢鼠标
// 
// 替代方案：使用 CDP 的 DOM 操作或 JS 注入

class OpenCVController {
  constructor(options = {}) {
    console.log('[OpenCVController] Disabled - using CDP/JS mode only');
  }

  async findByTemplate() {
    throw new Error('OpenCV controller disabled. Use CDP or JS mode.');
  }

  async findByColor() {
    throw new Error('OpenCV controller disabled. Use CDP or JS mode.');
  }

  async findByAI() {
    throw new Error('OpenCV controller disabled. Use CDP or JS mode.');
  }

  async click() {
    throw new Error('OpenCV controller disabled. Use CDP or JS mode.');
  }

  async _clickAt() {
    throw new Error('OpenCV controller disabled. Use CDP or JS mode.');
  }

  _loadTemplate() {
    throw new Error('OpenCV controller disabled. Use CDP or JS mode.');
  }
}

module.exports = OpenCVController;
