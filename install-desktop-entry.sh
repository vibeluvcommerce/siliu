#!/bin/bash
# install-desktop-entry.sh - 安装 Siliu 桌面入口文件
# 提供 Linux 任务栏右键菜单支持

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_FILE="$SCRIPT_DIR/siliu.desktop"

echo "Installing Siliu desktop entry..."

# 检查 desktop 文件是否存在
if [ ! -f "$DESKTOP_FILE" ]; then
    echo "Error: siliu.desktop not found in $SCRIPT_DIR"
    exit 1
fi

# 复制到应用目录
mkdir -p ~/.local/share/applications
cp "$DESKTOP_FILE" ~/.local/share/applications/

# 更新数据库
update-desktop-database ~/.local/share/applications/ 2>/dev/null || true

echo "Desktop entry installed successfully!"
echo ""
echo "You can now:"
echo "1. Right-click on Siliu in the taskbar to see 'New Tab', 'New Window', etc."
echo "2. Search for 'Siliu' in the applications menu"
echo ""
echo "Note: You may need to log out and log back in for changes to take effect."
