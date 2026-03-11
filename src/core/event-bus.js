/**
 * EventBus - 模块间通信中心
 * 解耦各模块间的直接依赖
 */

class EventBus {
  constructor() {
    this.listeners = new Map();
    this.onceListeners = new Map();
  }

  /**
   * 订阅事件
   * @param {string} event - 事件名称
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    
    return () => this.off(event, callback);
  }

  /**
   * 一次性订阅
   * @param {string} event - 事件名称
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  once(event, callback) {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, []);
    }
    this.onceListeners.get(event).push(callback);
    
    return () => {
      const listeners = this.onceListeners.get(event);
      if (listeners) {
        const index = listeners.indexOf(callback);
        if (index > -1) listeners.splice(index, 1);
      }
    };
  }

  /**
   * 取消订阅
   * @param {string} event - 事件名称
   * @param {Function} callback - 回调函数
   */
  off(event, callback) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) listeners.splice(index, 1);
    }
  }

  /**
   * 触发事件
   * @param {string} event - 事件名称
   * @param {*} data - 事件数据
   */
  emit(event, data) {
    // 触发普通监听器
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (err) {
          console.error(`[EventBus] Error in listener for ${event}:`, err);
        }
      });
    }

    // 触发一次性监听器
    const onceListeners = this.onceListeners.get(event);
    if (onceListeners) {
      onceListeners.forEach(callback => {
        try {
          callback(data);
        } catch (err) {
          console.error(`[EventBus] Error in once listener for ${event}:`, err);
        }
      });
      this.onceListeners.delete(event);
    }
  }

  /**
   * 移除所有监听器
   */
  clear() {
    this.listeners.clear();
    this.onceListeners.clear();
  }
}

// 创建全局事件总线实例
const globalEventBus = new EventBus();

module.exports = { EventBus, globalEventBus };
