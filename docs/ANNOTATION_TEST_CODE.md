# 标注蒙版测试代码备份

## 测试文件
- **原始文件**: `cdp-eval.js`
- **备份位置**: `.backup/2026-03-16/cdp-eval.js`
- **功能**: 通过 Chrome DevTools Protocol 测试 JS 注入

## BrowserView JS 注入实现（已回滚）

### IPC Handler (src/app.js)
```javascript
// 注入标注蒙版（支持自定义脚本）
safeHandle('annotation:injectOverlay', async (event, viewId, customScript) => {
  try {
    console.log('[Annotation] Inject overlay for view:', viewId);
    
    const view = modules.core?.tabManager?.getView?.(viewId);
    if (!view) {
      return { success: false, error: 'View not found' };
    }
    
    // 使用自定义脚本或默认脚本
    const script = customScript || `
      (function() {
        if (document.getElementById('__siliu_anno__')) return 'already-exists';
        
        const overlay = document.createElement('div');
        overlay.id = '__siliu_anno__';
        overlay.style.cssText = 
          'position:fixed;top:0;left:0;width:100%;height:100%;' +
          'z-index:2147483647;cursor:crosshair;background:rgba(233,69,96,0.05);';
        
        overlay.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const x = e.clientX / window.innerWidth;
          const y = e.clientY / window.innerHeight;
          window.postMessage({type:'SILIU_ANNOTATION_CLICK',x,y}, '*');
        });
        
        document.body.appendChild(overlay);
        'injected';
      })()
    `;
    
    const result = await view.webContents.executeJavaScript(script);
    console.log('[Annotation] Inject result:', result);
    
    return { success: true, result };
  } catch (err) {
    console.error('[Annotation] Inject failed:', err);
    return { success: false, error: err.message };
  }
});

// 移除标注蒙版
safeHandle('annotation:removeOverlay', async (event, viewId) => {
  try {
    const view = modules.core?.tabManager?.getView?.(viewId);
    if (!view) {
      return { success: false, error: 'View not found' };
    }
    
    const script = `
      (function() {
        const overlay = document.getElementById('__siliu_anno__');
        if (overlay) overlay.remove();
        const crosshair = document.getElementById('__siliu_crosshair__');
        if (crosshair) crosshair.remove();
        'removed';
      })()
    `;
    
    await view.webContents.executeJavaScript(script);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
```

### Preload API (src/preload/index.js)
```javascript
// 标注模式
injectAnnotationOverlay: (viewId, customScript) => 
  ipcRenderer.invoke('annotation:injectOverlay', viewId, customScript),
removeAnnotationOverlay: (viewId) => 
  ipcRenderer.invoke('annotation:removeOverlay', viewId),
```

### Frontend 注入逻辑 (public/shell.html)
```javascript
async function injectAnnotationOverlay(viewId) {
  const overlayScript = `
    (function() {
      if (document.getElementById('__siliu_anno__')) return;
      
      const overlay = document.createElement('div');
      overlay.id = '__siliu_anno__';
      overlay.style.cssText = 
        'position:fixed;top:0;left:0;width:100%;height:100%;' +
        'z-index:2147483647;cursor:crosshair;background:rgba(233,69,96,0.05);' +
        'pointer-events:auto;';
      
      // 添加十字准星
      const crosshair = document.createElement('div');
      crosshair.id = '__siliu_crosshair__';
      crosshair.style.cssText = 
        'position:fixed;width:20px;height:20px;border:2px solid #E94560;' +
        'border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);' +
        'display:none;z-index:2147483648;box-shadow:0 0 10px rgba(233,69,96,0.5);';
      document.body.appendChild(crosshair);
      
      overlay.addEventListener('mousemove', (e) => {
        crosshair.style.left = e.clientX + 'px';
        crosshair.style.top = e.clientY + 'px';
        crosshair.style.display = 'block';
      });
      
      overlay.addEventListener('mouseleave', () => {
        crosshair.style.display = 'none';
      });
      
      overlay.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const x = e.clientX / window.innerWidth;
        const y = e.clientY / window.innerHeight;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        
        window.postMessage({
          type: 'SILIU_ANNOTATION_CLICK',
          x: x,
          y: y,
          tag: el?.tagName || 'unknown',
          url: location.href
        }, '*');
      });
      
      document.body.appendChild(overlay);
    })()
  `;
  
  try {
    const result = await window.siliuAPI?.injectAnnotationOverlay?.(viewId, overlayScript);
    if (result?.success) {
      console.log('[Annotation] Overlay injected');
    } else {
      showToast('注入标注蒙版失败: ' + (result?.error || '未知错误'));
    }
  } catch (err) {
    console.error('[Annotation] Inject failed:', err);
    showToast('标注蒙版注入失败');
  }
}
```

## 消息监听
```javascript
window.addEventListener('message', async (e) => {
  if (e.data?.type === 'SILIU_ANNOTATION_CLICK') {
    handleAnnotationClick(e.data);
  }
});

function handleAnnotationClick(data) {
  // 显示坐标输入弹窗
  document.getElementById('coord-display').textContent = 
    `x: ${data.x.toFixed(4)}, y: ${data.y.toFixed(4)}`;
  document.getElementById('coord-modal').classList.add('show');
}
```

## CSP 限制说明
- **支持**: 大多数网站（淘宝、B站、京东等）
- **不支持**: CSP 严格网站（GitHub、银行等）
- **解决方案**: 需要优雅降级到手动输入坐标

## 完整实现备份
完整的前端实现代码在：`.backup/2026-03-16/shell.html.with-editor`
