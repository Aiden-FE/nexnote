import { app, dialog, ipcMain, safeStorage, shell } from 'electron';
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
import { AiStore } from './ai/ai-store';
import { AiService } from './ai/ai-service';
import { RetrievalService } from './retrieval/retrieval-service';
import { createSecretVault } from './ai/secret-store';
import { GitService } from './git/git-service';
import { ConfidenceService } from './confidence/confidence-service';
import { PluginService } from './plugins/plugin-service';

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

async function bootstrap(): Promise<void> {
  const appStore = new AppStore(join(app.getPath('userData'), 'nexnote-app.json'));
  windows = new WindowManager({ getAppStore: () => appStore, devTools: !!process.env.NEXNOTE_DEVTOOLS });
  const vaultSession = new VaultSession({
    appStore,
    windows,
    onChanged: () => {
      const root = vaultSession.getCurrent()?.root ?? null;
      git.setRoot(root);
      index.setRoot(root);
      void watch.sync();
    },
  });
  let confidenceService: ConfidenceService | null = null;
  let retrievalService: RetrievalService | null = null;
  const index = new LinkIndexService(
    (status) => windows?.sendToMainWindow('index:statusChanged', status),
    (paths) => {
      if (confidenceService) void confidenceService.refresh(paths === null ? undefined : paths);
      retrievalService?.invalidate(paths);
    },
  );
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
  const confidence = new ConfidenceService(
    index,
    git,
    (paths) => windows?.sendToMainWindow('index:confidenceChanged', { paths }),
    (error) => log('confidence error:', error),
  );
  confidenceService = confidence;
  git.onCommitted((root, files) => {
    if (root === (vaultSession.getCurrent()?.root ?? null)) void confidence.refresh(files);
  });

  // AI credentials live in the native OS credential manager; safeStorage is migration-only.
  const secrets = await createSecretVault();
  const aiStore = new AiStore(join(app.getPath('userData'), 'nexnote-ai.json'), secrets, {
    safeStorage,
  });
  const winRef = windows;
  const ai = new AiService({ store: aiStore, sendEvent: (channel, payload) => winRef.sendToMainWindow(channel, payload) });

  // DEV-011 向量索引 + 三阶段召回（embedding 走 ai 的 embedding feature，未配置时自动降级）。
  retrievalService = new RetrievalService({
    index,
    embedder: ai,
    onStatus: (status) => winRef.sendToMainWindow('ai:retrievalStatus', { status }),
  });

  // DEV-013 插件沙箱运行时：staging/状态存于 userData（vault 之外），宿主版本用于 minAppVersion 判定。
  const plugins = new PluginService({
    stateFile: join(app.getPath('userData'), 'nexnote-plugins.json'),
    pluginsRoot: join(app.getPath('userData'), 'plugins'),
    hostVersion: app.getVersion(),
  });

  initAutoUpdater(log);

  registerAllIpcHandlers(ipcMain, {
    windows,
    appStore,
    vaultSession,
    fs,
    ai,
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
      async pickFile(filters) {
        const win = windows?.getMainWindow() ?? null;
        const options: Electron.OpenDialogOptions = {
          title: '选择文件',
          properties: ['openFile'],
          ...(filters ? { filters } : {}),
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
    confidence,
    retrieval: retrievalService,
    plugins,
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
      outputDir: process.env.NEXNOTE_SMOKE_DIR
        ? process.env.NEXNOTE_SMOKE_DIR
        : join(__dirname, '../../.scratch/nexnote-build/smoke/DEV-007'),
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
