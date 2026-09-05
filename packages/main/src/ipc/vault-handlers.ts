import { ok, type Result } from '@nexnote/shared';
import type { IpcRegistrar } from './registrar';
import { createVault, readVaultConfig, saveVaultLayout, validateVaultRoot } from '../vault/vault-manager';
import type { RecentVaultEntry, VaultInfo, VaultLayout, VaultStartupState } from '@nexnote/shared';

/** 启动状态查询只做一次恢复（懒执行，避免在模块加载期做 IO）。 */
let restoreAttempted = false;

export function registerVaultHandlers(registrar: IpcRegistrar): void {
  registrar.register('vault:getState', async (_payload, services): Promise<Result<VaultStartupState>> => {
    let current = services.vaultSession.getCurrent();
    if (!current && !restoreAttempted) {
      restoreAttempted = true;
      current = await services.vaultSession.restoreLast();
    }
    if (current) return ok({ mode: 'ready', vault: current });
    return ok({ mode: 'onboarding', recent: services.appStore.existingRecents() });
  });

  registrar.register('vault:pickDirectory', async (_payload, services): Promise<Result<string | null>> => {
    return ok(await services.dialogs.pickDirectory());
  });

  registrar.register(
    'vault:create',
    async ({ parentDir, name }, services): Promise<Result<VaultInfo>> => {
      const info = await createVault(parentDir, name);
      const opened = await services.vaultSession.open(info.root);
      return ok(opened);
    },
  );

  registrar.register('vault:open', async ({ path }, services): Promise<Result<VaultInfo>> => {
    await validateVaultRoot(path);
    return ok(await services.vaultSession.open(path));
  });

  registrar.register('vault:close', async (_payload, services): Promise<Result<void>> => {
    services.vaultSession.close();
    return ok(undefined);
  });

  registrar.register(
    'vault:listRecent',
    async (_payload, services): Promise<Result<RecentVaultEntry[]>> => {
      return ok(services.appStore.existingRecents());
    },
  );

  registrar.register('vault:removeRecent', async ({ path }, services): Promise<Result<void>> => {
    services.appStore.removeRecent(path);
    return ok(undefined);
  });

  registrar.register(
    'vault:getLayout',
    async (_payload, services): Promise<Result<VaultLayout | null>> => {
      const current = services.vaultSession.getCurrent();
      if (!current) return ok(null);
      const config = await readVaultConfig(current.root);
      return ok(config.layout);
    },
  );

  registrar.register('vault:saveLayout', async ({ layout }, services): Promise<Result<void>> => {
    const current = services.vaultSession.getCurrent();
    if (!current) return { ok: false, error: '尚未打开任何 vault', code: 'NO_VAULT' };
    await saveVaultLayout(current.root, layout);
    return ok(undefined);
  });
}

/** 供单测重置懒恢复标记。 */
export function __resetVaultStateRestore(): void {
  restoreAttempted = false;
}
