#!/usr/bin/env node
// test-cdp.js - CDP 功能测试脚本

const SiliuController = require('./src/siliu-controller');

const url = process.argv.includes('--url') 
  ? process.argv[process.argv.indexOf('--url') + 1] 
  : 'https://example.com';

const port = process.argv.includes('--port')
  ? parseInt(process.argv[process.argv.indexOf('--port') + 1])
  : 9223;

// 模拟 core 对象
const mockCore = {
  getActiveView: () => null  // 测试时不依赖 UI
};

async function runTests() {
  console.log('=================================');
  console.log('Siliu CDP 智能混合模式测试');
  console.log('=================================\n');

  const controller = new SiliuController({
    core: mockCore,
    humanize: { enabled: false },
    mode: 'cdp',
    debugPort: port
  });

  try {
    // 测试 1: 连接
    console.log('Test 1: 连接到浏览器...');
    console.log('  提示: 如果失败，请确保 Siliu 已启动且启用了调试端口 9223');
    await controller.cdpController.connect();
    console.log('✓ 连接成功\n');

    // 测试 2: 导航 (应该显示 [CDP mode])
    console.log('Test 2: 导航到 example.com...');
    await controller.navigate(url);
    console.log('✓ 导航成功\n');

    // 测试 3: 获取标题
    console.log('Test 3: 获取页面标题...');
    const title = await controller.getTitle();
    console.log('  标题:', title);
    console.log('✓ 获取标题成功\n');

    // 测试 4: 获取内容
    console.log('Test 4: 获取页面内容...');
    const content = await controller.getContent();
    console.log('  内容长度:', content.length);
    console.log('✓ 获取内容成功\n');

    // 测试 5: 执行 JavaScript
    console.log('Test 5: 执行 JavaScript...');
    const result = await controller.cdp.evaluate('document.querySelector("h1").innerText', { returnByValue: true });
    console.log('  h1 文本:', result.value);
    console.log('✓ 执行 JS 成功\n');

    // 测试 6: 截图
    console.log('Test 6: 截图...');
    const screenshot = await controller.screenshot();
    console.log('  截图大小:', screenshot.length, 'bytes');
    console.log('✓ 截图成功\n');

    console.log('=================================');
    console.log('所有测试通过!');
    console.log('=================================');

  } catch (err) {
    console.error('✗ 测试失败:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    controller.disconnect();
  }
}

// 检查参数
if (process.argv.includes('--help')) {
  console.log('用法: node test-cdp.js [选项]');
  console.log('');
  console.log('选项:');
  console.log('  --url <url>     测试指定 URL (默认: https://example.com)');
  console.log('  --port <port>   CDP 调试端口 (默认: 9223)');
  console.log('  --help          显示帮助');
  console.log('');
  console.log('前提条件:');
  console.log('  1. Siliu 浏览器正在运行');
  console.log('  2. 启用了远程调试 (port 9223)');
  process.exit(0);
}

console.log('测试 URL:', url);
console.log('调试端口:', port);
console.log('');

runTests();
