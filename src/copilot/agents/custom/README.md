# 自定义 Agent 目录

将你的自定义 Agent 文件放在此目录下，系统会自动加载。

## 快速开始

1. 创建一个新的 JavaScript 文件，例如 `my-agent.js`
2. 继承 `BaseAgent` 基类
3. 实现必要的方法
4. 重启应用即可自动加载

## 示例

```javascript
// my-agent.js
const { BaseAgent } = require('../base-agent');

class MyAgent extends BaseAgent {
  constructor() {
    super({
      id: 'my-agent',
      name: '我的助手',
      icon: '🚀',
      description: '这是一个示例 Agent'
    });
  }

  getDomainKnowledge() {
    return `【我的网站规则】
- 规则1：描述
- 规则2：描述`;
  }
}

module.exports = { MyAgent };
```

## 注意事项

1. **文件命名**：使用小写，单词间用 `-` 连接，例如 `taobao-agent.js`
2. **类名命名**：使用 PascalCase，以 `Agent` 结尾，例如 `TaobaoAgent`
3. **ID 唯一性**：确保 `id` 不与其他 Agent 冲突
4. **导出方式**：必须使用 `module.exports = { YourAgentClass }`
5. **开发共享**：当前处于开发阶段，custom 目录的 Agent 会随项目一起提交

## 热重载

修改自定义 Agent 文件后，调用以下方法重新加载：

```javascript
const { registry } = require('../agent-registry');
registry.reloadCustomAgents();
```

## 发布说明

项目正式发布后，custom 目录将被添加到 .gitignore，用户自定义 Agent 不再随仓库发布。
