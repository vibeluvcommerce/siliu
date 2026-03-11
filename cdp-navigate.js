const WebSocket = require('ws');

async function sendCDPCommand(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Date.now() + Math.random();
    
    const handler = (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.id === id) {
          ws.off('message', handler);
          if (msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg.result);
          }
        }
      } catch (e) {}
    };
    
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
    
    setTimeout(() => {
      ws.off('message', handler);
      reject(new Error('Timeout'));
    }, 10000);
  });
}

async function navigate() {
  try {
    // 获取页面列表
    const http = require('http');
    const pages = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:9223/json/list', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
    
    console.log('Found pages:', pages.length);
    const target = pages.find(p => p.url.includes('newtab')) || pages[0];
    console.log('Using page:', target.title, target.url);
    
    // 连接到页面 WebSocket
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    
    console.log('WebSocket connected!');
    
    // 启用页面域
    await sendCDPCommand(ws, 'Page.enable');
    console.log('Page domain enabled');
    
    // 导航到 GitHub
    console.log('Navigating to GitHub...');
    const result = await sendCDPCommand(ws, 'Page.navigate', {
      url: 'https://github.com/search?q=openclaw&type=repositories'
    });
    
    console.log('Navigation started:', result);
    
    // 等待加载完成
    await new Promise(resolve => {
      const handler = (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.method === 'Page.loadEventFired') {
            ws.off('message', handler);
            resolve();
          }
        } catch (e) {}
      };
      ws.on('message', handler);
      setTimeout(() => {
        ws.off('message', handler);
        resolve();
      }, 15000);
    });
    
    console.log('Page loaded!');
    
    // 获取文档内容
    const doc = await sendCDPCommand(ws, 'DOM.getDocument');
    console.log('Document root:', doc.root.nodeName);
    
    // 执行 JavaScript 获取内容
    const evalResult = await sendCDPCommand(ws, 'Runtime.evaluate', {
      expression: 'document.title'
    });
    console.log('Title:', evalResult.result.value);
    
    // 获取搜索结果
    const searchResults = await sendCDPCommand(ws, 'Runtime.evaluate', {
      expression: `
        Array.from(document.querySelectorAll('h3 a')).map(a => ({
          text: a.innerText,
          href: a.href
        })).slice(0, 10)
      `,
      returnByValue: true
    });
    
    console.log('Search results:', JSON.stringify(searchResults.result.value, null, 2));
    
    ws.close();
    console.log('Done!');
    
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

navigate();