import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  defaultGlobalSettings,
  mergeGlobalPatch,
  mergeVaultPatch,
  normalizeShortcut,
  type GlobalSettings,
  type GlobalSettingsPatch,
  type SettingSearchEntry,
  type ShortcutOverride,
  type VaultSettings,
  type VaultSettingsPatch,
} from '@nexnote/shared';

/**
 * 应用级全局设置持久化（userData/nexnote-settings.json）。
 * 单一权威：主进程持有完整数据；渲染层仅通过 IPC 拿到视图，
 * 绝不出现在 localStorage（避免双权威）。
 */
export class SettingsService {
  private data: GlobalSettings;
  private listeners: Set<(settings: GlobalSettings) => void> = new Set();

  constructor(private readonly filePath: string) {
    this.data = this.load();
  }

  onChange(listener: (settings: GlobalSettings) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private load(): GlobalSettings {
    try {
      if (!existsSync(this.filePath)) return defaultGlobalSettings();
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return normalizeStoredGlobal(parsed);
    } catch {
      return defaultGlobalSettings();
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.filePath);
    for (const listener of this.listeners) {
      try {
        listener(this.data);
      } catch {
        /* listener self-contained */
      }
    }
  }

  get(): Readonly<GlobalSettings> {
    return this.data;
  }

  update(patch: GlobalSettingsPatch): GlobalSettings {
    const sanitized: GlobalSettingsPatch = {
      ...(patch.appearance ? { appearance: patch.appearance } : {}),
      ...(patch.updates ? { updates: patch.updates } : {}),
      ...(patch.startup ? { startup: patch.startup } : {}),
      ...(patch.git ? { git: patch.git } : {}),
    };
    // 合并后再 normalize 一次，prune 未知子字段，防止 IPC payload 带的多余字段污染持久化。
    this.data = normalizeStoredGlobal(mergeGlobalPatch(this.data, sanitized));
    this.persist();
    return this.data;
  }

  setShortcuts(overrides: ShortcutOverride[]): ShortcutOverride[] {
    this.data = { ...this.data, shortcuts: normalizeShortcutOverrides(overrides) };
    this.persist();
    return this.data.shortcuts;
  }

  exportShortcutsJson(): string {
    return JSON.stringify(
      {
        app: 'nexnote',
        kind: 'shortcuts',
        version: 1,
        exportedAt: new Date().toISOString(),
        shortcuts: this.data.shortcuts,
      },
      null,
      2,
    );
  }

  importShortcutsJson(json: string): { imported: number; shortcuts: ShortcutOverride[] } {
    const candidates = parseShortcutBundle(json);
    const merged = normalizeShortcutOverrides([...this.data.shortcuts, ...candidates]);
    this.data = { ...this.data, shortcuts: merged };
    this.persist();
    return { imported: candidates.length, shortcuts: merged };
  }

  search(query: string): SettingSearchEntry[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return SEARCH_ENTRIES.filter((entry) =>
      `${entry.title} ${entry.id} ${entry.keywords.join(' ')}`.toLowerCase().includes(q),
    );
  }
}

export const SEARCH_ENTRIES: SettingSearchEntry[] = [
  {
    id: 'appearance.theme',
    sectionId: 'general',
    title: '主题',
    keywords: ['theme', 'dark', 'light', 'system', '暗色', '亮色', '系统'],
    scope: 'global',
  },
  {
    id: 'appearance.language',
    sectionId: 'general',
    title: '语言',
    keywords: ['language', 'locale', '中文', 'english'],
    scope: 'global',
  },
  {
    id: 'appearance.uiFontFamily',
    sectionId: 'general',
    title: 'UI 字体',
    keywords: ['font', 'ui', '字体'],
    scope: 'global',
  },
  {
    id: 'appearance.uiFontSize',
    sectionId: 'general',
    title: 'UI 字号',
    keywords: ['font', 'size', 'ui', '字号'],
    scope: 'global',
  },
  {
    id: 'appearance.editorFontFamily',
    sectionId: 'editor',
    title: '编辑器字体',
    keywords: ['font', 'editor', '字体', '编辑器'],
    scope: 'vault',
  },
  {
    id: 'appearance.editorFontSize',
    sectionId: 'editor',
    title: '编辑器字号',
    keywords: ['font', 'size', 'editor', '字号'],
    scope: 'vault',
  },
  {
    id: 'updates.checkOnLaunch',
    sectionId: 'general',
    title: '启动时检查更新',
    keywords: ['update', 'auto', '更新', '自动'],
    scope: 'global',
  },
  {
    id: 'updates.autoDownload',
    sectionId: 'general',
    title: '自动下载更新',
    keywords: ['update', 'download', '自动下载'],
    scope: 'global',
  },
  {
    id: 'updates.channel',
    sectionId: 'general',
    title: '更新通道',
    keywords: ['update', 'channel', 'stable', 'beta', 'alpha', '通道'],
    scope: 'global',
  },
  {
    id: 'startup.behavior',
    sectionId: 'general',
    title: '启动行为',
    keywords: ['startup', 'launch', '启动', '恢复', 'welcome', '特定'],
    scope: 'global',
  },
  {
    id: 'git.useSystemGit',
    sectionId: 'git',
    title: '使用系统 Git',
    keywords: ['git', 'system', 'binary', 'bundled', '系统'],
    scope: 'global',
  },
  {
    id: 'editor.autoSaveMs',
    sectionId: 'editor',
    title: '自动保存间隔',
    keywords: ['autosave', 'save', 'debounce', '自动保存'],
    scope: 'vault',
  },
  {
    id: 'editor.defaultPageTemplate',
    sectionId: 'editor',
    title: '默认新页面模板',
    keywords: ['template', '模板', '默认', 'new'],
    scope: 'vault',
  },
  {
    id: 'editor.bindFileNameToTitle',
    sectionId: 'editor',
    title: '文件名与标题联动',
    keywords: ['title', 'bind', 'h1', '标题', '联动'],
    scope: 'vault',
  },
  {
    id: 'editor.vimMode',
    sectionId: 'editor',
    title: 'Vim 模式',
    keywords: ['vim', '编辑器', '模态'],
    scope: 'vault',
  },
  {
    id: 'editor.codeTheme',
    sectionId: 'editor',
    title: '代码块主题',
    keywords: ['code', 'theme', 'syntax', '代码', '高亮'],
    scope: 'vault',
  },
  {
    id: 'git.autoCommit',
    sectionId: 'git',
    title: '自动提交',
    keywords: ['git', 'auto', 'commit', '自动提交'],
    scope: 'vault',
  },
  {
    id: 'git.autoCommitIntervalMs',
    sectionId: 'git',
    title: '自动提交间隔',
    keywords: ['git', 'interval', '间隔'],
    scope: 'vault',
  },
  {
    id: 'git.commitMessageTemplate',
    sectionId: 'git',
    title: '自动提交消息模板',
    keywords: ['git', 'message', 'template', '提交', '模板'],
    scope: 'vault',
  },
  {
    id: 'git.defaultBranch',
    sectionId: 'git',
    title: '默认分支名',
    keywords: ['git', 'branch', 'default', '分支'],
    scope: 'vault',
  },
  {
    id: 'shortcuts.list',
    sectionId: 'shortcuts',
    title: '快捷键',
    keywords: ['keyboard', 'shortcut', '热键', '快捷键'],
    scope: 'global',
  },
  {
    id: 'shortcuts.import',
    sectionId: 'shortcuts',
    title: '导入快捷键',
    keywords: ['import', '导入'],
    scope: 'global',
  },
  {
    id: 'shortcuts.export',
    sectionId: 'shortcuts',
    title: '导出快捷键',
    keywords: ['export', '导出'],
    scope: 'global',
  },
  {
    id: 'ai.section',
    sectionId: 'ai',
    title: 'AI 设置',
    keywords: ['ai', 'model', 'api', '人工智能', '模型', 'profile'],
    scope: 'domain',
  },
  {
    id: 'plugins.section',
    sectionId: 'plugins',
    title: '插件',
    keywords: ['plugin', 'extension', '插件'],
    scope: 'domain',
  },
  {
    id: 'skills.section',
    sectionId: 'skills',
    title: '检索 Skill',
    keywords: ['skill', '检索', '召回'],
    scope: 'domain',
  },
  {
    id: 'about.version',
    sectionId: 'about',
    title: '版本信息',
    keywords: ['version', 'about', '版本', '关于'],
    scope: 'global',
  },
];

export function mergeVaultSettings(base: VaultSettings, patch: VaultSettingsPatch): VaultSettings {
  return mergeVaultPatch(base, patch);
}

export function normalizeStoredGlobal(raw: unknown): GlobalSettings {
  const base = defaultGlobalSettings();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return base;
  const value = raw as Record<string, unknown>;
  const appearance = asRecord(value.appearance);
  const updates = asRecord(value.updates);
  const startup = asRecord(value.startup);
  const git = asRecord(value.git);
  return {
    version: 1,
    appearance: {
      theme:
        appearance.theme === 'light' || appearance.theme === 'dark'
          ? appearance.theme
          : appearance.theme === 'system'
            ? appearance.theme
            : base.appearance.theme,
      language:
        appearance.language === 'en-US' || appearance.language === 'zh-CN'
          ? appearance.language
          : base.appearance.language,
      uiFontFamily:
        typeof appearance.uiFontFamily === 'string' && appearance.uiFontFamily.trim()
          ? appearance.uiFontFamily
          : base.appearance.uiFontFamily,
      editorFontFamily:
        typeof appearance.editorFontFamily === 'string' && appearance.editorFontFamily.trim()
          ? appearance.editorFontFamily
          : base.appearance.editorFontFamily,
      uiFontSize: clampInt(appearance.uiFontSize, 10, 24, base.appearance.uiFontSize),
      editorFontSize: clampInt(appearance.editorFontSize, 10, 32, base.appearance.editorFontSize),
    },
    updates: {
      checkOnLaunch: hasKey(updates, 'checkOnLaunch')
        ? updates.checkOnLaunch === true
        : base.updates.checkOnLaunch,
      autoDownload: hasKey(updates, 'autoDownload')
        ? updates.autoDownload === true
        : base.updates.autoDownload,
      channel:
        updates.channel === 'beta' || updates.channel === 'alpha'
          ? updates.channel
          : base.updates.channel,
    },
    startup: {
      behavior:
        startup.behavior === 'welcome' || startup.behavior === 'specific-vault'
          ? startup.behavior
          : base.startup.behavior,
      specificVaultPath:
        typeof startup.specificVaultPath === 'string' && startup.specificVaultPath.trim()
          ? startup.specificVaultPath
          : base.startup.specificVaultPath,
    },
    git: {
      useSystemGit: hasKey(git, 'useSystemGit') ? git.useSystemGit === true : base.git.useSystemGit,
    },
    shortcuts: Array.isArray(value.shortcuts)
      ? // DEV-022：旧设置文件缺少新登记的默认命令时按默认键补齐（用户条目覆盖同名默认），
        // 保证快捷键设置分区始终展示完整绑定。
        normalizeShortcutOverrides([...base.shortcuts, ...value.shortcuts])
      : base.shortcuts,
  };
}

function normalizeShortcutOverrides(list: unknown[]): ShortcutOverride[] {
  const map = new Map<string, ShortcutOverride>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const commandId = String(entry.commandId ?? '').trim();
    if (!commandId) continue;
    const rawKey = String(entry.key ?? '');
    const disabled = entry.disabled === true;
    const normalized = normalizeShortcut(rawKey);
    if (!disabled && !normalized) continue;
    map.set(commandId, {
      commandId,
      key: disabled ? '' : normalized,
      disabled,
    });
  }
  return [...map.values()].sort((a, b) => a.commandId.localeCompare(b.commandId));
}

function parseShortcutBundle(json: string): ShortcutOverride[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json || '');
  } catch {
    return [];
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { kind?: string }).kind !== 'shortcuts' ||
    !Array.isArray((parsed as { shortcuts?: unknown }).shortcuts)
  ) {
    return [];
  }
  const result: ShortcutOverride[] = [];
  const seen = new Set<string>();
  for (const item of (parsed as { shortcuts: ShortcutOverride[] }).shortcuts) {
    const commandId = String((item as { commandId?: unknown }).commandId ?? '').trim();
    if (!commandId || seen.has(commandId)) continue;
    const rawKey = String((item as { key?: unknown }).key ?? '');
    const disabled = (item as { disabled?: unknown }).disabled === true;
    const normalized = normalizeShortcut(rawKey);
    if (!disabled && !normalized) continue;
    seen.add(commandId);
    result.push({ commandId, key: disabled ? '' : normalized, disabled });
  }
  return result;
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasKey(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
