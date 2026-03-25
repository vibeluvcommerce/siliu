// test-prompt.js - 测试提示词构建
const { PromptBuilder } = require('./src/copilot/prompt-builder');

const builder = new PromptBuilder({ maxSteps: 30 });

console.log('=== 测试 buildChatPrompt ===');
const chatPrompt = builder.buildChatPrompt('帮我打开 GitHub');
console.log(chatPrompt.substring(0, 200));
console.log('...');
console.log('✓ Chat prompt OK\n');

console.log('=== 测试 buildActionPrompt ===');
const actionPrompt = builder.buildActionPrompt(
  '打开 GitHub 搜索 openclaw',
  { url: 'https://github.com', title: 'GitHub', content: 'GitHub content', elements: [] },
  null,
  0
);
console.log(actionPrompt.substring(0, 300));
console.log('...');
console.log('✓ Action prompt OK\n');

console.log('All tests passed!');
