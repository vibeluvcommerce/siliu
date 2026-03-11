/**
 * Copilot - AI 助手模块统一入口
 * 
 * 当前使用窗口隔离架构：
 * - WindowCopilot: 每个窗口独立的 Copilot 实例
 * - CopilotManager: 管理所有窗口的 Copilot
 * 
 * 旧版单例 Copilot 已移除
 */

// 窗口隔离架构（当前使用）
const { WindowCopilot } = require('./window-copilot');
const { CopilotManager } = require('./copilot-manager');

// 子模块
const { PromptBuilder } = require('./prompt-builder');
const { LoginDetector } = require('./login-detector');

module.exports = {
  WindowCopilot,
  CopilotManager,
  PromptBuilder,
  LoginDetector
};
