// test-image-uploader.js - 测试图床上传功能

const { ImageUploader } = require('./src/services/image-uploader');

// 创建一个简单的 100x100 红色测试图片
function createTestImage() {
  // PNG 格式的红色图片 (100x100)
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH5QYQCgkwzN1yGAAAAB1pVFh0Q29tbWVudAAAAAAAQ3JlYXRlZCB3aXRoIEdJTVBkLmUHAAAAMElEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4GA8AAAE=';
  return Buffer.from(base64, 'base64');
}

async function testProvider(uploader, provider) {
  console.log(`\n========== 测试 ${provider} ==========`);
  
  const testBuffer = createTestImage();
  
  try {
    const result = await uploader.upload(testBuffer, 'test-red-square.png');
    console.log(`✅ ${provider} 上传成功`);
    console.log(`   URL: ${result.url}`);
    console.log(`   有效期: ${result.expires || '永久'}`);
    
    if (result.deleteUrl) {
      console.log(`   删除链接: ${result.deleteUrl}`);
    }
    
    return { success: true, provider, url: result.url };
  } catch (err) {
    console.log(`❌ ${provider} 上传失败: ${err.message}`);
    return { success: false, provider, error: err.message };
  }
}

async function main() {
  console.log('========================================');
  console.log('图床上传测试');
  console.log('========================================');
  
  const results = [];
  
  // 测试 Catbox (无需注册，推荐)
  const catboxUploader = new ImageUploader({ provider: 'catbox' });
  results.push(await testProvider(catboxUploader, 'Catbox'));
  
  // 测试 0x0.st (无需注册)
  const oxoUploader = new ImageUploader({ provider: 'oxo' });
  results.push(await testProvider(oxoUploader, '0x0.st'));
  
  // 测试 SM.MS (需要 token)
  const smmsToken = process.env.SMMS_TOKEN;
  if (smmsToken) {
    const smmsUploader = new ImageUploader({ 
      provider: 'smms',
      smmsToken 
    });
    results.push(await testProvider(smmsUploader, 'SM.MS'));
  } else {
    console.log('\n⚠️ 跳过 SM.MS 测试 (需要设置 SMMS_TOKEN 环境变量)');
  }
  
  // 测试 Imgur (需要 client ID)
  const imgurClientId = process.env.IMGUR_CLIENT_ID;
  if (imgurClientId) {
    const imgurUploader = new ImageUploader({ 
      provider: 'imgur',
      imgurClientId 
    });
    results.push(await testProvider(imgurUploader, 'Imgur'));
  } else {
    console.log('\n⚠️ 跳过 Imgur 测试 (需要设置 IMGUR_CLIENT_ID 环境变量)');
  }
  
  // 汇总
  console.log('\n========================================');
  console.log('测试结果汇总');
  console.log('========================================');
  
  for (const r of results) {
    const status = r.success ? '✅' : '❌';
    console.log(`${status} ${r.provider}: ${r.success ? r.url : r.error}`);
  }
  
  const successCount = results.filter(r => r.success).length;
  console.log(`\n总计: ${successCount}/${results.length} 个图床可用`);
  
  // 推荐
  if (results.find(r => r.provider === 'Catbox' && r.success)) {
    console.log('\n💡 推荐使用 Catbox：无需注册，无限上传，永久保存');
  }
}

main().catch(console.error);
