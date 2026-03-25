#!/bin/bash
# setup-tailscale.sh - Tailscale 内网穿透完整配置脚本

echo "========================================"
echo "Tailscale 内网穿透配置向导"
echo "========================================"
echo ""
echo "此方案适用于:"
echo "  - OpenClaw 运行在云端服务器"
echo "  - Siliu 运行在本地机器"
echo "  - 需要安全地传输截图而不使用公共图床"
echo ""

# 检查是否已安装 Tailscale
if ! command -v tailscale &> /dev/null; then
  echo "[1/5] 安装 Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
else
  echo "[1/5] Tailscale 已安装"
fi

# 启动 Tailscale
echo ""
echo "[2/5] 启动 Tailscale..."
echo "提示: 请在浏览器中完成登录授权"
sudo tailscale up

# 获取本机 Tailscale IP
echo ""
echo "[3/5] 获取网络信息..."
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "未获取")
echo "本机 Tailscale IP: $TAILSCALE_IP"
echo ""
echo "其他设备访问此机器的地址:"
echo "  - SSH:     ssh user@$TAILSCALE_IP"
echo "  - HTTP:    http://$TAILSCALE_IP:PORT"
echo ""

# 显示网络中的其他节点
echo "Tailscale 网络中的设备:"
tailscale status | grep -v "^#"

# 配置提示
echo ""
echo "[4/5] 配置说明"
echo ""
echo "1. 在云端 OpenClaw 服务器上也安装 Tailscale:"
echo "   curl -fsSL https://tailscale.com/install.sh | sh"
echo "   sudo tailscale up"
echo ""
echo "2. 确保两台机器使用同一个 Tailscale 账号登录"
echo ""
echo "3. 获取云端服务器的 Tailscale IP:"
echo "   ssh your-cloud-server"
echo "   tailscale ip -4"
echo "   # 记录这个 IP，比如: 100.64.1.2"
echo ""
echo "4. 编辑 Siliu 配置文件:"
echo "   nano ~/.siliu/config.json"
echo ""
cat << 'EOF'
{
  "ai": {
    "mode": "openclaw",
    "openclaw": {
      "url": "ws://CLOUD_TAILSCALE_IP:18789",
      "token": "your-token",
      "isCloud": true
    }
  },
  "visual": {
    "transferMode": "server",
    "tailscaleIp": "YOUR_TAILSCALE_IP"
  }
}
EOF

echo ""
echo "5. 替换:"
echo "   CLOUD_TAILSCALE_IP → 云端服务器的 Tailscale IP"
echo "   YOUR_TAILSCALE_IP  → 本机的 Tailscale IP: $TAILSCALE_IP"
echo ""

# 测试连接
echo "[5/5] 测试连接"
echo ""
echo "请先在云端服务器上安装 Tailscale 并记录其 IP。"
echo ""
echo "测试命令（在本地运行）:"
echo "  ping \u003c云端服务器 Tailscale IP\u003e"
echo ""
echo "如果 ping 通，说明 Tailscale 网络已建立。"
echo ""

# 创建快捷脚本
cat > /tmp/test-tailscale.sh << EOF
#!/bin/bash
echo "测试 Tailscale 连接..."
echo "本机 IP: $(tailscale ip -4)"
echo ""
echo "网络中的设备:"
tailscale status
echo ""
echo "测试完成。请确保云端服务器也显示在列表中。"
EOF
chmod +x /tmp/test-tailscale.sh

echo "运行 /tmp/test-tailscale.sh 查看网络状态"
echo ""
echo "========================================"
echo "Tailscale 配置完成！"
echo "========================================"
