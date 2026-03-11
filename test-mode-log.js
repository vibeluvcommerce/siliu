// test-mode-log.js - 测试模式日志输出
const SiliuController = require('./src/siliu-controller');

// 模拟 core
const mockCore = {
  getActiveView: () => null
};

async function test() {
  console.log('=== 测试 1: JS 模式 (默认) ===');
  const controller1 = new SiliuController({
    core: mockCore,
    mode: 'js'
  });
  
  try {
    // 这个应该输出 [JS mode]
    await controller1._tryCDP(
      () => Promise.resolve('cdp result'),
      () => Promise.resolve('js result'),
      'test-js'
    );
  } catch (e) {
    console.log('错误:', e.message);
  }

  console.log('\n=== 测试 2: CDP 模式 (未连接) ===');
  const controller2 = new SiliuController({
    core: mockCore,
    mode: 'cdp',
    debugPort: 9223
  });
  // 不连接 CDP，直接测试回退
  
  try {
    // 这个应该因为 cdpController 未连接而回退到 JS
    await controller2._tryCDP(
      () => Promise.reject(new Error('Not connected')),
      () => Promise.resolve('js fallback'),
      'test-cdp-fallback'
    );
  } catch (e) {
    console.log('错误:', e.message);
  }

  console.log('\n=== 测试 3: CDP 模式成功 ===');
  const controller3 = new SiliuController({
    core: mockCore,
    mode: 'cdp',
    debugPort: 9223
  });
  // 模拟 CDP 成功
  controller3.cdpController = { connected: true };
  
  try {
    await controller3._tryCDP(
      () => Promise.resolve('cdp success'),
      () => Promise.resolve('js result'),
      'test-cdp-success'
    );
  } catch (e) {
    console.log('错误:', e.message);
  }

  console.log('\n=== 完成 ===');
}

test();
