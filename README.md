<p align="center">
  <img src="assets/app.png" width="128" height="128" alt="Siliu Logo">
</p>

<h1 align="center">Siliu Browser</h1>

<p align="center">
  <b>AI-Powered Browser Automation</b><br>
  Control your browser with natural language. Let AI handle the tedious clicks, forms, and downloads.
</p>

<p align="center">
  <b>English</b> | <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#usage-examples">Examples</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#development">Development</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-26.6.10-47848F?logo=electron" alt="Electron">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform">
</p>

---

## 🌟 Features

### 🤖 AI-Powered Automation
- **Natural Language Control**: Just tell the browser what to do
- **Visual Understanding**: AI sees the page and decides actions based on screenshots
- **Self-Correction**: Automatically retries and adapts when something goes wrong

### 🎯 Precise Browser Control
- **CDP-Based**: Uses Chrome DevTools Protocol for reliable automation
- **Human-Like Behavior**: Random delays, Bezier curve mouse movements
- **Coordinate-Based Actions**: Click, type, scroll, hover at exact positions

### 📁 File Operations
- **Smart Upload**: Auto-intercepts system file dialogs for seamless uploads
- **Download Management**: Monitors and reports download progress
- **Image Saving**: Save images with `saveImage` (supports anti-hotlinking)

### 📊 Data Extraction
- **Visual Data Collection**: Extract tables and lists from web pages
- **Multi-Format Export**: Excel, CSV, JSON, PDF, PNG
- **Pagination Support**: Auto-fetch data across multiple pages

### 🎭 Agent System
- **Domain-Specific Agents**: Built-in agents for Bilibili, Taobao, and more
- **Custom Agents**: Create your own agents for specific websites
- **Visual Annotation**: Agent Editor for marking element coordinates

---

## 📦 Installation

> ⚠️ **Platform Note**: File operations (upload/download/export) have only been tested on **Windows**. Linux/macOS support for these features is not yet verified.

### Download Pre-built Binaries

Download the latest release for your platform:

| Platform | Download |
|----------|----------|
| Windows (Installer) | `Siliu-Setup-x.x.x.exe` |
| Windows (Portable) | `Siliu-x.x.x-Portable.exe` |
| macOS | `Siliu-x.x.x.dmg` |
| Linux | `Siliu-x.x.x.AppImage` |

### Build from Source

```bash
# Clone the repository
git clone https://github.com/vibeluvcommerce/siliu.git
cd siliu-browser

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run dist
```

---

## ⚙️ Configuration

> 💡 **Tip**: AI configuration can also be done in the Settings page after launching the app.

<p align="center">
  <img src="assets/ai-config-screenshot.png" alt="AI Backend Configuration" width="560">
</p>

Create `config.json` in `~/.siliu/` directory (Windows: `%USERPROFILE%\.siliu\config.json`):

```json
// Option 1: Kimi Code Subscription (Recommended ⭐⭐⭐⭐)
{
  "serviceType": "cloud",
  "cloud": {
    "apiEndpoint": "https://api.kimi.com/coding/v1",
    "apiKey": "sk-your-kimi-code-api-key",
    "model": "k2p5"
  }
}

// Option 2: Moonshot Kimi API
{
  "serviceType": "cloud",
  "cloud": {
    "apiEndpoint": "https://api.moonshot.cn/v1",
    "apiKey": "sk-your-moonshot-api-key",
    "model": "kimi-k2.5"
  }
}

// Option 3: OpenClaw (Self-hosted)
{
  "serviceType": "local",
  "local": {
    "url": "ws://127.0.0.1:18789",
    "token": "your-openclaw-token"
  }
}
```

### AI Backend Options

| Mode | Config Key | Description | Rating |
|------|------------|-------------|--------|
| **Kimi Code** | `cloud` | Kimi Code Subscription (`api.kimi.com/coding`) | ⭐⭐⭐⭐ Recommended |
| **Kimi API** | `cloud` | Moonshot Kimi API (`api.moonshot.cn`) | ⭐⭐⭐ |
| **OpenClaw** | `local` | Self-hosted OpenClaw gateway | ⭐⭐ |

---

## 🚀 Quick Start

### 1. Start the Browser

```bash
npm start
```

### 2. Open Copilot Panel

Click the 🤖 icon in the sidebar to open the AI Copilot panel.

### 3. Give Natural Language Instructions

Example commands:

```
"Open Bilibili and upload my video"
"Search for 'iPhone 15' on Taobao and add the first item to cart"
"Download the first image from this page"
"Extract all product prices from this listing"
```

---

## 💡 Usage Examples

> 📚 **More Examples**: See [AI_AUTOMATION_TEST.md](docs/AI_AUTOMATION_TEST.md) for comprehensive test scenarios including Bilibili upload, Taobao shopping, data extraction, and more.

### Example 1: Upload Video to Bilibili

```
Open Bilibili creation center https://member.bilibili.com/platform/upload/video,
click the upload button, select file D:\videos\myvideo.mp4,
wait for upload progress, enter title "My Test Video",
select category "Lifestyle", and submit.
```

**What happens:**
1. AI navigates to the upload page
2. Clicks the upload button
3. System dialog is auto-intercepted and filled
4. Waits for upload progress
5. Fills the form
6. Submits the video

### Example 2: Save Webpage Image

```
Open Unsplash https://unsplash.com, find the first image,
use saveImage to download it, then tell me the filename.
```

**What happens:**
1. AI identifies the image location from screenshot
2. Uses `saveImage` action (shows blue marker at coordinates)
3. Auto-handles the download dialog
4. Reports: `unsplash_image.jpg (282KB) saved to ~/.siliu/workspace/downloads/`

### Example 3: Extract Data to Excel

```
Open Douban Top 250 https://movie.douban.com/top250,
collect movie names and ratings from this page,
click next page and collect 3 more pages,
export all data to Excel and tell me where it's saved.
```

**What happens:**
1. AI uses `collect` action to extract data
2. Auto-navigates through pagination
3. Exports to `douban_movies_20240402.xlsx`
4. Reports the file path

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        User Interface                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  BrowserView │  │ Copilot Chat │  │ Agent Editor     │  │
│  │  (Web Pages) │  │ (AI Panel)   │  │ (Coordinate Tool)│  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                      Core Services                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ WindowManager│  │ TabManager   │  │ DialogInterceptor│  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                     AI & Automation                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Copilot    │  │   Agent      │  │ SiliuController  │  │
│  │ (AI Brain)   │  │   System     │  │ (CDP + JS)       │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Description |
|-----------|-------------|
| **CDPController** | Chrome DevTools Protocol wrapper for precise browser control |
| **Copilot** | AI decision engine that interprets user commands and plans actions |
| **Agent System** | Domain-specific knowledge providers for popular websites |
| **DialogInterceptor** | Windows API-based system dialog automation |
| **ExportManager** | Handles data collection and multi-format export |

---

## 🎭 Agent System

### Built-in Agents

| Agent | Purpose | Special Knowledge |
|-------|---------|-------------------|
| **General** | Universal web automation | Generic browser control |
| **Bilibili** | B站 automation | Upload, comment, hover menus |
| **Taobao** | 淘宝 automation | Search, filter, cart operations |
| **Data** | Data extraction | Table parsing, pagination |

### Creating Custom Agents

```javascript
const { BaseAgent } = require('./src/copilot/agents/base-agent');

class MyAgent extends BaseAgent {
  constructor() {
    super({
      id: 'myagent',
      name: 'My Site Agent',
      icon: 'shopping-cart',
      color: '#FF6B00'
    });
  }

  getDomainKnowledge() {
    return `
【My Site Specific Rules】
- Search box: coordinates (0.39, 0.09), click then type
- Submit button: orange color, located at bottom right
`;
  }
}

module.exports = { MyAgent };
```

---

## 🛠️ Development

### Project Structure

```
siliu-browser/
├── src/
│   ├── app.js                 # Main entry
│   ├── copilot/               # AI Copilot system
│   │   ├── window-copilot.js  # Per-window Copilot
│   │   ├── agents/            # Agent system
│   │   └── prompt-builder.js  # Prompt construction
│   ├── siliu-controller/      # Browser automation
│   │   ├── cdp-controller.js  # CDP wrapper
│   │   └── cdp-manager.js     # CDP connection
│   ├── core/                  # Core services
│   │   ├── window-manager.js  # Window management
│   │   ├── tab-manager.js     # Tab management
│   │   ├── dialog-interceptor.js # File dialog automation
│   │   └── export-manager.js  # Data export
│   ├── services/              # AI service adapters
│   └── exporters/             # Export format handlers
├── public/                    # UI assets
├── docs/                      # Documentation
└── assets/                    # Icons and images
```

### Available Scripts

| Command | Description | Status |
|---------|-------------|--------|
| `npm start` | Start the application | ✅ Working |
| `npm run dev` | Start with dev tools enabled | ✅ Working |
| `npm run dist` | Build for all platforms | ✅ Working |
| `npm run dist:win` | Build for Windows | ✅ Working |
| `npm run dist:mac` | Build for macOS | ✅ Working |
| `npm run dist:linux` | Build for Linux | ✅ Working |
| `npm test` | Run tests | ⚠️ No tests yet |

> Note: Test suite is not yet implemented. [Contributions welcome!](CONTRIBUTING.md)

---

## 🧪 Testing

See [AI_AUTOMATION_TEST.md](docs/AI_AUTOMATION_TEST.md) for comprehensive testing scenarios.

### Quick Test

```bash
# Currently no automated tests available
# Please refer to docs/AI_AUTOMATION_TEST.md for manual testing
```

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Quick Start for Contributors

```bash
# 1. Fork the repo on GitHub, then clone YOUR fork
git clone https://github.com/YOUR_USERNAME/siliu.git

# 2. Create a branch in YOUR fork
git checkout -b feature/amazing-feature

# 3. Make changes and commit
git commit -m "feat: add amazing feature"

# 4. Push to YOUR fork
git push origin feature/amazing-feature

# 5. Open a Pull Request on GitHub
```

> **Note**: The `feature/amazing-feature` branch is created in **your fork**, not in the original repository. You don't need write access to the original repo!

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Built with [Electron](https://www.electronjs.org/)
- Icons by [Phosphor Icons](https://phosphoricons.com/)
- Font: [Inter](https://rsms.me/inter/)

---

<p align="center">
  Made with ❤️ by the Siliu Team
</p>
