const WebSocket = require('ws');
const http = require('http');

async function sendCDP(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Date.now() + Math.random();
    const handler = (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.id === id) {
          ws.off('message', handler);
          if (msg.error) reject(new Error(JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      } catch (e) {}
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { ws.off('message', handler); reject(new Error('Timeout')); }, 10000);
  });
}

async function main() {
  try {
    const pages = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:9223/json/list', res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
    
    console.log('Pages:', pages.length);
    const target = pages.find(p => p.url.includes('newtab')) || pages[0];
    
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    console.log('WebSocket ready');
    
    // 使用 Runtime.evaluate 导航
    console.log('Navigating via JavaScript...');
    const result = await sendCDP(ws, 'Runtime.evaluate', {
      expression: `window.location.href = 'https://github.com/search?q=openclaw&type=repositories'`,
      awaitPromise: true
    });
    
    console.log('Navigation result:', result);
    
    // 等待加载
    await new Promise(r => setTimeout(r, 8000));
    
    // 获取页面信息
    const info = await sendCDP(ws, 'Runtime.evaluate', {
      expression: `({
        title: document.title,
        url: window.location.href,
        results: Array.from(document.querySelectorAll('a[href*="/openclaw"] h3, .repo-list h3, article h3')).slice(0,5).map(h=>h.innerText)
      })`,
      returnByValue: true
    });
    
    console.log('Page info:', JSON.stringify(info.result.value, null, 2));
    
    ws.close();
    
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();