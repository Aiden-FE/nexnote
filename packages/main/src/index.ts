import { app, dialog, ipcMain, shell } from 'electron';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppStore } from './vault/app-store';
import { VaultSession } from './vault/vault-session';
import { VaultFsService } from './fs/fs-service';
import { VaultWatchService } from './fs/watch-service';
import { LinkIndexService } from './indexer/index-service';
import { WindowManager } from './window';
import { registerAllIpcHandlers } from './ipc';
import { checkForUpdates, initAutoUpdater } from './updater';
import { SmokeController } from './smoke';
import { GitService } from './git/git-service';

const isSmokeMode = process.env.NEXNOTE_SMOKE === '1';

function log(...args: unknown[]): void {
  console.log('[main]', ...args);
}

// 冒烟模式：隔离 userData，保证每次运行都是干净首启动（走向导）
if (isSmokeMode) {
  const smokeUserData = join(tmpdir(), `nexnote-smoke-${Date.now()}`);
  app.setPath('userData', smokeUserData);
  log('smoke mode: userData isolated at', smokeUserData);
}

// ── 单实例锁 ─────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  log('another instance is running, quitting');
  app.quit();
} else {
  void app.whenReady().then(bootstrap);
}

let windows: WindowManager | null = null;

function bootstrap(): void {
  const appStore = new AppStore(join(app.getPath('userData'), 'nexnote-app.json'));
  windows = new WindowManager({ getAppStore: () => appStore, devTools: !!process.env.NEXNOTE_DEVTOOLS });
  const vaultSession = new VaultSession({
    appStore,
    windows,
    onChanged: () => {
      const root = vaultSession.getCurrent()?.root ?? null;
      index.setRoot(root);
      void watch.sync();
    },
  });
  const index = new LinkIndexService((status) => windows?.sendToMainWindow('index:statusChanged', status));
  // 文件监视（DEV-003）：事件同时驱动树刷新与 DEV-004 的防抖单文件索引。
  const watch = new VaultWatchService({
    getRoot: () => vaultSession.getCurrent()?.root ?? null,
    emit: (event) => {
      windows?.sendToMainWindow('fs:changed', event);
      const root = vaultSession.getCurrent()?.root ?? null;
      if (event.kind === 'add' || event.kind === 'change' || event.kind === 'unlink') {
        index.scheduleUpdate(event.path, root);
      } else if (event.kind === 'addDir' || event.kind === 'unlinkDir') {
        // Directory operations can produce a storm of descendant mutations; coalesce one atomic rebuild.
        index.scheduleRebuild(root);
      }
    },
    onError: (e) => log('watch error:', e),
  });
  const fs = new VaultFsService(() => vaultSession.getCurrent()?.root ?? null);
  const git = new GitService({
    useSystemGit: appStore.getUseSystemGit(),
    defaultDebounceMs: appStore.getAutoCommitDebounceMs(),
  });

  initAutoUpdater(log);

  registerAllIpcHandlers(ipcMain, {
    windows,
    appStore,
    vaultSession,
    fs,
    git,
    dialogs: {
      async pickDirectory() {
        const win = windows?.getMainWindow() ?? null;
        const options: Electron.OpenDialogOptions = {
          title: '选择文件夹',
          properties: ['openDirectory', 'createDirectory'],
        };
        const result = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options);
        return result.canceled ? null : (result.filePaths[0] ?? null);
      },
    },
    async trash(absPath) {
      await shell.trashItem(absPath);
    },
    async revealItem(absPath) {
      shell.showItemInFolder(absPath);
    },
    watch,
    index,
    appInfo() {
      return {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        isPackaged: app.isPackaged,
        electronVersion: process.versions.electron ?? 'unknown',
      };
    },
    checkForUpdates() {
      return checkForUpdates();
    },
  });

  // 单实例：第二个实例启动时聚焦既有窗口（未来：解析 argv 文件路径直接打开，DEV-019）
  app.on('second-instance', () => windows?.focusMain());

  if (isSmokeMode) {
    const smoke = new SmokeController({
      windows,
      // out/main/index.js → ../.. = worktree 根（.scratch/ 与仓库同级）
      outputDir: join(__dirname, '../../.scratch/nexnote-build/smoke/DEV-007'),
    });
    void smoke.init();
  }

  windows.createMainWindow();

  app.on('activate', () => {
    if (!windows?.getMainWindow()) windows?.createMainWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('web-contents-created', (_event, contents) => {
  // 兜底：任何 webContents 都不允许被导航去未知 origin（与窗口层校验双保险）
  contents.on('will-attach-webview', (event) => event.preventDefault());
});
