/**
 * events.js - 全局事件定义
 * 集中管理所有事件名称，避免硬编码
 */

// AI 服务事件
exports.AI_EVENTS = {
  CONNECTED: 'ai:connected',
  DISCONNECTED: 'ai:disconnected',
  ERROR: 'ai:error',
  MESSAGE: 'ai:message',
  STATUS: 'ai:status'
};

// Copilot 事件
exports.COPILOT_EVENTS = {
  ACTIVATED: 'copilot:activated',
  DEACTIVATED: 'copilot:deactivated',
  MESSAGE: 'copilot:message',
  STREAM: 'copilot:stream',
  TASK_START: 'copilot:task-start',
  TASK_FINISH: 'copilot:task-finish',
  TASK_CANCELLED: 'copilot:task-cancelled',  // 任务被取消
  STEP_START: 'copilot:step-start',
  STEP_RESULT: 'copilot:step-result',
  NEED_LOGIN: 'copilot:need-login',
  LOGIN_REQUIRED: 'copilot:login-required',
  ASK_CONTINUE: 'copilot:ask-continue',
  SCREENSHOT: 'copilot:screenshot',
  SEND_MESSAGE: 'copilot:send-message',
  CONTINUE_TASK: 'copilot:continue-task',
  THINKING: 'copilot:thinking',  // 与AI沟通中
  EXECUTION_CONFIRMED: 'copilot:execution-confirmed',  // 执行已确认
  NEED_USER_CONFIRMATION: 'copilot:need-user-confirmation',  // 需要用户确认
  AGENT_CHANGED: 'copilot:agent-changed'  // Agent 切换事件
};

// 浏览器控制器事件
exports.CONTROLLER_EVENTS = {
  READY: 'controller:ready',
  NAVIGATE: 'controller:navigate',
  CLICK: 'controller:click',
  TYPE: 'controller:type',
  SCROLL: 'controller:scroll',
  SCREENSHOT: 'controller:screenshot',
  GET_CONTENT: 'controller:get-content',
  GET_INFO: 'controller:get-info'
};

// 应用生命周期事件
exports.APP_EVENTS = {
  READY: 'app:ready',
  QUIT: 'app:quit',
  WINDOW_CREATED: 'app:window-created'
};

// OpenClaw 兼容事件（旧版）
exports.OPENCLAW_EVENTS = {
  CONNECTED: 'openclaw:connected',
  DISCONNECTED: 'openclaw:disconnected',
  MESSAGE: 'openclaw:message',
  ERROR: 'openclaw:error'
};
