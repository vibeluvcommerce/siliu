#!/bin/bash
# castLabs Electron 安装脚本

echo "=== castLabs Electron 安装脚本 ==="
echo ""

# 版本号
VERSION="28.0.0+wvcus"
ELECTRON_DIR="node_modules/electron/dist"

# 检测平台
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    PLATFORM="linux-x64"
    EXECUTABLE="electron"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    PLATFORM="win32-x64"
    EXECUTABLE="electron.exe"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    PLATFORM="darwin-x64"
    EXECUTABLE="Electron.app/Contents/MacOS/Electron"
else
    echo "不支持的平台: $OSTYPE"
    exit 1
fi

echo "平台: $PLATFORM"
echo "版本: $VERSION"
echo ""

# 下载地址
DOWNLOAD_URL="https://github.com/castlabs/electron-releases/releases/download/v${VERSION//+/%2B}/electron-v${VERSION//+/%2B}-${PLATFORM}.zip"

echo "下载地址: $DOWNLOAD_URL"
echo ""

# 检查现有 electron
if [ -d "$ELECTRON_DIR" ]; then
    echo "备份现有 electron..."
    mv "$ELECTRON_DIR" "${ELECTRON_DIR}.backup.$(date +%s)"
fi

# 创建目录
mkdir -p "$ELECTRON_DIR"

# 下载
echo "正在下载 castLabs Electron..."
if command -v wget &> /dev/null; then
    wget -O /tmp/electron-castlabs.zip "$DOWNLOAD_URL"
elif command -v curl &> /dev/null; then
    curl -L -o /tmp/electron-castlabs.zip "$DOWNLOAD_URL"
else
    echo "错误: 需要 wget 或 curl"
    exit 1
fi

if [ ! -f "/tmp/electron-castlabs.zip" ]; then
    echo "下载失败!"
    exit 1
fi

echo "下载完成，正在解压..."

# 解压
if command -v unzip &> /dev/null; then
    unzip -q /tmp/electron-castlabs.zip -d "$ELECTRON_DIR"
else
    echo "错误: 需要 unzip"
    exit 1
fi

# 验证
if [ -f "$ELECTRON_DIR/$EXECUTABLE" ]; then
    echo ""
    echo "✅ castLabs Electron 安装成功!"
    echo ""
    echo "可执行文件: $ELECTRON_DIR/$EXECUTABLE"
    echo ""
    echo "现在可以运行: npm start"
else
    echo ""
    echo "❌ 安装失败，请检查下载的文件"
    exit 1
fi

# 清理
rm -f /tmp/electron-castlabs.zip
