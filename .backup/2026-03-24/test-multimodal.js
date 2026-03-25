// test-multimodal.js - 测试 OpenClaw 多模态消息格式
// 运行: node test-multimodal.js

const WebSocket = require('ws');

const url = 'ws://127.0.0.1:18789';
const token = 'f62c3515a77587959fba1cd3411efbd0152e55e4ce888af0';  // 从你的配置中获取
const sessionKey = 'agent:window:main';

// 创建一个简单的测试图片 (1x1 像素的红色 PNG，Base64)
const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

// 测试格式 1: OpenAI 风格的多模态 content 数组
const format1 = {
  type: 'req',
  id: 'test-1',
  method: 'chat.send',
  params: {
    sessionKey,
    message: {
      role: 'user',
      content: [
        { type: 'text', text: '这是什么图片？' },
        { 
          type: 'image_url', 
          image_url: { 
            url: `data:image/png;base64,${testImageBase64}`,
            detail: 'auto'
          } 
        }
      ]
    },
    deliver: true
  }
};

// 测试格式 2: 简化的 content 数组（不带 role）
const format2 = {
  type: 'req',
  id: 'test-2',
  method: 'chat.send',
  params: {
    sessionKey,
    message: {
      content: [
        { type: 'text', text: '描述这张截图' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${testImageBase64}` } }
      ]
    },
    deliver: true
  }
};

// 测试格式 3: attachments 方式（OpenClaw 传统方式）
const format3 = {
  type: 'req',
  id: 'test-3',
  method: 'chat.send',
  params: {
    sessionKey,
    message: '看看这张截图',
    attachments: [
      {
        type: 'image',
        mimeType: 'image/png',
        data: testImageBase64
      }
    ],
    deliver: true
  }
};

// 测试格式 4: 纯文本（作为对照）
const format4 = {
  type: 'req',
  id: 'test-4',
  method: 'chat.send',
  params: {
    sessionKey,
    message: '这是一条纯文本测试消息',
    deliver: true
  }
};

async function testFormat(ws, format, name) {
  console.log(`\n========== 测试 ${name} ==========`);
  console.log('发送:', JSON.stringify(format, null, 2));
  
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log(`${name}: 超时，未收到响应`);
      resolve(false);
    }, 10000);
    
    const handler = (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'res' && msg.id === format.id) {
          clearTimeout(timeout);
          ws.off('message', handler);
          
          if (msg.ok) {
            console.log(`${name}: ✅ 成功`);
            console.log('响应:', JSON.stringify(msg.payload, null, 2));
          } else {
            console.log(`${name}: ❌ 失败`);
            console.log('错误:', msg.error);
          }
          resolve(msg.ok);
        }
      } catch (e) {}
    };
    
    ws.on('message', handler);
    ws.send(JSON.stringify(format));
  });
}

async function main() {
  console.log('连接到 OpenClaw:', url);
  
  const ws = new WebSocket(url, {
    headers: { 'Origin': 'http://localhost' }
  });
  
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  
  console.log('WebSocket 已连接，等待 challenge...');
  
  // 等待 challenge
  await new Promise((resolve) => {
    ws.once('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        console.log('收到 challenge，发送认证...');
        
        // 发送认证
        ws.send(JSON.stringify({
          type: 'req',
          id: 'connect-1',
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: 'test-multimodal',
              version: '1.0.0',
              platform: process.platform,
              mode: 'webchat'
            },
            role: 'operator',
            scopes: ['operator.admin'],
            auth: { token }
          }
        }));
      }
      resolve();
    });
  });
  
  // 等待认证响应
  await new Promise((resolve) => {
    ws.once('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'res' && msg.id === 'connect-1') {
        if (msg.ok) {
          console.log('✅ 认证成功\n');
        } else {
          console.log('❌ 认证失败:', msg.error);
          process.exit(1);
        }
        resolve();
      }
    });
  });
  
  // 按顺序测试各种格式
  await testFormat(ws, format4, '纯文本对照');
  await testFormat(ws, format1, 'OpenAI风格多模态');
  await testFormat(ws, format2, '简化多模态');
  await testFormat(ws, format3, 'Attachments方式');
  
  console.log('\n========== 测试完成 ==========');
  ws.close();
  process.exit(0);
}

main().catch(console.error);
