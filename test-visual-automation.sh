#!/bin/bash
# test-visual-automation.sh - 一键测试视觉驱动自动化

echo "========================================"
echo "Siliu Browser 视觉驱动自动化测试"
echo "========================================"

cd /home/ubuntu/.openclaw/workspace/siliu

# 1. 语法检查
echo -e "\n[1/4] 语法检查..."
node -c src/copilot/visual-context.js && echo "✅ visual-context.js"
node -c src/copilot/window-copilot.js && echo "✅ window-copilot.js"
node -c src/copilot/prompt-builder.js && echo "✅ prompt-builder.js"

# 2. 检查 OpenClaw 连接
echo -e "\n[2/4] 检查 OpenClaw 状态..."
if openclaw status | grep -q "connected"; then
  echo "✅ OpenClaw 已连接"
else
  echo "⚠️ OpenClaw 未连接，请先启动: openclaw gateway"
fi

# 3. 检查临时目录
echo -e "\n[3/4] 检查临时目录..."
mkdir -p /tmp/siliu-screenshots
ls -la /tmp/siliu-screenshots/ | head -5

# 4. 启动浏览器测试
echo -e "\n[4/4] 启动浏览器..."
echo "请手动执行以下步骤:"
echo "  1. npm start"
echo "  2. 打开任意网页"
echo "  3. 在 Copilot 输入: @action: 截图并描述页面"
echo "  4. 观察日志输出"

echo -e "\n========================================"
echo "测试准备完成！"
echo "========================================"
