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
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      } catch (e) {}
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { ws.off('message', handler); reject(new Error('Timeout')); }, 15000);
  });
}

async function main() {
  try {
    // 获取页面
    const pages = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:9223/json/list', res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
    
    console.log('Found', pages.length, 'pages');
    const target = pages.find(p => p.url.includes('newtab')) || pages[0];
    console.log('Connecting to:', target.title);
    
    // 连接 WebSocket
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    console.log('Connected!');
    
    // 直接导航，不启用域
    console.log('Navigating...');
    await sendCDP(ws, 'Page.navigate', {
      url: 'https://github.com/search?q=openclaw&type=repositories'
    });
    
    // 等待几秒让页面加载
    await new Promise(r => setTimeout(r, 5000));
    
    // 获取标题
    const title = await sendCDP(ws, 'Runtime.evaluate', {
      expression: 'document.title',
      returnByValue: true
    });
    console.log('Title:', title.result.value);
    
    // 获取搜索结果
    const results = await sendCDP(ws, 'Runtime.evaluate', {
      expression: `Array.from(document.querySelectorAll('[data-testid=\"result-item\"] h3 a, .repo-list h3 a, article h3 a')).slice(0,5).map(a=>({text:a.innerText,href:a.href}))`,
      returnByValue: true
    });
    
    console.log('Results:');
    (results.result.value || []).forEach((r, i) => {
      console.log(`${i+1}. ${r.text}`);
    });
    
    ws.close();
    console.log('Done!');
    
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();