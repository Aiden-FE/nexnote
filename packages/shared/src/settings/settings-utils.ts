import type {
  GlobalSettings,
  GlobalSettingsPatch,
  VaultSettings,
  VaultSettingsPatch,
} from '../types/settings';

/**
 * Deep-merge a partial patch into settings, discarding explicit `undefined`
 * so structured-cloned IPC payloads never carry present-but-undefined fields.
 * Runtime validation already rejected unknown fields; this only sanitizes values.
 */
export function mergeGlobalPatch(
  base: GlobalSettings,
  patch: GlobalSettingsPatch,
): GlobalSettings {
  const appearance = patch.appearance
    ? { ...base.appearance, ...patch.appearance }
    : base.appearance;
  const updates = patch.updates ? { ...base.updates, ...patch.updates } : base.updates;
  const startup = patch.startup ? { ...base.startup, ...patch.startup } : base.startup;
  const git = patch.git ? { ...base.git, ...patch.git } : base.git;
  const result: GlobalSettings = {
    ...base,
    appearance: pruneUndefined(appearance),
    updates: pruneUndefined(updates),
    startup: pruneUndefined(startup),
    git: pruneUndefined(git),
  };
  // Re-normalize anything the caller may have typed loosely before persisting.
  return {
    ...result,
    appearance: {
      ...result.appearance,
      theme: isTheme(result.appearance.theme)
        ? result.appearance.theme
        : base.appearance.theme,
      language:
        result.appearance.language === 'en-US' || result.appearance.language === 'zh-CN'
          ? result.appearance.language
          : base.appearance.language,
      uiFontSize: clampInt(result.appearance.uiFontSize, 10, 24, base.appearance.uiFontSize),
      editorFontSize: clampInt(
        result.appearance.editorFontSize,
        10,
        32,
        base.appearance.editorFontSize,
      ),
    },
    updates: {
      ...result.updates,
      channel:
        result.updates.channel === 'beta' || result.updates.channel === 'alpha'
          ? result.updates.channel
          : 'stable',
    },
    startup: {
      ...result.startup,
      behavior:
        result.startup.behavior === 'welcome' || result.startup.behavior === 'specific-vault'
          ? result.startup.behavior
          : 'restore',
      specificVaultPath:
        typeof result.startup.specificVaultPath === 'string' &&
        result.startup.specificVaultPath.trim()
          ? result.startup.specificVaultPath
          : null,
    },
  };
}

export function mergeVaultPatch(base: VaultSettings, patch: VaultSettingsPatch): VaultSettings {
  const editor = patch.editor ? { ...base.editor, ...patch.editor } : base.editor;
  const git = patch.git ? { ...base.git, ...patch.git } : base.git;
  const result: VaultSettings = { editor: pruneUndefined(editor), git: pruneUndefined(git) };
  return {
    editor: {
      ...result.editor,
      autoSaveMs: clampInt(result.editor.autoSaveMs, 100, 10_000, base.editor.autoSaveMs),
      codeTheme: isCodeTheme(result.editor.codeTheme)
        ? result.editor.codeTheme
        : base.editor.codeTheme,
    },
    git: {
      ...result.git,
      autoCommitIntervalMs: clampInt(
        result.git.autoCommitIntervalMs,
        2_000,
        10 * 60_000,
        base.git.autoCommitIntervalMs,
      ),
      defaultBranch: sanitizeBranchName(result.git.defaultBranch)
        ? result.git.defaultBranch
        : base.git.defaultBranch,
    },
  };
}

/** Canonical portable accelerator, glyphs/aliases compare equal and modifiers are ordered. */
export function normalizeShortcut(spec: string): string {
  const withoutAnnotation = (spec || '').replace(/（.*?）|\(.*?\)|（[^）]*）/g, '');
  // 展开字形拼接写法：⌘⇧F → Mod + Shift + F
  const expanded = withoutAnnotation.replace(/[⌘⌃⌥⇧]/g, (glyph) => {
    const map: Record<string, string> = {
      '⌘': 'Mod + ',
      '⌃': 'Ctrl + ',
      '⌥': 'Alt + ',
      '⇧': 'Shift + ',
    };
    return map[glyph] ?? '';
  });
  const parts = expanded
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => platformModifierKey(part))
    .filter((part): part is string => part !== null);
  if (parts.length === 0) return '';
  const order = ['Mod', 'Ctrl', 'Alt', 'Shift'];
  const sorted = [...parts].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b);
  });
  return sorted.join('+');
}

function platformModifierKey(part: string): string | null {
  const key = part.toLowerCase();
  if (key === 'cmd' || key === 'meta' || key === 'command') return 'Mod';
  if (key === 'control') return 'Ctrl';
  if (key === 'option' || key === 'opt') return 'Alt';
  if (key === '⌘') return 'Mod';
  if (key === '⌃' || key === '^') return 'Ctrl';
  if (key === '⌥' || key === '⌫') return 'Alt';
  if (key === '⇧') return 'Shift';
  if (key === 'mod' || key === 'ctrl' || key === 'alt' || key === 'shift') {
    return key.charAt(0).toUpperCase() + key.slice(1);
  }
  const plain = key.replace(/^[⌘⌃⌥⇧]+/, '');
  if (!plain) return null;
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

function pruneUndefined<T extends Record<string, unknown>>(input: T): T {
  const clean = { ...input };
  for (const key of Object.keys(clean)) {
    if (clean[key as keyof T] === undefined) {
      delete clean[key as keyof T];
    }
  }
  return clean;
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

function isTheme(value: unknown): value is GlobalSettings['appearance']['theme'] {
  return value === 'light' || value === 'dark' || value === 'system';
}

function isCodeTheme(value: unknown): value is VaultSettings['editor']['codeTheme'] {
  return value === 'github' || value === 'dracula' || value === 'nord';
}

function sanitizeBranchName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed !== value) return false;
  if (trimmed.includes('..')) return false;
  if (trimmed.startsWith('/') || trimmed.endsWith('/') || trimmed.endsWith('.')) return false;
  for (const char of trimmed) {
    if (DISALLOWED_BRANCH_CHARS.has(char)) return false;
  }
  return true;
}

const DISALLOWED_BRANCH_CHARS: ReadonlySet<string> = new Set([
  '\u0000',
  '\u0001',
  '\u0002',
  '\u0003',
  '\u0004',
  '\u0005',
  '\u0006',
  '\u0007',
  '\b',
  '\t',
  '\n',
  '\u000b',
  '\f',
  '\r',
  '\u000e',
  '\u000f',
  '\u0010',
  '\u0011',
  '\u0012',
  '\u0013',
  '\u0014',
  '\u0015',
  '\u0016',
  '\u0017',
  '\u0018',
  '\u0019',
  '\u001a',
  '\u001b',
  '\u001c',
  '\u001d',
  '\u001e',
  '\u001f',
  '\u007f',
  ' ',
  '~',
  '^',
  ':',
  '?',
  '*',
  '[',
  ']',
  '\\',
]);