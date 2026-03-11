# 云端 OpenClaw + 本地 Siliu 解决方案对比

## 问题背景

当 **OpenClaw 运行在云端服务器**，而 **Siliu Browser 运行在本地机器** 时，需要解决截图传输问题。

---

## 方案对比

### 方案 1: Tailscale 内网穿透 ⭐ **推荐**

```
本地 Siliu (100.64.1.3) ←──Tailscale──→ 云端 OpenClaw (100.64.1.2)
      │                                      │
      └─ HTTP 服务提供截图 ────────────────────┘
```

**优点**:
- ✅ 端到端加密，安全性最高
- ✅ 截图不离开私有网络
- ✅ 点对点直连，速度快
- ✅ 免费，配置简单
- ✅ 不依赖第三方服务

**缺点**:
- ⚠️ 需要安装 Tailscale

**适用场景**:
- 云端 OpenClaw + 本地 Siliu
- 注重隐私和安全

**配置**:
```json
{
  "visual": {
    "transferMode": "server",
    "tailscaleIp": "100.64.1.3"
  }
}
```

---

### 方案 2: Cloudflare Tunnel

```
本地 Siliu ←──Cloudflare Tunnel──→ Cloudflare Edge ←──→ 云端 OpenClaw
```

**优点**:
- ✅ 无需公网 IP
- ✅ 全球 CDN 加速
- ✅ 支持自定义域名
- ✅ 免费

**缺点**:
- ⚠️ 需要域名
- ⚠️ 配置稍复杂
- ⚠️ 数据经过 Cloudflare

**适用场景**:
- 已有域名
- 需要全球访问

---

### 方案 3: Ngrok

```
本地 Siliu ←──Ngrok Tunnel──→ 公网 ←──→ 云端 OpenClaw
```

**优点**:
- ✅ 无需域名
- ✅ 配置最简单
- ✅ 免费版可用

**缺点**:
- ⚠️ 免费版有连接数限制
- ⚠️ 免费版 URL 随机变化
- ⚠️ 数据经过第三方服务器

**适用场景**:
- 快速测试
- 临时使用

**命令**:
```bash
ngrok http 8080
```

---

### 方案 4: FRP 自建

```
本地 Siliu ←──FRP Client──→ 你的公网服务器 ←──FRP Server──→ 云端 OpenClaw
```

**优点**:
- ✅ 完全可控
- ✅ 无第三方依赖
- ✅ 性能最好

**缺点**:
- ⚠️ 需要一台公网服务器
- ⚠️ 配置复杂

**适用场景**:
- 有公网服务器
- 长期稳定运行

---

### 方案 5: SSH 反向隧道

```
本地 Siliu ←──SSH -R──→ 云端 OpenClaw (同一台机器)
```

**优点**:
- ✅ 无需额外软件
- ✅ 使用现有 SSH 连接
- ✅ 免费

**缺点**:
- ⚠️ SSH 连接必须保持
- ⚠️ 不稳定（SSH 断开就失效）

**命令**:
```bash
ssh -R 8080:localhost:8080 your-cloud-server
```

---

### 方案 6: 直连 Kimi API（绕过 OpenClaw）

```
本地 Siliu ←──HTTPS──→ Kimi API
```

**优点**:
- ✅ 最简单
- ✅ 无需解决文件传输问题
- ✅ Base64 直接放 HTTP body

**缺点**:
- ⚠️ 失去 OpenClaw 的统一管理
- ⚠️ 需要单独配置 API Key
- ⚠️ 无法使用 OpenClaw 的技能/记忆

**配置**:
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

### 方案 7: 公共图床（不推荐）

```
本地 Siliu ←──HTTPS──→ Catbox/SM.MS/Imgur ←──HTTPS──→ 云端 OpenClaw
```

**优点**:
- ✅ 实现简单
- ✅ 无需网络配置

**缺点**:
- ❌ 隐私泄露风险（截图上传到第三方）
- ❌ 依赖第三方服务可用性
- ❌ 上传/下载速度慢
- ❌ 可能有额度限制

**适用场景**:
- 测试环境
- 不敏感的内容

---

## 综合推荐

| 场景 | 推荐方案 | 理由 |
|------|---------|------|
| 云端 OpenClaw + 本地 Siliu | **Tailscale** | 安全、免费、简单 |
| 已有域名 | **Cloudflare Tunnel** | 稳定、全球加速 |
| 快速测试 | **Ngrok** | 零配置 |
| 有公网服务器 | **FRP** | 完全可控 |
| 不想用 OpenClaw | **直连 Kimi** | 最简单 |
| 生产环境 | **Tailscale** 或 **FRP** | 安全可靠 |

---

## 安全等级排序

1. ⭐⭐⭐⭐⭐ **Tailscale** - 端到端加密，私有网络
2. ⭐⭐⭐⭐⭐ **FRP 自建** - 完全可控
3. ⭐⭐⭐⭐ **SSH 隧道** - 加密，但依赖 SSH
4. ⭐⭐⭐⭐ **Cloudflare Tunnel** - TLS 加密，但经过第三方
5. ⭐⭐⭐ **直连 Kimi** - HTTPS 加密
6. ⭐⭐ **Ngrok** - TLS 加密，但经过第三方
7. ⭐ **公共图床** - 无加密保障，泄露风险

---

## 快速决策树

```
云端 OpenClaw + 本地 Siliu?
├── 注重隐私安全?
│   └── Tailscale (推荐)
├── 有公网服务器?
│   └── FRP
├── 有域名?
│   └── Cloudflare Tunnel
├── 不想配置网络?
│   └── 直连 Kimi API
└── 只是测试?
    └── Ngrok
```

---

## 配置速查表

### Tailscale
```bash
# 安装
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# 配置
tailscale ip -4  # 获取 IP
```

### Cloudflare Tunnel
```bash
# 安装
brew install cloudflared

# 运行
cloudflared tunnel --url http://localhost:8080
```

### Ngrok
```bash
# 安装
brew install ngrok

# 运行
ngrok http 8080
```

### FRP
```bash
# 服务端 (公网服务器)
./frps -c frps.ini

# 客户端 (本地)
./frpc -c frpc.ini
```

### SSH 隧道
```bash
ssh -R 8080:localhost:8080 user@cloud-server
```

---

## 下一步

1. 选择适合你的方案
2. 阅读对应文档:
   - Tailscale: `docs/TAILSCALE_SETUP.md`
3. 运行测试脚本: `./test-tailscale-mode.sh`
4. 更新配置文件并测试
