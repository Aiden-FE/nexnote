import type { Result } from '../result';
import type {
  GlobalSettings,
  GlobalSettingsPatch,
  SettingSearchEntry,
  ShortcutOverride,
  VaultSettings,
  VaultSettingsPatch,
} from '../../types/settings';

export const SETTINGS_CHANNELS = [
  'settings:getAll',
  'settings:getVault',
  'settings:setGlobal',
  'settings:setVault',
  'settings:setShortcuts',
  'settings:exportShortcuts',
  'settings:importShortcuts',
  'settings:search',
  'settings:pickImportFile',
  'settings:saveExportFile',
] as const;

export interface SettingsChannelMap {
  'settings:getAll': { request: void; response: Result<GlobalSettings> };
  'settings:getVault': { request: void; response: Result<VaultSettings> };
  'settings:setGlobal': {
    request: { patch: GlobalSettingsPatch };
    response: Result<GlobalSettings>;
  };
  'settings:setVault': {
    request: { patch: VaultSettingsPatch };
    response: Result<VaultSettings>;
  };
  'settings:setShortcuts': {
    request: { shortcuts: ShortcutOverride[] };
    response: Result<ShortcutOverride[]>;
  };
  'settings:exportShortcuts': { request: void; response: Result<{ json: string; count: number }> };
  'settings:importShortcuts': {
    request: { json: string };
    response: Result<{ imported: number; shortcuts: ShortcutOverride[] }>;
  };
  'settings:search': { request: { query: string }; response: Result<SettingSearchEntry[]> };
  /** Native file chooser: renderer never holds a stale File object or filesystem path. */
  'settings:pickImportFile': { request: void; response: Result<string | null> };
  /** Native save dialog/write lifecycle handled in main. */
  'settings:saveExportFile': {
    request: { suggestedName: string; contents: string };
    response: Result<string | null>;
  };
}
