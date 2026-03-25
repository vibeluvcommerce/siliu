/**
 * 测试对话框拦截器
 */
const DialogInterceptor = require('./src/core/dialog-interceptor');

console.log('=== Dialog Interceptor Test ===');
console.log('Is available:', DialogInterceptor.isAvailable());
console.log('Is running:', DialogInterceptor.isRunning);

if (DialogInterceptor.isAvailable()) {
  console.log('\nInterceptor is available, testing...');
  
  // 设置测试文件
  DialogInterceptor.setNextFile('D:\\work\\siliu\\assets\\app.png');
  
  // 启动拦截器
  DialogInterceptor.start();
  
  console.log('Interceptor started. Waiting for dialogs...');
  console.log('Please open a file dialog manually to test.');
  
  // 监听事件
  DialogInterceptor.on('file:selected', (data) => {
    console.log('File selected:', data);
    process.exit(0);
  });
  
  DialogInterceptor.on('dialog:manual-required', (data) => {
    console.log('Manual intervention needed:', data);
  });
  
  // 30秒后退出
  setTimeout(() => {
    console.log('Test timeout. No dialog detected.');
    DialogInterceptor.stop();
    process.exit(1);
  }, 30000);
  
} else {
  console.error('Interceptor not available. Make sure koffi is installed.');
  process.exit(1);
}
