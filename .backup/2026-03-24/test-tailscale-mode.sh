#!/bin/bash
# test-tailscale-mode.sh - 测试 Tailscale 内网穿透模式

cd /home/ubuntu/.openclaw/workspace/siliu

echo "========================================"
echo "Tailscale 内网穿透模式测试"
echo "========================================"

# 1. 检查 Tailscale
echo -e "\n[1/4] 检查 Tailscale 安装..."
if command -v tailscale > /dev/null 2>&1; then
  echo "✅ Tailscale 已安装"
  echo ""
  echo "当前状态:"
  tailscale status 2>/dev/null || echo "  Tailscale 未运行，请先执行: sudo tailscale up"
  echo ""
  echo "本机 IP:"
  tailscale ip -4 2>/dev/null || echo "  未获取"
else
  echo "❌ Tailscale 未安装"
  echo ""
  echo "安装命令:"
  echo "  curl -fsSL https://tailscale.com/install.sh | sh"
  echo "  sudo tailscale up"
fi

# 2. 代码检查
echo -e "\n[2/4] 代码检查..."
node -c src/services/screenshot-server.js && echo "✅ screenshot-server.js"
node -c src/copilot/visual-context.js && echo "✅ visual-context.js"
node -c src/copilot/window-copilot.js && echo "✅ window-copilot.js"

# 3. 配置示例
echo -e "\n[3/4] 配置示例"
cat << 'EOF'

Tailscale 模式配置 (config.json):
{
  "ai": {
    "mode": "openclaw",
    "openclaw": {
      "url": "ws://CLOUD_TAILSCALE_IP:18789",
      "token": "your-token"
    }
  },
  "visual": {
    "transferMode": "server",
    "tailscaleIp": "YOUR_TAILSCALE_IP"
  }
}

传输模式说明:
- "file":   本地文件 (OpenClaw 和 Siliu 同机器)
- "server": 本地 HTTP 服务 (Tailscale/内网穿透) ⭐ 推荐
- "upload": 公共图床 (不推荐，有隐私风险)

EOF

# 4. 操作指南
echo -e "\n[4/4] 下一步操作"
echo ""
echo "1. 确保云端 OpenClaw 服务器也安装了 Tailscale"
echo "   ssh your-cloud-server"
echo "   curl -fsSL https://tailscale.com/install.sh | sh"
echo "   sudo tailscale up"
echo ""
echo "2. 记录两边机器的 Tailscale IP"
echo "   tailscale ip -4"
echo ""
echo "3. 更新配置文件"
echo "   nano ~/.siliu/config.json"
echo ""
echo "4. 启动浏览器测试"
echo "   npm start"
echo ""
echo "5. 观察日志应显示:"
echo "   [ScreenshotServer] Started on port XXXX"
echo "   [WindowCopilot:main] Using Tailscale URL: http://100.64.x.x:XXXX/..."

echo -e "\n========================================"
echo "详细文档: docs/TAILSCALE_SETUP.md"
echo "========================================"
