// test-toast.js - 测试 Toast 发送

const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: require('path').join(__dirname, 'src/preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('public/shell.html');

  // 5秒后发送测试 Toast
  setTimeout(() => {
    console.log('Sending test toast...');
    win.webContents.send('toast:show', {
      message: '🔵 测试 [CDP]',
      type: 'info',
      duration: 3000
    });
  }, 5000);

  // 10秒后再发一个
  setTimeout(() => {
    console.log('Sending second toast...');
    win.webContents.send('toast:show', {
      message: '🟢 测试 [JS]',
      type: 'info', 
      duration: 3000
    });
  }, 10000);
});
