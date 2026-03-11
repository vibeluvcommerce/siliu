/**
 * Toast Module - 消息提示模块
 * 支持多窗口，每个窗口独立显示
 */

class ToastModule {
  constructor(coreModule) {
    this.core = coreModule;
  }

  /**
   * 显示 toast
   */
  showToast(message, type = 'success') {
    this.core.sendToRenderer('toast:show', { message, type });
  }

  /**
   * 显示 AdBlock toast
   */
  showAdBlockToast(blocked) {
    this.core.sendToRenderer('toast:adblock', { blocked });
  }
}

module.exports = ToastModule;
