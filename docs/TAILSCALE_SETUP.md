# Tailscale 内网穿透方案

适用于 **OpenClaw 云端部署 + Siliu Browser 本地运行** 的场景，安全地传输截图而不依赖公共图床。

---

## 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         Tailscale 虚拟私有网络                      │
│                                                                  │
│  ┌──────────────────────┐          ┌──────────────────────┐     │
│  │   本地 Siliu Browser  │◄────────►│   云端 OpenClaw      │     │
│  │   100.64.1.3         │   加密   │   100.64.1.2:18789   │     │
│  │                      │   隧道   │                      │     │
│  │  ┌────────────────┐  │          │                      │     │
│  │  │ Screenshot     │  │          │                      │     │
│  │  │ HTTP Server    │  │          │                      │     │
│  │  │ :random_port   │  │          │                      │     │
│  │  └────────────────┘  │          │                      │     │
│  └──────────────────────┘          └──────────────────────┘     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 优势

| 特性 | 说明 |
|------|------|
| **安全性** | WireGuard 加密，比公共图床安全 100 倍 |
| **隐私性** | 截图不会离开你的私有网络 |
| **稳定性** | 不依赖第三方服务可用性 |
| **速度** | 点对点直连，无公网中转 |
| **免费** | 个人使用完全免费 |
| **简单** | 零配置网络，自动 NAT 穿透 |

---

## 快速开始

### 1. 安装 Tailscale（两边都装）

**本地 Siliu 机器：**
```bash
# Linux/Ubuntu
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# macOS
brew install tailscale
sudo tailscaled install
tailscale up

# Windows
# 下载安装: https://tailscale.com/download/windows
```

**云端 OpenClaw 服务器：**
```bash
ssh your-cloud-server
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

### 2. 登录并获取 IP

两边都运行：
```bash
sudo tailscale up
# 按提示在浏览器中完成授权

# 获取分配的 IP
tailscale ip -4
# 输出: 100.64.x.x
```

### 3. 验证连接

在本地机器测试：
```bash
# 测试到云端服务器的连通性
ping 100.64.x.x  # 云端服务器的 Tailscale IP

# 查看网络中的设备
tailscale status
```

### 4. 配置 Siliu

编辑 `~/.siliu/config.json`：

```json
{
  "ai": {
    "mode": "openclaw",
    "openclaw": {
      "url": "ws://100.64.1.2:18789",
      "token": "your-gateway-token",
      "sessionKey": "agent:window:main"
    }
  },
  "visual": {
    "transferMode": "server",
    "tailscaleIp": "100.64.1.3"
  }
}
```

替换：
- `100.64.1.2` → 云端 OpenClaw 服务器的 Tailscale IP
- `100.64.1.3` → 本地 Siliu 机器的 Tailscale IP
- `your-gateway-token` → OpenClaw 网关 Token

### 5. 启动测试

```bash
npm start
```

观察日志输出：
```
[ScreenshotServer] Started on port 12345
[ScreenshotServer] Auth token: xxxxxxxx
[WindowCopilot:main] Screenshot server started on port 12345
[WindowCopilot:main] Using Tailscale URL: http://100.64.1.3:12345/screenshot_xxx.jpg?token=xxx
```

---

## 传输模式对比

| 模式 | 配置 | 安全性 | 适用场景 |
|------|------|--------|---------|
| **file** | `"transferMode": "file"` | ⭐⭐⭐⭐⭐ | OpenClaw 和 Siliu 同一台机器 |
| **server** | `"transferMode": "server"` | ⭐⭐⭐⭐⭐ | Tailscale/内网穿透（推荐） |
| **upload** | `"transferMode": "upload"` | ⭐⭐ | 公共图床（不推荐） |

---

## 安全说明

### ScreenshotServer 安全措施

1. **Token 认证**
   - 每个请求必须携带 `?token=xxx` 参数
   - Token 随机生成，32 字节长度

2. **路径限制**
   - 只能访问配置的截图目录
   - 禁止 `..` 路径遍历

3. **访问日志**
   - 记录每次访问的 IP 和时间
   - 便于审计和排查

4. **CORS 限制**
   - 只允许特定来源访问
   - 防止 CSRF 攻击

### Tailscale 安全措施

1. **WireGuard 加密**
   - 所有流量端到端加密
   - 即使经过中继服务器也无法解密

2. **设备认证**
   - 新设备需要管理员批准
   - 可随时撤销设备访问权限

3. **ACL 控制**
   - 可配置细粒度的访问控制列表
   - 限制设备间通信

---

## 故障排查

### 问题 1: Tailscale IP 无法 ping 通

**原因**: 防火墙阻止了 UDP 端口

**解决**:
```bash
# Linux - 开放 Tailscale 端口
sudo ufw allow 41641/udp

# 或临时禁用防火墙测试
sudo ufw disable
```

### 问题 2: ScreenshotServer 端口冲突

**解决**: 使用随机端口
```json
{
  "visual": {
    "serverPort": 0
  }
}
```

### 问题 3: 云端无法访问本地截图

**检查步骤**:
```bash
# 1. 确认 Tailscale 运行
sudo tailscale status

# 2. 确认 ScreenshotServer 监听
curl http://100.64.1.3:PORT/screenshot.jpg?token=TOKEN

# 3. 在云端服务器上测试
ssh your-cloud-server
curl http://100.64.1.3:PORT/screenshot.jpg?token=TOKEN
```

### 问题 4: 截图 URL 返回 401

**原因**: Token 不匹配

**解决**: 检查 OpenClaw 发送的请求是否携带正确的 token 参数

---

## 高级配置

### 使用固定端口

```json
{
  "visual": {
    "serverPort": 8080
  }
}
```

### 限制截图文件大小

在 `src/services/screenshot-server.js` 中修改：
```javascript
// 最大文件大小 5MB
if (data.length > 5 * 1024 * 1024) {
  res.writeHead(413);
  res.end('File too large');
  return;
}
```

### 添加 IP 白名单

```javascript
// 只允许特定 IP 访问
const allowedIps = ['100.64.1.2'];  // 云端 OpenClaw IP
if (!allowedIps.includes(req.socket.remoteAddress)) {
  res.writeHead(403);
  res.end('Forbidden');
  return;
}
```

---

## 替代方案

如果 Tailscale 不适合你，还有其他选择：

### 方案 A: Cloudflare Tunnel
- 需要域名
- 免费且稳定
- 文档: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/

### 方案 B: Ngrok
- 无需域名
- 免费版有连接数限制
- 命令: `ngrok http 8080`

### 方案 C: FRP 自建
- 需要自己有一台公网服务器
- 完全可控
- 文档: https://github.com/fatedier/frp

### 方案 D: SSH 反向隧道
```bash
# 本地运行
ssh -R 8080:localhost:8080 your-cloud-server

# 云端访问
# http://localhost:8080 会转发到本地
```

---

## 推荐配置总结

**最安全方案**: Tailscale + ScreenshotServer
```json
{
  "visual": {
    "transferMode": "server",
    "tailscaleIp": "100.64.1.3"
  }
}
```

**最简单方案**: 直连 Kimi API（绕过 OpenClaw）
```json
{
  "ai": {
    "mode": "kimi",
    "kimi": {
      "apiKey": "sk-your-key"
    }
  }
}
```

---

## 参考链接

- Tailscale 官网: https://tailscale.com
- Tailscale 文档: https://tailscale.com/kb/
- WireGuard 协议: https://www.wireguard.com/
