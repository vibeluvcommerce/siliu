/**
 * Agents 模块入口
 * 
 * 目录结构：
 * agents/
 * ├── base-agent.js           # Agent 基类
 * ├── agent-registry.js       # Agent 注册表
 * ├── index.js               # 模块入口（本文件）
 * ├── builtin/               # 内置 Agent（官方维护）
 * │   ├── general-agent.js
 * │   └── bilibili-agent.js
 * └── custom/                # 自定义 Agent（开发阶段共享）
 *     ├── README.md
 *     └── *.js               # 用户自定义 Agent（自动加载）
 */

// 基类
const { BaseAgent } = require('./base-agent');

// 内置 Agents
const { GeneralAgent } = require('./builtin/general-agent');
const { BilibiliAgent } = require('./builtin/bilibili-agent');

// 注册表
const { AgentRegistry, registry } = require('./agent-registry');

module.exports = {
  // 基类（用于扩展）
  BaseAgent,
  
  // 内置 Agents
  GeneralAgent,
  BilibiliAgent,
  
  // 注册表（主要接口）
  AgentRegistry,
  registry
};
