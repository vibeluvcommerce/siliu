/**
 * UpdateChecker - 软件更新检测器
 * 通过 GitHub Releases API 检查最新版本
 */

const { dialog, shell } = require('electron');
const https = require('https');
const { globalEventBus } = require('./event-bus');

// GitHub 仓库信息
const GITHUB_REPO = 'vibeluvcommerce/siliu';
const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const RELEASES_PAGE_URL = `https://github.com/${GITHUB_REPO}/releases`;

// 检查间隔（7天）
const CHECK_INTERVAL = 7 * 24 * 60 * 60 * 1000;

class UpdateChecker {
  constructor(configManager) {
    this.configManager = configManager;
    this.currentVersion = require('../../package.json').version;
    this.lastCheckTime = null;
    this.updateAvailable = false;
    this.latestVersion = null;
    this.latestReleaseUrl = null;
    
    this._init();
  }

  /**
   * 初始化
   */
  _init() {
    // 启动时检查一次
    setTimeout(() => this.checkForUpdates(true), 10000);
    
    // 定期检查
    setInterval(() => this.checkForUpdates(true), CHECK_INTERVAL);
    
    // 监听手动检查请求
    globalEventBus.on('update:check', () => this.checkForUpdates(false));
  }

  /**
   * 检查更新
   * @param {boolean} silent - 是否静默检查（无更新时不弹窗）
   */
  async checkForUpdates(silent = true) {
    try {
      console.log('[UpdateChecker] Checking for updates...');
      
      const release = await this._fetchLatestRelease();
      if (!release) {
        console.log('[UpdateChecker] Failed to fetch release info');
        return;
      }

      this.latestVersion = release.tag_name.replace(/^v/, '');
      this.latestReleaseUrl = release.html_url;
      this.lastCheckTime = Date.now();

      const hasUpdate = this._compareVersions(this.currentVersion, this.latestVersion);
      
      if (hasUpdate) {
        console.log(`[UpdateChecker] Update available: ${this.currentVersion} → ${this.latestVersion}`);
        this.updateAvailable = true;
        globalEventBus.emit('update:available', {
          currentVersion: this.currentVersion,
          latestVersion: this.latestVersion,
          releaseUrl: this.latestReleaseUrl,
          releaseNotes: release.body
        });
        
        // 静默模式不弹窗，只通知 UI 显示红点标识
        if (!silent) {
          this._showUpdateDialog();
        }
      } else {
        console.log('[UpdateChecker] No updates available');
        this.updateAvailable = false;
        globalEventBus.emit('update:noUpdate', {
          currentVersion: this.currentVersion,
          lastCheckTime: this.lastCheckTime
        });
        
        if (!silent) {
          this._showNoUpdateDialog();
        }
      }
    } catch (err) {
      console.error('[UpdateChecker] Check failed:', err.message);
      if (!silent) {
        this._showErrorDialog();
      }
    }
  }

  /**
   * 获取最新 Release 信息
   */
  _fetchLatestRelease() {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${GITHUB_REPO}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': 'Siliu-Browser-UpdateChecker',
          'Accept': 'application/vnd.github.v3+json'
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const release = JSON.parse(data);
              resolve(release);
            } else if (res.statusCode === 404) {
              // 没有发布过 Release
              console.log('[UpdateChecker] No releases found');
              resolve(null);
            } else {
              reject(new Error(`HTTP ${res.statusCode}`));
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  /**
   * 版本号比较
   * @returns {boolean} true 如果 remoteVersion > localVersion
   */
  _compareVersions(localVersion, remoteVersion) {
    const local = localVersion.split('.').map(Number);
    const remote = remoteVersion.split('.').map(Number);
    
    for (let i = 0; i < Math.max(local.length, remote.length); i++) {
      const localPart = local[i] || 0;
      const remotePart = remote[i] || 0;
      
      if (remotePart > localPart) return true;
      if (remotePart < localPart) return false;
    }
    
    return false;
  }

  /**
   * 显示更新对话框
   */
  _showUpdateDialog() {
    const result = dialog.showMessageBoxSync({
      type: 'info',
      title: '发现新版本',
      message: `Siliu Browser 有新版本可用`,
      detail: `当前版本: ${this.currentVersion}\n最新版本: ${this.latestVersion}\n\n是否前往下载页面？`,
      buttons: ['立即下载', '稍后再说', '查看详情'],
      defaultId: 0,
      cancelId: 1
    });

    if (result === 0) {
      // 打开下载页面
      shell.openExternal(this.latestReleaseUrl || RELEASES_PAGE_URL);
    } else if (result === 2) {
      // 查看详情
      shell.openExternal(this.latestReleaseUrl || RELEASES_PAGE_URL);
    }
  }

  /**
   * 显示无更新对话框
   */
  _showNoUpdateDialog() {
    dialog.showMessageBoxSync({
      type: 'info',
      title: '检查更新',
      message: '已是最新版本',
      detail: `当前版本: ${this.currentVersion}\n无需更新`,
      buttons: ['确定']
    });
  }

  /**
   * 显示错误对话框
   */
  _showErrorDialog() {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: '检查更新失败',
      message: '无法检查更新',
      detail: '请检查网络连接，或稍后重试。',
      buttons: ['确定']
    });
  }

  /**
   * 获取更新状态
   */
  getStatus() {
    return {
      currentVersion: this.currentVersion,
      latestVersion: this.latestVersion,
      updateAvailable: this.updateAvailable,
      lastCheckTime: this.lastCheckTime,
      releaseUrl: this.latestReleaseUrl
    };
  }

  /**
   * 手动触发检查（用于菜单项）
   */
  checkNow() {
    this.checkForUpdates(false);
  }
}

module.exports = { UpdateChecker };
