#!/bin/bash
# start-ngrok-tunnel.sh - 启动 ngrok 隧道暴露截图服务

# 需要先安装 ngrok 并配置 authtoken
# https://ngrok.com/download

# 启动 ngrok 隧道，暴露本地截图服务
# 假设截图 HTTP 服务运行在 8080 端口
ngrok http 8080 --domain=siliu-screenshots.ngrok-free.app

# 输出类似：
# Forwarding: https://siliu-screenshots.ngrok-free.app -> http://localhost:8080
# 将这个 URL 配置到 Siliu 中
