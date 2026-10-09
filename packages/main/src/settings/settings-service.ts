import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { app } from 'electron';
import {
  CATALOGS,
  defaultGlobalSettings,
  mergeGlobalPatch,
  translate,
  mergeVaultPatch,
  normalizeShortcut,
  uiLanguageFromSystem,
  type AppLanguage,
  type GlobalSettings,
  type GlobalSettingsPatch,
  type NetworkProxyConfig,
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
/** 系统首选语言列表；Electron 不可用时（单测）回退 undefined → en-US 之外的默认推导。 */
function systemLanguages(): string[] {
  try {
    return app.getPreferredSystemLanguages();
  } catch {
    return [];
  }
}

export class SettingsService {
  private data: GlobalSettings;
  private listeners: Set<(settings: GlobalSettings) => void> = new Set();

  constructor(
    private readonly filePath: string,
    /** 首次生成默认设置时的界面语言；未提供时由系统语言推导（ADR-0023）。 */
    initialLanguage?: AppLanguage,
  ) {
    this.initialLanguage = initialLanguage ?? uiLanguageFromSystem(systemLanguages());
    this.data = this.load();
  }

  private readonly initialLanguage: AppLanguage;

  private defaults(): GlobalSettings {
    return defaultGlobalSettings(this.initialLanguage);
  }

  onChange(listener: (settings: GlobalSettings) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private load(): GlobalSettings {
    try {
      if (!existsSync(this.filePath)) return this.defaults();
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return normalizeStoredGlobal(parsed, this.initialLanguage);
    } catch {
      return this.defaults();
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
      ...(patch.network ? { network: patch.network } : {}),
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
    // 主进程不感知界面语言、不把标题拼进数据；但需保留中英关键词互通
    // （ADR-0023 架构决策③：按当前界面语言索引 + 保留中英关键词互通）。
    // 因此检索文本由「id + 关键词 + titleKey 在两种语言下的成文」构成，
    // 中文标题、英文标题与关键词都能命中。
    return SEARCH_ENTRIES.filter((entry) => searchableText(entry).includes(q));
  }
}

function searchableText(entry: SettingSearchEntry): string {
  const zh = translate(CATALOGS['zh-CN'], entry.titleKey, 'zh-CN');
  const en = translate(CATALOGS['en-US'], entry.titleKey, 'en-US');
  return `${entry.id} ${entry.keywords.join(' ')} ${zh} ${en}`.toLowerCase();
}

export const SEARCH_ENTRIES: SettingSearchEntry[] = [
  {
    id: 'appearance.theme',
    sectionId: 'general',
    titleKey: 'settings.search.appearance.theme',
    keywords: ['theme', 'dark', 'light', 'system', '暗色', '亮色', '系统'],
    scope: 'global',
  },
  {
    id: 'appearance.language',
    sectionId: 'general',
    titleKey: 'settings.search.appearance.language',
    keywords: ['language', 'locale', '中文', 'english'],
    scope: 'global',
  },
  {
    id: 'appearance.uiFontFamily',
    sectionId: 'general',
    titleKey: 'settings.search.appearance.uiFontFamily',
    keywords: ['font', 'ui', '字体'],
    scope: 'global',
  },
  {
    id: 'appearance.uiFontSize',
    sectionId: 'general',
    titleKey: 'settings.search.appearance.uiFontSize',
    keywords: ['font', 'size', 'ui', '字号'],
    scope: 'global',
  },
  {
    id: 'appearance.editorFontFamily',
    sectionId: 'general',
    titleKey: 'settings.search.appearance.editorFontFamily',
    keywords: ['font', 'editor', '字体', '编辑器'],
    scope: 'global',
  },
  {
    id: 'appearance.editorFontSize',
    sectionId: 'general',
    titleKey: 'settings.search.appearance.editorFontSize',
    keywords: ['font', 'size', 'editor', '字号'],
    scope: 'global',
  },
  {
    id: 'updates.checkOnLaunch',
    sectionId: 'updates',
    titleKey: 'settings.search.updates.checkOnLaunch',
    keywords: ['update', 'auto', '更新', '自动'],
    scope: 'global',
  },
  {
    id: 'updates.autoDownload',
    sectionId: 'updates',
    titleKey: 'settings.search.updates.autoDownload',
    keywords: ['update', 'download', '自动下载'],
    scope: 'global',
  },
  {
    id: 'updates.channel',
    sectionId: 'updates',
    titleKey: 'settings.search.updates.channel',
    keywords: ['update', 'channel', 'stable', 'beta', 'alpha', '通道'],
    scope: 'global',
  },
  {
    id: 'startup.behavior',
    sectionId: 'general',
    titleKey: 'settings.search.startup.behavior',
    keywords: ['startup', 'launch', '启动', '恢复', 'welcome', '特定'],
    scope: 'global',
  },
  {
    id: 'git.useSystemGit',
    sectionId: 'git',
    titleKey: 'settings.search.git.useSystemGit',
    keywords: ['git', 'system', 'binary', 'bundled', '系统'],
    scope: 'global',
  },
  {
    id: 'editor.autoSaveMs',
    sectionId: 'editor',
    titleKey: 'settings.search.editor.autoSaveMs',
    keywords: ['autosave', 'save', 'debounce', '自动保存'],
    scope: 'vault',
  },
  {
    id: 'editor.defaultPageTemplate',
    sectionId: 'editor',
    titleKey: 'settings.search.editor.defaultPageTemplate',
    keywords: ['template', '模板', '默认', 'new'],
    scope: 'vault',
  },
  {
    id: 'editor.bindFileNameToTitle',
    sectionId: 'editor',
    titleKey: 'settings.search.editor.bindFileNameToTitle',
    keywords: ['title', 'bind', 'h1', '标题', '联动'],
    scope: 'vault',
  },
  {
    id: 'editor.vimMode',
    sectionId: 'editor',
    titleKey: 'settings.search.editor.vimMode',
    keywords: ['vim', '编辑器', '模态'],
    scope: 'vault',
  },
  {
    id: 'editor.codeTheme',
    sectionId: 'editor',
    titleKey: 'settings.search.editor.codeTheme',
    keywords: ['code', 'theme', 'syntax', '代码', '高亮'],
    scope: 'vault',
  },
  {
    id: 'git.autoCommit',
    sectionId: 'git',
    titleKey: 'settings.search.git.autoCommit',
    keywords: ['git', 'auto', 'commit', '自动提交'],
    scope: 'vault',
  },
  {
    id: 'git.autoCommitIntervalMs',
    sectionId: 'git',
    titleKey: 'settings.search.git.autoCommitIntervalMs',
    keywords: ['git', 'interval', '间隔'],
    scope: 'vault',
  },
  {
    id: 'git.commitMessageTemplate',
    sectionId: 'git',
    titleKey: 'settings.search.git.commitMessageTemplate',
    keywords: ['git', 'message', 'template', '提交', '模板'],
    scope: 'vault',
  },
  {
    id: 'git.defaultBranch',
    sectionId: 'git',
    titleKey: 'settings.search.git.defaultBranch',
    keywords: ['git', 'branch', 'default', '分支'],
    scope: 'vault',
  },
  {
    id: 'shortcuts.list',
    sectionId: 'shortcuts',
    titleKey: 'settings.search.shortcuts.list',
    keywords: ['keyboard', 'shortcut', '热键', '快捷键'],
    scope: 'global',
  },
  {
    id: 'shortcuts.import',
    sectionId: 'shortcuts',
    titleKey: 'settings.search.shortcuts.import',
    keywords: ['import', '导入'],
    scope: 'global',
  },
  {
    id: 'shortcuts.export',
    sectionId: 'shortcuts',
    titleKey: 'settings.search.shortcuts.export',
    keywords: ['export', '导出'],
    scope: 'global',
  },
  {
    id: 'ai.section',
    sectionId: 'ai',
    titleKey: 'settings.search.ai.section',
    keywords: ['ai', 'model', 'api', '人工智能', '模型', 'profile'],
    scope: 'domain',
  },
  {
    id: 'plugins.section',
    sectionId: 'plugins',
    titleKey: 'settings.search.plugins.section',
    keywords: ['plugin', 'extension', '插件'],
    scope: 'domain',
  },
  {
    id: 'skills.section',
    sectionId: 'skills',
    titleKey: 'settings.search.skills.section',
    keywords: ['skill', '检索', '召回'],
    scope: 'domain',
  },
  {
    id: 'about.version',
    sectionId: 'about',
    titleKey: 'settings.search.about.version',
    keywords: ['version', 'about', '版本', '关于'],
    scope: 'global',
  },
  {
    id: 'network.mode',
    sectionId: 'network',
    titleKey: 'settings.search.network.mode',
    keywords: ['network', 'proxy', '代理', 'system', '跟随系统'],
    scope: 'global',
  },
  {
    id: 'network.applyToGit',
    sectionId: 'network',
    titleKey: 'settings.search.network.applyToGit',
    keywords: ['network', 'git', 'proxy', '代理'],
    scope: 'global',
  },
  {
    id: 'network.aiProxy',
    sectionId: 'network',
    titleKey: 'settings.search.network.aiProxy',
    keywords: ['network', 'ai', 'proxy', '独立', '代理'],
    scope: 'global',
  },
  {
    id: 'network.gitProxy',
    sectionId: 'network',
    titleKey: 'settings.search.network.gitProxy',
    keywords: ['network', 'git', 'proxy', '独立', '代理'],
    scope: 'global',
  },
  {
    id: 'network.host',
    sectionId: 'network',
    titleKey: 'settings.search.network.host',
    keywords: ['network', 'host', 'port', 'proxy', '主机', '端口'],
    scope: 'global',
  },
  {
    id: 'network.bypass',
    sectionId: 'network',
    titleKey: 'settings.search.network.bypass',
    keywords: ['network', 'bypass', 'proxy', '绕过', '直连'],
    scope: 'global',
  },
  {
    id: 'ai.translationTargetLanguage',
    sectionId: 'general',
    titleKey: 'settings.search.ai.translationTargetLanguage',
    keywords: ['ai', 'translation', '翻译', '目标语言', '语言'],
    scope: 'domain',
  },
  {
    id: 'git.binaryUntrack',
    sectionId: 'git',
    titleKey: 'settings.search.git.binaryUntrack',
    keywords: ['git', 'binary', 'docx', 'xlsx', 'xmind', 'gitignore', '跟踪'],
    scope: 'vault',
  },
  {
    id: 'binary.maxConcurrentTabs',
    sectionId: 'editor',
    titleKey: 'settings.search.binary.maxConcurrentTabs',
    keywords: ['binary', 'docx', 'xlsx', 'xmind', 'tab', '并发', '编辑器', 'DEV-074'],
    scope: 'vault',
  },
];

export function mergeVaultSettings(base: VaultSettings, patch: VaultSettingsPatch): VaultSettings {
  return mergeVaultPatch(base, patch);
}

export function normalizeStoredGlobal(
  raw: unknown,
  defaultLanguage: GlobalSettings['appearance']['language'] = 'zh-CN',
): GlobalSettings {
  const base = defaultGlobalSettings(defaultLanguage);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return base;
  const value = raw as Record<string, unknown>;
  const appearance = asRecord(value.appearance);
  const updates = asRecord(value.updates);
  const startup = asRecord(value.startup);
  const git = asRecord(value.git);
  const network = asRecord(value.network);
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
    network: {
      mode:
        network.mode === 'http' ||
        network.mode === 'https' ||
        network.mode === 'socks5' ||
        network.mode === 'off'
          ? network.mode
          : base.network.mode,
      host:
        typeof network.host === 'string' && network.host.trim()
          ? network.host.trim()
          : base.network.host,
      port:
        typeof network.port === 'number' &&
        Number.isFinite(network.port) &&
        network.port > 0 &&
        network.port <= 65535
          ? Math.round(network.port)
          : base.network.port,
      username:
        typeof network.username === 'string' && network.username.trim()
          ? network.username.trim()
          : base.network.username,
      password:
        typeof network.password === 'string' && network.password
          ? network.password
          : base.network.password,
      bypass: Array.isArray(network.bypass)
        ? network.bypass.filter(
            (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
          )
        : base.network.bypass,
      applyToAi: hasKey(network, 'applyToAi') ? network.applyToAi === true : base.network.applyToAi,
      applyToGit: hasKey(network, 'applyToGit')
        ? network.applyToGit === true
        : base.network.applyToGit,
      aiProxy: normalizeStoredProxyConfig(network.aiProxy),
      gitProxy: normalizeStoredProxyConfig(network.gitProxy),
    },
    shortcuts: Array.isArray(value.shortcuts)
      ? // DEV-022：旧设置文件缺少新登记的默认命令时按默认键补齐（用户条目覆盖同名默认），
        // 保证快捷键设置分区始终展示完整绑定。
        normalizeShortcutOverrides([...base.shortcuts, ...value.shortcuts])
      : base.shortcuts,
  };
}

function normalizeStoredProxyConfig(raw: unknown): NetworkProxyConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const config = raw as Record<string, unknown>;
  return {
    mode:
      config.mode === 'http' ||
      config.mode === 'https' ||
      config.mode === 'socks5' ||
      config.mode === 'off'
        ? config.mode
        : 'system',
    host: typeof config.host === 'string' && config.host.trim() ? config.host.trim() : null,
    port:
      typeof config.port === 'number' &&
      Number.isFinite(config.port) &&
      config.port > 0 &&
      config.port <= 65535
        ? Math.round(config.port)
        : null,
    username:
      typeof config.username === 'string' && config.username.trim() ? config.username.trim() : null,
    password: typeof config.password === 'string' && config.password ? config.password : null,
    bypass: Array.isArray(config.bypass)
      ? config.bypass.filter(
          (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
        )
      : [],
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
