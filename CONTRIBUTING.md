# Contributing to Siliu Browser

Thank you for your interest in contributing to Siliu Browser! This document provides guidelines and instructions for contributing.

---

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Submitting Changes](#submitting-changes)
- [Coding Standards](#coding-standards)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)

---

## 📜 Code of Conduct

This project adheres to a code of conduct that we expect all contributors to follow:
- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community and the project

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: Version 18.x or higher
- **npm**: Version 9.x or higher
- **Git**: Latest version
- **Windows**: Windows 10/11 (primary development platform)
- **Optional**: VS Code with ESLint extension

### Fork and Clone

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/siliu.git
cd siliu

# Install dependencies
npm install
```

### Initial Setup

```bash
# Create config directory and default config
mkdir -p ~/.siliu
cp config.example.json ~/.siliu/config.json

# Edit config.json with your AI backend settings
```

---

## 🛠️ Development Workflow

### Running in Development Mode

```bash
# Start with hot-reload (development tools enabled)
npm run dev

# Or start normally
npm start
```

### Available Scripts

| Command | Description | Status |
|---------|-------------|--------|
| `npm start` | Start the application | ✅ Working |
| `npm run dev` | Start with DevTools enabled | ✅ Working |
| `npm run dist` | Build for all platforms | ✅ Working |
| `npm run dist:win` | Build Windows packages | ✅ Working |
| `npm run dist:mac` | Build macOS packages | ✅ Working |
| `npm run dist:linux` | Build Linux packages | ✅ Working |
| `npm test` | Run tests | ⚠️ No tests yet |

### Development Tips

1. **Enable DevTools**: Use `npm run dev` to open Chrome DevTools automatically
2. **Check Logs**: View `log.txt` in the project root for detailed logs
3. **Config Location**: User config is stored at `~/.siliu/config.json`
4. **Workspace Data**: Downloads, exports, and screenshots go to `~/.siliu/workspace/`

---

## 📤 Submitting Changes

### Branch Naming

Use descriptive branch names:
```
feature/add-dark-mode
bugfix/fix-upload-dialog
docs/update-readme
refactor/optimize-cdp-controller
```

### Commit Message Format

Follow conventional commits:
```
type(scope): subject

body (optional)

footer (optional)
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, semicolons, etc)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Build process or auxiliary tool changes

Examples:
```
feat(copilot): add support for MiniMax API
fix(dialog): resolve file path encoding issue on Windows
docs(readme): update installation instructions
```

### Pull Request Process

1. **Create a Branch**: `git checkout -b feature/your-feature`
2. **Make Changes**: Write code following our coding standards
3. **Test**: Ensure your changes work on Windows (primary platform)
4. **Commit**: `git commit -m "feat: add new feature"`
5. **Push**: `git push origin feature/your-feature`
6. **Open PR**: Create a Pull Request with detailed description

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Refactoring

## Testing
- [ ] Tested on Windows 10/11
- [ ] Manual testing completed
- [ ] No new warnings/errors

## Screenshots (if applicable)
Add screenshots for UI changes

## Checklist
- [ ] Code follows project style
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
```

---

## 📝 Coding Standards

### JavaScript Style Guide

- Use **ES6+** features
- Use **semicolons**
- Use **single quotes** for strings
- **2 spaces** for indentation
- Max line length: **100 characters**

### Example

```javascript
// Good
class MyClass {
  constructor(options = {}) {
    this.name = options.name || 'default';
    this.enabled = true;
  }

  async doSomething() {
    try {
      const result = await someAsyncOperation();
      return result;
    } catch (err) {
      console.error('[MyClass] Operation failed:', err.message);
      throw err;
    }
  }
}

// Bad
class my_class {
  constructor(options) {
    this.name = options.name || "default"
    this.enabled = true
  }
  
  doSomething() {
    return someAsyncOperation().then(result => result)
  }
}
```

### Naming Conventions

- **Classes**: PascalCase (`CDPController`, `ExportManager`)
- **Functions/Methods**: camelCase (`sendMessage`, `getConfig`)
- **Constants**: UPPER_SNAKE_CASE (`DEFAULT_CONFIG`, `MAX_RETRY`)
- **Private methods**: Prefix with underscore (`_loadConfig`, `_initWin32`)
- **Events**: kebab-case (`ai:connected`, `config:changed`)

### File Organization

```
src/
├── core/           # Core services (managers, handlers)
├── copilot/        # AI Copilot system
├── siliu-controller/  # Browser automation
├── services/       # External service adapters
├── exporters/      # Data export handlers
└── preload/        # Preload scripts
```

---

## 🏗️ Project Structure

```
siliu/
├── src/
│   ├── app.js                 # Main entry point
│   ├── copilot/               # AI Copilot system
│   │   ├── window-copilot.js  # Per-window Copilot
│   │   ├── agents/            # Agent system
│   │   │   ├── base-agent.js
│   │   │   └── builtin/
│   │   └── prompt-builder.js
│   ├── siliu-controller/      # Browser automation
│   │   ├── cdp-controller.js  # CDP wrapper
│   │   └── cdp-manager.js
│   ├── core/                  # Core services
│   │   ├── config-manager.js
│   │   ├── window-manager.js
│   │   ├── dialog-interceptor.js
│   │   └── export-manager.js
│   ├── services/              # AI service adapters
│   │   ├── ai-service.js
│   │   ├── kimi-adapter.js
│   │   └── kimi-coding-adapter.js
│   └── preload/               # Preload scripts
├── public/                    # UI assets
├── docs/                      # Documentation
└── assets/                    # Icons and images
```

---

## 🐛 Troubleshooting

### Common Issues

#### `npm install` fails
```bash
# Clear npm cache
npm cache clean --force

# Use taobao mirror (China)
npm config set registry https://registry.npmmirror.com

# Try again
npm install
```

#### Electron fails to start
```bash
# Rebuild native modules
npm run postinstall

# Or manually
npx electron-rebuild
```

#### Config not loading
- Check file location: `~/.siliu/config.json`
- Validate JSON syntax
- Check file permissions

#### CDP connection fails
- Ensure port 35247 is not in use
- Try restarting the application
- Check Windows Firewall settings

### Getting Help

- **Issues**: Open a GitHub Issue for bugs or feature requests
- **Discussions**: Use GitHub Discussions for questions
- **Email**: Contact the maintainers (if provided)

---

## 🙏 Recognition

Contributors will be recognized in our README and release notes.

Thank you for contributing to Siliu Browser!
