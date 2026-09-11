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
  };
}

export type GlobalSettingsPatch = {
  appearance?: Partial<GlobalSettings['appearance']>;
  updates?: Partial<GlobalSettings['updates']>;
  startup?: Partial<GlobalSettings['startup']>;
  git?: Partial<GlobalSettings['git']>;
};

export type VaultSettingsPatch = {
  editor?: Partial<VaultSettings['editor']>;
  git?: Partial<VaultSettings['git']>;
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
  sectionId: 'general' | 'editor' | 'ai' | 'git' | 'plugins' | 'skills' | 'shortcuts' | 'about';
  title: string;
  keywords: string[];
  scope: 'global' | 'vault' | 'domain';
}

export const DEFAULT_SHORTCUTS: readonly ShortcutOverride[] = [
  { commandId: 'app.palette', key: 'Mod+K', disabled: false },
  { commandId: 'search.open', key: 'Mod+Shift+F', disabled: false },
  { commandId: 'app.save', key: 'Mod+S', disabled: false },
  { commandId: 'editor.toggleSourceMode', key: 'Mod+E', disabled: false },
  { commandId: 'tab.new', key: 'Mod+T', disabled: false },
  { commandId: 'app.settings', key: 'Mod+,', disabled: false },
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
    },
  };
}
