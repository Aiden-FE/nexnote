import { useEffect } from 'react';
import { useSettingsStore, subscribeSettingsChanges } from '../stores/settings-store';
import type { GlobalSettings, VaultSettings } from '@nexnote/shared';

const LS_THEME_KEY = 'nexnote:theme-preference';

/**
 * 应用启动时：
 * 1. 从主进程拉取全局设置（单一权威）
 * 2. 若 localStorage 中有旧主题设置且全局设置未显式覆盖，则迁移一次
 * 3. 应用主题、字体等视觉效果
 */
export function useSettingsBootstrap(): void {
  const global = useSettingsStore((s) => s.global);
  const loadGlobal = useSettingsStore((s) => s.loadGlobal);
  const setGlobal = useSettingsStore((s) => s.setGlobal);

  // 启动时加载
  useEffect(() => {
    void loadGlobal();
    const unsubscribe = subscribeSettingsChanges();
    return unsubscribe;
  }, [loadGlobal]);

  // 首次加载后：从 localStorage 迁移旧主题（仅一次）
  useEffect(() => {
    if (!global) return;
    try {
      const legacy = localStorage.getItem(LS_THEME_KEY);
      if (legacy && (legacy === 'light' || legacy === 'dark' || legacy === 'system')) {
        // 旧值非 system 且与默认不同 → 迁移
        if (legacy !== 'system') {
          void setGlobal({ appearance: { theme: legacy } });
        }
        localStorage.removeItem(LS_THEME_KEY);
      }
    } catch {
      /* localStorage 不可用忽略 */
    }
  }, [global, setGlobal]);

  // 应用全局视觉效果
  useEffect(() => {
    if (!global) return;
    applyGlobalAppearance(global);
  }, [global]);
}

/** 应用 vault 级设置效果（编辑器字号、自动保存等）。在编辑器视图内调用。 */
export function useVaultSettingsEffects(): { vault: VaultSettings | null } {
  const vault = useSettingsStore((s) => s.vault);
  const loadVault = useSettingsStore((s) => s.loadVault);

  useEffect(() => {
    void loadVault();
  }, [loadVault]);

  useEffect(() => {
    if (!vault) return;
    applyVaultStyles(vault);
  }, [vault]);

  return { vault };
}

function applyGlobalAppearance(settings: GlobalSettings): void {
  const root = document.documentElement;

  // 主题
  const pref = settings.appearance.theme;
  const prefersDark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = pref === 'system' ? (prefersDark ? 'dark' : 'light') : pref;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;

  // UI 字号
  root.style.fontSize = `${settings.appearance.uiFontSize}px`;

  // UI 字体
  root.style.setProperty('--font-ui', settings.appearance.uiFontFamily);
  root.style.setProperty('--font-mono', settings.appearance.editorFontFamily);
  root.style.setProperty('--editor-font-size', `${settings.appearance.editorFontSize}px`);

  // 语言（仅设置标签，实际 i18n 由独立模块处理）
  root.setAttribute('lang', settings.appearance.language);
}

function applyVaultStyles(settings: VaultSettings): void {
  const root = document.documentElement;
  // 代码主题
  root.setAttribute('data-code-theme', settings.editor.codeTheme);
}

export function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}
