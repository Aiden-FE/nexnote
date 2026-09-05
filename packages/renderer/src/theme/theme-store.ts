import { create } from 'zustand';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'nexnote:theme-preference';

function readStoredPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    /* localStorage 不可用时静默回退 */
  }
  return 'system';
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference(pref: ThemePreference): void;
  /** system 主题下跟随系统变化时由 ThemeProvider 调用 */
  __resolveSystem(): void;
}

function resolve(pref: ThemePreference): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: readStoredPreference(),
  resolved: resolve(readStoredPreference()),
  setPreference(pref) {
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      /* ignore */
    }
    set(() => ({ preference: pref, resolved: resolve(pref) }));
  },
  __resolveSystem() {
    set((s) => (s.preference === 'system' ? { resolved: resolve('system') } : s));
  },
}));
