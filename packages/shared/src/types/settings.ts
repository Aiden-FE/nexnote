import type { UpdateChannel } from '../ipc/channels/app';

export type ThemePreference = 'light' | 'dark' | 'system';
export type AppLanguage = 'zh-CN' | 'en-US';
export type { UpdateChannel };
export type StartupBehavior = 'restore' | 'welcome' | 'specific-vault';
export type CodeTheme = 'github' | 'dracula' | 'nord';

export interface ShortcutOverride {
  commandId: string;
  /** Canonical portable accelerator, for example `Mod+Shift+F`. Empty only when disabled=true. */
  key: string;
  disabled: boolean;
}

export type NetworkMode = 'system' | 'http' | 'https' | 'socks5' | 'off';

export interface NetworkSettings {
  /** 跟随系统（默认）、自定义 http/https/socks5 代理、或关闭代理。 */
  mode: NetworkMode;
  host: string | null;
  port: number | null;
  username: string | null;
  /** 密码仅保存在本机 settings 文件，不参与 IPC 错误信息或日志。 */
  password: string | null;
  bypass: string[];
  applyToAi: boolean;
  applyToGit: boolean;
}

export interface GlobalSettings {
  version: 1;
  appearance: {
    theme: ThemePreference;
    language: AppLanguage;
    uiFontFamily: string;
    editorFontFamily: string;
    uiFontSize: number;
    editorFontSize: number;
  };
  updates: {
    checkOnLaunch: boolean;
    autoDownload: boolean;
    channel: UpdateChannel;
  };
  startup: {
    behavior: StartupBehavior;
    specificVaultPath: string | null;
  };
  git: {
    /** The bundled Git remains the safe default. */
    useSystemGit: boolean;
  };
  /** DEV-072：网络/代理设置。默认 mode=system，AI + Git 自动跟随系统代理。 */
  network: NetworkSettings;
  shortcuts: ShortcutOverride[];
}

export interface VaultSettings {
  editor: {
    autoSaveMs: number;
    defaultPageTemplate: string;
    bindFileNameToTitle: boolean;
    /** Persisted placeholder only. The editor labels this as not implemented/restart-required. */
    vimMode: boolean;
    codeTheme: CodeTheme;
  };
  git: {
    autoCommit: boolean;
    autoCommitIntervalMs: number;
    commitMessageTemplate: string;
    defaultBranch: string;
    /** DEV-073：自动同步间隔（秒）。0 = 关闭。默认 5 分钟。 */
    autoSyncIntervalSec: number;
    /** DEV-073：拉取/同步策略，rebase（默认）或 merge。 */
    syncStrategy: 'rebase' | 'merge';
  };
  /**
   * DEV-074 二进制文档编辑器设置（ADR-0015 spike 4）：
   * 编辑器运行在独立 WebContentsView 进程，每个文档一个，需限制并发。
   */
  binary: {
    /**
     * docx / xlsx / xmind tab 并发上限（默认 3）。超出时复用已有 tab 或按 LRU
     * 关闭最早的 tab 来打开新 tab；可在设置内放宽（最多 8，防止内存失控）。
     */
    maxConcurrentTabs: number;
  };
}

export type GlobalSettingsPatch = {
  appearance?: Partial<GlobalSettings['appearance']>;
  updates?: Partial<GlobalSettings['updates']>;
  startup?: Partial<GlobalSettings['startup']>;
  git?: Partial<GlobalSettings['git']>;
  network?: Partial<NetworkSettings>;
};

export type VaultSettingsPatch = {
  editor?: Partial<VaultSettings['editor']>;
  git?: Partial<VaultSettings['git']>;
  binary?: Partial<VaultSettings['binary']>;
};

export interface ShortcutExportBundle {
  app: 'nexnote';
  kind: 'shortcuts';
  version: 1;
  exportedAt: string;
  shortcuts: ShortcutOverride[];
}

export interface SettingSearchEntry {
  id: string;
  sectionId:
    | 'general'
    | 'editor'
    | 'ai'
    | 'git'
    | 'network'
    | 'plugins'
    | 'skills'
    | 'shortcuts'
    | 'about';
  title: string;
  keywords: string[];
  scope: 'global' | 'vault' | 'domain';
}

export const DEFAULT_SHORTCUTS: readonly ShortcutOverride[] = [
  { commandId: 'app.palette', key: 'Mod+K', disabled: false },
  { commandId: 'search.open', key: 'Mod+Shift+F', disabled: false },
  { commandId: 'app.save', key: 'Mod+S', disabled: false },
  { commandId: 'editor.toggleSourceMode', key: 'Mod+E', disabled: false },
  { commandId: 'editor.togglePreviewView', key: 'Mod+Shift+E', disabled: false },
  { commandId: 'tab.new', key: 'Mod+T', disabled: false },
  // DEV-022：tab 栈内循环切换。Ctrl 在非 macOS 平台由运行时归一为 Mod（物理同键）。
  { commandId: 'tab.next', key: 'Ctrl+Tab', disabled: false },
  { commandId: 'tab.prev', key: 'Ctrl+Shift+Tab', disabled: false },
  { commandId: 'app.settings', key: 'Mod+,', disabled: false },
  // DEV-064：折叠当前章节 / 展开当前章节。chord 形式（Mod+K Mod+L）留待后续 chord
  // 改造落地，避免 ShortcutRuntime 不消费 sequence 时命令假绑定。
  { commandId: 'editor.foldCurrentSection', key: 'Mod+Shift+[', disabled: false },
  { commandId: 'editor.expandCurrentSection', key: 'Mod+Shift+]', disabled: false },
];

export function defaultGlobalSettings(): GlobalSettings {
  return {
    version: 1,
    appearance: {
      theme: 'system',
      language: 'zh-CN',
      uiFontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      editorFontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      uiFontSize: 14,
      editorFontSize: 16,
    },
    updates: { checkOnLaunch: true, autoDownload: false, channel: 'stable' },
    startup: { behavior: 'restore', specificVaultPath: null },
    git: { useSystemGit: false },
    network: {
      mode: 'system',
      host: null,
      port: null,
      username: null,
      password: null,
      bypass: [],
      applyToAi: true,
      applyToGit: true,
    },
    shortcuts: DEFAULT_SHORTCUTS.map((shortcut) => ({ ...shortcut })),
  };
}

export function defaultVaultSettings(): VaultSettings {
  return {
    editor: {
      autoSaveMs: 1500,
      defaultPageTemplate: '# {{title}}\n\n',
      bindFileNameToTitle: true,
      vimMode: false,
      codeTheme: 'github',
    },
    git: {
      autoCommit: true,
      autoCommitIntervalMs: 30_000,
      commitMessageTemplate: '保存 {summary}',
      defaultBranch: 'main',
      autoSyncIntervalSec: 300,
      syncStrategy: 'rebase',
    },
    binary: {
      // DEV-074 spike 4：WebContentsView 每文档一个进程，默认并发上限 3（可在设置放宽）。
      maxConcurrentTabs: 3,
    },
  };
}
