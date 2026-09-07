import { ok, err } from '@nexnote/shared';
import type {
  GlobalSettings,
  Result,
  ShortcutOverride,
  VaultSettings,
} from '@nexnote/shared';
import { readVaultSettings, saveVaultSettings } from '../vault/vault-manager';
import type { IpcRegistrar } from './registrar';

/** settings:* 命名空间 handler。单一权威：SettingsService（全局）+ vault config（vault 设置）。 */
export function registerSettingsHandlers(registrar: IpcRegistrar): void {
  registrar.register('settings:getAll', async (_payload, services): Promise<Result<GlobalSettings>> => {
    return ok(services.settings.get());
  });

  registrar.register('settings:getVault', async (_payload, services): Promise<Result<VaultSettings>> => {
    const root = services.vaultSession.getCurrent()?.root;
    if (!root) return err('当前未打开 vault', 'NO_VAULT');
    const settings = await readVaultSettings(root);
    return ok(settings);
  });

  registrar.register('settings:setGlobal', async (payload, services): Promise<Result<GlobalSettings>> => {
    const updated = services.settings.update(payload.patch);
    return ok(updated);
  });

  registrar.register('settings:setVault', async (payload, services): Promise<Result<VaultSettings>> => {
    const root = services.vaultSession.getCurrent()?.root;
    if (!root) return err('当前未打开 vault', 'NO_VAULT');
    const updated = await saveVaultSettings(root, payload.patch);
    return ok(updated);
  });

  registrar.register(
    'settings:setShortcuts',
    async (payload, services): Promise<Result<ShortcutOverride[]>> => {
      const shortcuts = services.settings.setShortcuts(payload.shortcuts);
      return ok(shortcuts);
    },
  );

  registrar.register(
    'settings:exportShortcuts',
    async (_payload, services): Promise<Result<{ json: string; count: number }>> => {
      const json = services.settings.exportShortcutsJson();
      const count = services.settings.get().shortcuts.length;
      return ok({ json, count });
    },
  );

  registrar.register(
    'settings:importShortcuts',
    async (payload, services): Promise<Result<{ imported: number; shortcuts: ShortcutOverride[] }>> => {
      const result = services.settings.importShortcutsJson(payload.json);
      return ok(result);
    },
  );

  registrar.register('settings:search', async (payload, services) => {
    return ok(services.settings.search(payload.query));
  });

  registrar.register('settings:pickImportFile', async (_payload, services): Promise<Result<string | null>> => {
    const filePath = await services.dialogs.pickFile([
      { name: 'NexNote 快捷键', extensions: ['json'] },
      { name: '所有文件', extensions: ['*'] },
    ]);
    if (!filePath) return ok(null);
    // 主进程读完文件内容，把字符串回传；渲染层绝不直接访问文件系统。
    const { readFileSync } = await import('node:fs');
    try {
      const contents = readFileSync(filePath, 'utf8');
      return ok(contents);
    } catch {
      return err('无法读取文件', 'FILE_READ_FAILED');
    }
  });

  registrar.register('settings:saveExportFile', async (payload): Promise<Result<string | null>> => {
    const { dialog } = await import('electron');
    const { writeFile } = await import('node:fs/promises');
    const result = await dialog.showSaveDialog({
      title: '导出快捷键',
      defaultPath: payload.suggestedName || 'nexnote-shortcuts.json',
      filters: [
        { name: 'NexNote 快捷键', extensions: ['json'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) return ok(null);
    try {
      await writeFile(result.filePath, payload.contents, 'utf8');
      return ok(result.filePath);
    } catch {
      return err('无法写入文件', 'FILE_WRITE_FAILED');
    }
  });
}
