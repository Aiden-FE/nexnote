import { create } from 'zustand';
import { invoke, onEvent } from '../lib/ipc';
import type {
  GlobalSettings,
  GlobalSettingsPatch,
  VaultSettings,
  VaultSettingsPatch,
  ShortcutOverride,
  SettingSearchEntry,
} from '@nexnote/shared';

interface SettingsState {
  global: GlobalSettings | null;
  vault: VaultSettings | null;
  loading: boolean;
  error: string | null;

  // Actions
  loadGlobal(): Promise<void>;
  loadVault(): Promise<void>;
  setGlobal(patch: GlobalSettingsPatch): Promise<void>;
  setVault(patch: VaultSettingsPatch): Promise<void>;
  setShortcuts(shortcuts: ShortcutOverride[]): Promise<ShortcutOverride[]>;
  importShortcuts(json: string): Promise<{ imported: number; shortcuts: ShortcutOverride[] }>;
  exportShortcuts(): Promise<{ json: string; count: number }>;
  search(query: string): Promise<SettingSearchEntry[]>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  global: null,
  vault: null,
  loading: false,
  error: null,

  async loadGlobal() {
    if (get().global) return; // already loaded
    set({ loading: true, error: null });
    try {
      const global = await invoke('settings:getAll');
      set({ global, loading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },

  async loadVault() {
    set({ loading: true, error: null });
    try {
      const vault = await invoke('settings:getVault');
      set({ vault, loading: false });
    } catch (e) {
      set({ vault: null, error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },

  async setGlobal(patch) {
    try {
      const updated = await invoke('settings:setGlobal', { patch });
      set({ global: updated });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  async setVault(patch) {
    try {
      const updated = await invoke('settings:setVault', { patch });
      set({ vault: updated });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  async setShortcuts(shortcuts) {
    try {
      const updated = await invoke('settings:setShortcuts', { shortcuts });
      set((state) => ({
        global: state.global ? { ...state.global, shortcuts: updated } : state.global,
      }));
      return updated;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  async importShortcuts(json) {
    const result = await invoke('settings:importShortcuts', { json });
    set((state) => ({
      global: state.global ? { ...state.global, shortcuts: result.shortcuts } : state.global,
    }));
    return result;
  },

  async exportShortcuts() {
    return invoke('settings:exportShortcuts');
  },

  async search(query) {
    return invoke('settings:search', { query });
  },
}));

/** 订阅主进程推送的设置变化（跨窗口同步预留）。 */
export function subscribeSettingsChanges(): () => void {
  return onEvent('settings:changed', (payload) => {
    if (payload.global) {
      useSettingsStore.setState({ global: payload.global });
    }
    if (payload.vault) {
      useSettingsStore.setState({ vault: payload.vault });
    }
  });
}
