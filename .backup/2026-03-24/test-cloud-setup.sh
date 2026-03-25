#!/bin/bash
# test-cloud-setup.sh - 测试云端 OpenClaw + 图床配置

cd /home/ubuntu/.openclaw/workspace/siliu

echo "========================================"
echo "云端 OpenClaw 配置测试"
echo "========================================"

# 1. 语法检查
echo -e "\n[1/5] 代码语法检查..."
node -c src/services/image-uploader.js && echo "✅ image-uploader.js"
node -c src/copilot/visual-context.js && echo "✅ visual-context.js"
node -c src/copilot/window-copilot.js && echo "✅ window-copilot.js"

# 2. 图床连通性测试
echo -e "\n[2/5] 图床连通性测试..."
echo "正在测试 Catbox (无需注册)..."
node test-image-uploader.js

# 3. 检查 OpenClaw 连接
echo -e "\n[3/5] OpenClaw 连接检查..."
if command -v openclaw > /dev/null 2>&1; then
  openclaw status
else
  echo "⚠️ openclaw 命令不可用，跳过检查"
fi

# 4. 配置提示
echo -e "\n[4/5] 配置说明"
echo ""
echo "本地 OpenClaw（推荐）:"
echo "  config.json:"
echo '  {"
    "ai": {
      "mode": "openclaw",
      "openclaw": {
        "url": "ws://localhost:18789",
        "isCloud": false
      }
    }
  }'

echo ""
echo "云端 OpenClaw（使用图床）:"
echo "  config.json:"
echo '  {"
    "ai": {
      "mode": "openclaw", 
      "openclaw": {
        "url": "ws://your-cloud-server:18789",
        "isCloud": true
      }
    },
    "visual": {
      "uploadProvider": "catbox"
    }
  }'

echo ""
echo "Kimi 直连（绕过 OpenClaw）:"
echo '  {"
    "ai": {
      "mode": "kimi",
      "kimi": {
        "apiKey": "sk-your-key"
      }
    }
  }'

# 5. 运行指南
echo -e "\n[5/5] 下一步操作"
echo ""
echo "1. 编辑配置文件:"
echo "   cp config.example.json ~/.siliu/config.json"
echo "   nano ~/.siliu/config.json"
echo ""
echo "2. 启动浏览器测试:"
echo "   npm start"
echo ""
echo "3. 在 Copilot 中输入:"
echo '   @action: 打开 example.com 并截图分析'
echo ""
echo "4. 观察终端日志，确认:"
echo "   - Screenshot captured"
echo "   - Upload successful: https://..."
echo "   - AI response received"

echo -e "\n========================================"
echo "测试完成！"
echo "========================================"
