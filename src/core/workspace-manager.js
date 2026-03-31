/**
 * Workspace Manager - Unified workspace directory management
 * 
 * Centralizes all user data (screenshots, exports, tasks, auto-files)
 * under ~/.siliu/workspace/ to avoid OneDrive sync issues.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

class WorkspaceManager {
  constructor() {
    this.workspaceBase = this._getWorkspaceBase();
    this.subdirs = {
      screenshots: 'screenshots',     // Visual context screenshots
      autoFiles: 'auto-files',        // AI automated file handling
      exports: 'exports',             // User exports (PDF, etc.)
      tasks: 'tasks',                 // Task/session data
      cache: 'cache',                 // Temporary cache data
      downloads: 'downloads',         // Downloaded files
    };
  }

  /**
   * Get workspace base directory
   * Uses ~/.siliu/workspace/ to avoid OneDrive sync
   */
  _getWorkspaceBase() {
    const homeDir = os.homedir();
    return process.env.SILIU_WORKSPACE || path.join(homeDir, '.siliu', 'workspace');
  }

  /**
   * Initialize workspace directories
   */
  async initialize() {
    console.log('[WorkspaceManager] Initializing workspace at:', this.workspaceBase);
    
    // Create base directory
    await this._ensureDir(this.workspaceBase);
    
    // Create all subdirectories
    for (const [name, subdir] of Object.entries(this.subdirs)) {
      const dirPath = path.join(this.workspaceBase, subdir);
      await this._ensureDir(dirPath);
      console.log(`[WorkspaceManager] ${name}: ${dirPath}`);
    }
    
    // Create .gitignore to exclude from accidental git commits
    await this._createGitignore();
    
    console.log('[WorkspaceManager] Workspace initialized');
  }

  /**
   * Ensure directory exists
   */
  async _ensureDir(dirPath) {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * Create .gitignore to exclude workspace from git
   */
  async _createGitignore() {
    const gitignorePath = path.join(this.workspaceBase, '.gitignore');
    const content = `# Siliu workspace - auto-generated
# This directory contains runtime data, do not commit
*
!.gitignore
`;
    try {
      await fs.writeFile(gitignorePath, content, { flag: 'wx' });
    } catch (err) {
      // File already exists, ignore
    }
  }

  // ==========================================
  // Path Getters
  // ==========================================

  /**
   * Get screenshots directory
   */
  getScreenshotsDir() {
    return path.join(this.workspaceBase, this.subdirs.screenshots);
  }

  /**
   * Get auto-files directory
   */
  getAutoFilesDir() {
    return path.join(this.workspaceBase, this.subdirs.autoFiles);
  }

  /**
   * Get exports directory
   */
  getExportsDir() {
    return path.join(this.workspaceBase, this.subdirs.exports);
  }

  /**
   * Get tasks directory
   */
  getTasksDir() {
    return path.join(this.workspaceBase, this.subdirs.tasks);
  }

  /**
   * Get cache directory
   */
  getCacheDir() {
    return path.join(this.workspaceBase, this.subdirs.cache);
  }

  /**
   * Get downloads directory
   */
  getDownloadsDir() {
    return path.join(this.workspaceBase, this.subdirs.downloads);
  }

  /**
   * Get workspace base directory
   */
  getWorkspaceDir() {
    return this.workspaceBase;
  }

  // ==========================================
  // Screenshot Management
  // ==========================================

  /**
   * Generate screenshot filename
   */
  getScreenshotPath(prefix = 'screenshot') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(this.getScreenshotsDir(), `${prefix}-${timestamp}.png`);
  }

  /**
   * List all screenshots
   */
  async listScreenshots() {
    try {
      const files = await fs.readdir(this.getScreenshotsDir());
      const screenshots = [];
      for (const file of files) {
        if (file.endsWith('.png')) {
          const filePath = path.join(this.getScreenshotsDir(), file);
          const stats = await fs.stat(filePath);
          screenshots.push({
            name: file,
            path: filePath,
            size: stats.size,
            createdAt: stats.birthtime,
          });
        }
      }
      return screenshots.sort((a, b) => b.createdAt - a.createdAt);
    } catch (err) {
      console.error('[WorkspaceManager] Failed to list screenshots:', err);
      return [];
    }
  }

  /**
   * Clean old screenshots (keep last N)
   */
  async cleanOldScreenshots(keepCount = 50) {
    try {
      const screenshots = await this.listScreenshots();
      if (screenshots.length > keepCount) {
        const toDelete = screenshots.slice(keepCount);
        for (const screenshot of toDelete) {
          await fs.unlink(screenshot.path);
          console.log('[WorkspaceManager] Deleted old screenshot:', screenshot.name);
        }
        return toDelete.length;
      }
      return 0;
    } catch (err) {
      console.error('[WorkspaceManager] Failed to clean screenshots:', err);
      return 0;
    }
  }

  // ==========================================
  // Auto-File Management
  // ==========================================

  /**
   * Get auto-file upload directory
   */
  getAutoUploadDir() {
    return path.join(this.getAutoFilesDir(), 'uploads');
  }

  /**
   * Get auto-file download directory
   */
  getAutoDownloadDir() {
    return path.join(this.getAutoFilesDir(), 'downloads');
  }

  /**
   * Ensure auto-file subdirectories exist
   */
  async ensureAutoFileDirs() {
    await this._ensureDir(this.getAutoUploadDir());
    await this._ensureDir(this.getAutoDownloadDir());
  }

  /**
   * List auto-files
   */
  async listAutoFiles(type = 'all') {
    try {
      const result = { uploads: [], downloads: [] };
      
      if (type === 'all' || type === 'uploads') {
        await this._ensureDir(this.getAutoUploadDir());
        result.uploads = await this._listFilesInDir(this.getAutoUploadDir());
      }
      
      if (type === 'all' || type === 'downloads') {
        await this._ensureDir(this.getAutoDownloadDir());
        result.downloads = await this._listFilesInDir(this.getAutoDownloadDir());
      }
      
      return result;
    } catch (err) {
      console.error('[WorkspaceManager] Failed to list auto-files:', err);
      return { uploads: [], downloads: [] };
    }
  }

  async _listFilesInDir(dirPath) {
    const files = await fs.readdir(dirPath);
    const result = [];
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = await fs.stat(filePath);
      if (stats.isFile()) {
        result.push({
          name: file,
          path: filePath,
          size: stats.size,
          createdAt: stats.birthtime,
        });
      }
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Clean old auto-files
   */
  async cleanOldAutoFiles(maxAgeDays = 7) {
    try {
      const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
      const now = Date.now();
      let deletedCount = 0;
      
      for (const dir of [this.getAutoUploadDir(), this.getAutoDownloadDir()]) {
        try {
          const files = await fs.readdir(dir);
          for (const file of files) {
            const filePath = path.join(dir, file);
            const stats = await fs.stat(filePath);
            if (now - stats.mtimeMs > maxAge) {
              await fs.unlink(filePath);
              deletedCount++;
            }
          }
        } catch (err) {
          // Directory might not exist
        }
      }
      
      if (deletedCount > 0) {
        console.log(`[WorkspaceManager] Cleaned ${deletedCount} old auto-files`);
      }
      return deletedCount;
    } catch (err) {
      console.error('[WorkspaceManager] Failed to clean auto-files:', err);
      return 0;
    }
  }

  // ==========================================
  // Export Management
  // ==========================================

  /**
   * Generate export filename
   */
  getExportPath(filename, subdir = '') {
    const dir = subdir 
      ? path.join(this.getExportsDir(), subdir)
      : this.getExportsDir();
    return path.join(dir, filename);
  }

  /**
   * Ensure export subdirectory exists
   */
  async ensureExportDir(subdir) {
    const dir = path.join(this.getExportsDir(), subdir);
    await this._ensureDir(dir);
    return dir;
  }

  // ==========================================
  // Task/Session Management
  // ==========================================

  /**
   * Get task file path
   */
  getTaskPath(taskId) {
    return path.join(this.getTasksDir(), `${taskId}.json`);
  }

  /**
   * Save task data
   */
  async saveTask(taskId, data) {
    const taskPath = this.getTaskPath(taskId);
    await fs.writeFile(taskPath, JSON.stringify(data, null, 2));
  }

  /**
   * Load task data
   */
  async loadTask(taskId) {
    try {
      const taskPath = this.getTaskPath(taskId);
      const content = await fs.readFile(taskPath, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      return null;
    }
  }

  /**
   * List all tasks
   */
  async listTasks() {
    try {
      const files = await fs.readdir(this.getTasksDir());
      const tasks = [];
      for (const file of files) {
        if (file.endsWith('.json')) {
          const taskId = file.slice(0, -5);
          const data = await this.loadTask(taskId);
          if (data) {
            tasks.push({ id: taskId, ...data });
          }
        }
      }
      return tasks.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch (err) {
      return [];
    }
  }

  // ==========================================
  // Utility Methods
  // ==========================================

  /**
   * Get workspace statistics
   */
  async getStats() {
    const stats = {
      basePath: this.workspaceBase,
      subdirs: {},
      totalSize: 0,
    };

    for (const [name, subdir] of Object.entries(this.subdirs)) {
      const dirPath = path.join(this.workspaceBase, subdir);
      try {
        const size = await this._calculateDirSize(dirPath);
        stats.subdirs[name] = { path: dirPath, size };
        stats.totalSize += size;
      } catch (err) {
        stats.subdirs[name] = { path: dirPath, size: 0, error: err.message };
      }
    }

    return stats;
  }

  async _calculateDirSize(dirPath) {
    let totalSize = 0;
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          totalSize += await this._calculateDirSize(fullPath);
        } else {
          const stats = await fs.stat(fullPath);
          totalSize += stats.size;
        }
      }
    } catch (err) {
      // Directory doesn't exist or not accessible
    }
    return totalSize;
  }

  /**
   * Clean entire workspace (use with caution!)
   */
  async cleanAll() {
    console.warn('[WorkspaceManager] Cleaning entire workspace...');
    for (const subdir of Object.values(this.subdirs)) {
      const dirPath = path.join(this.workspaceBase, subdir);
      try {
        const entries = await fs.readdir(dirPath);
        for (const entry of entries) {
          if (entry === '.gitignore') continue;
          const fullPath = path.join(dirPath, entry);
          const stat = await fs.stat(fullPath);
          if (stat.isDirectory()) {
            await fs.rmdir(fullPath, { recursive: true });
          } else {
            await fs.unlink(fullPath);
          }
        }
      } catch (err) {
        console.error('[WorkspaceManager] Failed to clean:', dirPath, err.message);
      }
    }
    console.log('[WorkspaceManager] Workspace cleaned');
  }
}

// Singleton instance
let instance = null;

function getWorkspaceManager() {
  if (!instance) {
    instance = new WorkspaceManager();
  }
  return instance;
}

module.exports = { WorkspaceManager, getWorkspaceManager };
