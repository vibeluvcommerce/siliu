# Siliu Development Log

## 2026-03-15 - Workspace Directory Unification

### Problem
Project located in OneDrive sync folder (`~/OneDrive/文档/workspace/siliu`) causes severe performance degradation:
- Window creation: 200-500ms delay
- File I/O slowdowns
- Screenshot temp files being synced unnecessarily

### Solution
Created unified workspace directory structure under `~/.siliu/workspace/` (non-synced location):

```
~/.siliu/workspace/
├── .gitignore          # Excludes all files from git
├── screenshots/        # Visual context screenshots (was: os.tmpdir())
├── auto-files/         # AI automated file handling
│   ├── uploads/
│   └── downloads/
├── exports/            # User exports (PDF, etc.)
├── tasks/              # Task/session data
├── cache/              # Temporary cache data
└── downloads/          # Downloaded files
```

### Files Changed

1. **src/core/workspace-manager.js** (NEW)
   - Singleton manager for all workspace operations
   - Path getters: `getScreenshotsDir()`, `getAutoFilesDir()`, etc.
   - Screenshot management: `listScreenshots()`, `cleanOldScreenshots()`
   - Auto-file management: `listAutoFiles()`, `cleanOldAutoFiles()`
   - Task persistence: `saveTask()`, `loadTask()`, `listTasks()`
   - Stats: `getStats()` returns size info for all directories

2. **src/copilot/visual-context.js**
   - Changed: `tempDir` now uses `workspace.getScreenshotsDir()`
   - Added: `cleanupOld(keepCount)` for periodic cleanup

3. **src/core/auto-file-manager.js**
   - Changed: `workDir` now uses `workspace.getAutoFilesDir()`
   - Changed: `_getDefaultWorkDir()` → `_ensureWorkDir()`

4. **src/app.js**
   - Added: Import `getWorkspaceManager`
   - Added: Initialize workspace before other modules

### Environment Variable
Users can override workspace location:
```bash
set SILIU_WORKSPACE=D:\siliu-workspace
```

### Migration Notes
- Old temp screenshots in `os.tmpdir()/siliu-screenshots` are NOT migrated
- Auto-files in `app.getPath('userData')/auto-files` are NOT migrated
- Both locations will be gradually cleaned up by OS/app

### Testing
```bash
node test-workspace.js
```

All tests pass:
- ✓ Workspace initialization
- ✓ Directory path generation
- ✓ Screenshot path generation
- ✓ Task save/load
- ✓ Workspace stats
- ✓ Auto-files listing
- ✓ Screenshots listing

---

## 2026-03-14 - Agent System Refactor

### Dynamic Agent Rendering
- BaseAgent now returns `getDisplayInfo()` with `{icon, color, colorEnd}`
- shell.html renders agents dynamically via `agents:getAll` IPC
- Agents: General (robot/blue), Bilibili (television/pink), Taobao (shopping-cart/orange), Data (chart-bar/green)

### Resource Localization
- Phosphor icons (144KB) moved to `public/vendor/phosphor/`
- Inter fonts (118KB) moved to `public/fonts/`
- Fully offline, no CDN dependency

### Windows Sandbox Fix
- Added `--no-sandbox` to start.bat for development
- Context menus now work correctly (ERR_FAILED resolved)
