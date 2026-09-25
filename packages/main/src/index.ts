import { app, dialog, ipcMain, safeStorage, shell } from 'electron';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppStore } from './vault/app-store';
import { VaultSession } from './vault/vault-session';
import { VaultFsService } from './fs/fs-service';
import { AppWriteTracker } from './fs/app-write-tracker';
import { VaultWatchService } from './fs/watch-service';
import { MetadataStore } from './document/metadata-store';
import { LinkIndexService } from './indexer/index-service';
import { WindowManager } from './window';
import { registerAllIpcHandlers } from './ipc';
import {
  checkForUpdates,
  downloadUpdate,
  initAutoUpdater,
  installUpdate,
  setUpdateChannel as runtimeSetUpdateChannel,
} from './updater';
import { SmokeController } from './smoke';
import { AiStore } from './ai/ai-store';
import { AiService } from './ai/ai-service';
import { RetrievalService } from './retrieval/retrieval-service';
import { createSecretVault } from './ai/secret-store';
import { GitService } from './git/git-service';
import { GitSyncDoctor } from './git/git-sync-doctor';
import { ConfidenceService } from './confidence/confidence-service';
import { PluginService } from './plugins/plugin-service';
import { SkillService } from './skills/skill-service';
import { SettingsService } from './settings/settings-service';
import { extractUpdateSettings, syncUpdaterSettings } from './settings/update-settings-sync';
import { detectSystemProxy } from './settings/system-proxy';
import {
  deriveAiProxyBypass,
  deriveAiProxyUrlFromCache,
  deriveNetworkProxyFromCache,
} from './settings/network-proxy';
import { VaultOperationsController } from './vault/vault-operations-controller';
import { VaultCloneController } from './vault/vault-clone-controller';
import { BUILTIN_PLUGIN_MANIFESTS } from './plugins/builtin/builtin-manifests';
import { AgentGateway } from './agent/gateway';
import { ToolRegistry } from './agent/tool-registry';
import { createBuiltinTools } from './agent/builtin-tools';
import { BinaryEditorHostManager } from './binary/binary-editor-host';

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
  windows = new WindowManager({
    getAppStore: () => appStore,
    devTools: !!process.env.NEXNOTE_DEVTOOLS,
  });
  let initializingRoot: string | null | undefined;
  const vaultSession = new VaultSession({
    appStore,
    windows,
    onChanged: async (vault) => {
      const root = vault?.root ?? null;
      initializingRoot = root;
      try {
        git.setRoot(root);
        index.setRoot(root);
        await watch.sync();
      } finally {
        initializingRoot = undefined;
      }
    },
  });
  let confidenceService: ConfidenceService | null = null;
  let retrievalService: RetrievalService | null = null;
  const index = new LinkIndexService(
    (status) => windows?.sendToMainWindow('index:statusChanged', status),
    (paths) => {
      if (confidenceService) void confidenceService.refresh(paths === null ? undefined : paths);
      // AI/embedding 索引只能由显式用户意图触发（ADR-0005）。文件编辑、自动保存和
      // watcher 的派生索引更新不得偷偷调用 provider；retrievalService 的 invalidate
      // 仅保留给未来显式「重建语义索引」命令调用。
    },
  );
  // 文件监视（DEV-003）：事件同时驱动树刷新与 DEV-004 的防抖单文件索引。
  // 应用写入登记（DEV-020）：fs 服务写盘落盘点登记，watcher 事件据此标记 origin:'app'。
  const appWrites = new AppWriteTracker();
  const watch = new VaultWatchService({
    getRoot: () =>
      initializingRoot !== undefined ? initializingRoot : (vaultSession.getCurrent()?.root ?? null),
    getFormat: async (relPath) => {
      const root = vaultSession.getCurrent()?.root;
      if (!root) return undefined;
      const value = await new MetadataStore(root).read(relPath).catch(() => null);
      return value?.format === 'markdown' || value?.format === 'native-block'
        ? value.format
        : undefined;
    },
    isRecentAppWrite: (absPath) => appWrites.isRecent(absPath),
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
  const fs = new VaultFsService(() => vaultSession.getCurrent()?.root ?? null, appWrites);
  const git = new GitService({
    useSystemGit: appStore.getUseSystemGit(),
    allowSystemGitFallback: !app.isPackaged,
    defaultDebounceMs: appStore.getAutoCommitDebounceMs(),
  });
  const confidence = new ConfidenceService(
    index,
    git,
    (paths) => windows?.sendToMainWindow('index:confidenceChanged', { paths }),
    (error) => log('confidence error:', error),
    (absPath) => appWrites.record(absPath),
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
  const ai = new AiService({
    store: aiStore,
    sendEvent: (channel, payload) => winRef.sendToMainWindow(channel, payload),
    getProxyUrl: () => deriveAiProxyUrlFromCache(settings.get().network),
    getProxyBypass: () => deriveAiProxyBypass(settings.get().network),
  });

  const gitDoctor = new GitSyncDoctor({
    git,
    ai,
    getRoot: () => vaultSession.getCurrent()?.root ?? null,
  });

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
  // DEV-015：随包内置示范插件（Mermaid/KaTeX）预置激活（可禁用、不可卸载）。
  plugins.seedBuiltins(BUILTIN_PLUGIN_MANIFESTS);

  // DEV-014 检索 Skill 系统：内置三阶段检索 + 插件参数化 Skill，多 Skill 合并重排。
  const skills = new SkillService({
    stateFile: join(app.getPath('userData'), 'nexnote-skills.json'),
    retrieve: (options) => retrievalService.retrieve(options),
    plugins,
  });
  const tools = new ToolRegistry(
    createBuiltinTools({
      retrieve: async (query) => {
        const result = await retrievalService!.retrieve({ query });
        return {
          degraded: result.degraded,
          sources: result.sources.map((s) => ({
            path: s.path,
            title: s.title,
            snippet: s.snippet,
            score: s.score,
          })),
        };
      },
      listPages: () =>
        index
          .allBlocks()
          .filter((b, i, all) => all.findIndex((x) => x.path === b.path) === i)
          .map((b) => ({ path: b.path, title: b.title })),
      document: {
        read: (path) => fs.readTextFile(path),
        write: (path, content) => fs.writeTextFile(path, content, true),
        writeTransaction: async (writes) => {
          for (const write of writes) await fs.writeTextFile(write.path, write.content, true);
        },
      },
    }),
  );
  const agent = new AgentGateway({
    ai,
    tools,
    skills,
    sendEvent: (channel, payload) => winRef.sendToMainWindow(channel, payload),
  });

  // DEV-016：全局设置单一权威（替代 AppStore 中的零散字段 + localStorage 主题）。
  const settings = new SettingsService(join(app.getPath('userData'), 'nexnote-settings.json'));
  const applyGlobalSettings = (global: ReturnType<SettingsService['get']>): void => {
    const useSystemGit = global.git.useSystemGit;
    git.setUseSystemGit(useSystemGit);
    git.setNetworkProxy(deriveNetworkProxyFromCache(global.network));
    if (appStore.getUseSystemGit() !== useSystemGit) {
      appStore.setUseSystemGit(useSystemGit);
    }
  };
  applyGlobalSettings(settings.get());
  // DEV-072：启动即探测 OS 代理，完成后立即把系统代理应用到 Git（AI 每次创建 adapter 时读缓存）。
  void detectSystemProxy().then(() => {
    git.setNetworkProxy(deriveNetworkProxyFromCache(settings.get().network));
  });
  // DEV-016：updater 设置以 SettingsService.updates 为唯一权威，
  // 启动时同步到 updater 运行态 + AppStore 镜像；onChange 持续 diff-apply。
  syncUpdaterSettings(settings, appStore);
  settings.onChange((global) => {
    applyGlobalSettings(global);
    void (async () => {
      const root = vaultSession.getCurrent()?.root;
      const vault = root
        ? await import('./vault/vault-manager').then(({ readVaultSettings }) =>
            readVaultSettings(root),
          )
        : null;
      windows?.sendToMainWindow('settings:changed', { global, vault });
      if (root) {
        try {
          windows?.sendToMainWindow('git:statusChanged', await git.status());
        } catch {
          // 设置持久化已成功；Git 状态可在下一次常规刷新时恢复。
        }
      }
    })();
  });

  // DEV-016：向导操作取消控制器（sender scoped AbortController）。
  const vaultOperations = new VaultOperationsController();

  // DEV-016：一次性 clone 授权（sender 绑定 + TTL + bounded）。
  const vaultClones = new VaultCloneController();

  // DEV-016：sender 生命周期回收。webContents 销毁时同步释放其 token/operation，
  // 防止关闭向导窗口后 AbortController / 令牌泄露。
  app.on('web-contents-created', (_event, contents) => {
    contents.on('destroyed', () => {
      vaultOperations.disposeSender(contents.id);
      vaultClones.disposeSender(contents.id);
    });
  });

  // DEV-018：自动更新。配置以 SettingsService.updates 为单一权威（DEV-016）；
  // syncUpdaterSettings 已将其同步到 updater 运行态，initAutoUpdater 据此初始化。
  initAutoUpdater(log, (status) => windows?.sendToMainWindow('app:updateStatus', status), {
    channel: extractUpdateSettings(settings).channel,
    autoDownload: extractUpdateSettings(settings).autoDownload,
    checkOnLaunch: extractUpdateSettings(settings).checkOnLaunch,
  });

  const binaryEditors = new BinaryEditorHostManager();
  registerAllIpcHandlers(ipcMain, {
    windows,
    appStore,
    vaultSession,
    fs,
    ai,
    agent,
    git,
    gitDoctor,
    binaryEditors,
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
    skills,
    settings,
    vaultOperations,
    vaultClones,
    appInfo() {
      return {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        isPackaged: app.isPackaged,
        electronVersion: process.versions.electron ?? 'unknown',
      };
    },
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    setUpdateChannel(channel) {
      // 单一权威：SettingsService.updates。onChange 中 diff-apply 到 updater 并镜像 AppStore。
      const before = extractUpdateSettings(settings).channel;
      settings.update({ updates: { channel } });
      const after = extractUpdateSettings(settings).channel;
      // channel 切换成功与否由 SettingsService 规范化结果决定
      if (after !== before) {
        // 触发 updater 运行态切换 + channel-switched 状态事件
        runtimeSetUpdateChannel(after);
      }
      return {
        status: (after === channel ? 'channel-switched' : 'error') as 'channel-switched' | 'error',
        message:
          after === channel ? `已切换至 ${channel} 更新通道` : `不支持的更新通道: ${channel}`,
        channel: after,
      };
    },
    getUpdateSettings() {
      // 单一权威：SettingsService.updates
      return extractUpdateSettings(settings);
    },
    setUpdateSettings(patch) {
      // 单一权威：SettingsService.updates。onChange diff-apply 到 updater/AppStore。
      settings.update({ updates: patch });
      return extractUpdateSettings(settings);
    },
  });

  // 单实例：第二个实例启动时聚焦既有窗口（未来：解析 argv 文件路径直接打开，DEV-019）
  app.on('second-instance', () => windows?.focusMain());

  if (isSmokeMode) {
    const smoke = new SmokeController({
      windows,
      // Packaged resources/ASAR are read-only; smoke evidence must use writable temp storage.
      outputDir:
        process.env.NEXNOTE_SMOKE_OUTPUT_DIR ??
        process.env.NEXNOTE_SMOKE_DIR ??
        join(app.getPath('temp'), `nexnote-smoke-results-${Date.now()}`),
    });
    void smoke.init();
  }

  const mainWindow = windows.createMainWindow();
  // DEV-074：二进制编辑器宿主挂到主窗口（WebContentsView 子视图满铺内容区）。
  binaryEditors.attach(mainWindow);
  // 关闭主窗口前等待全部二进制编辑器的 pending 写入完成（ADR-0015 Decision 6）。
  mainWindow.on('close', (event) => {
    if (binaryEditors.size === 0) return;
    event.preventDefault();
    void binaryEditors
      .flushAll()
      .then(() => {
        binaryEditors.destroyAll();
        mainWindow.destroy();
      })
      .catch((error: unknown) => {
        log('binary editor flush failed; keeping the window open', error);
        void dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: '无法关闭 NexNote',
          message: '有二进制文档未能保存。编辑器仍保持打开，请重试保存后再关闭。',
          detail: error instanceof Error ? error.message : String(error),
          buttons: ['返回'],
        });
      });
  });

  app.on('activate', () => {
    if (!windows?.getMainWindow()) {
      const win = windows?.createMainWindow();
      if (win) binaryEditors.attach(win);
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('web-contents-created', (_event, contents) => {
  // 兜底：任何 webContents 都不允许被导航去未知 origin（与窗口层校验双保险）
  contents.on('will-attach-webview', (event) => event.preventDefault());
});
