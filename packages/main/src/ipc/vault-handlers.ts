import { ok, type Result } from '@nexnote/shared';
import type { IpcRegistrar } from './registrar';
import * as pathUtil from 'node:path';
import {
  createVault,
  readVaultConfig,
  sanitizeVaultName,
  saveVaultLayout,
  validateVaultRoot,
} from '../vault/vault-manager';

/**
 * 校验 vault:clone 的 target 名称：仅允许作为 parentDir 的直接子目录存在。
 * 拒绝空字符串、`.`、`..`、包含路径分隔符或解析后逃出 parentDir 的任意输入。
 * 此举与 vault-manager 的 sanitizeVaultName 语义一致，但额外做 resolve-time 检查。
 */
function cloneNameError(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: 'INVALID_NAME' });
}

/**
 * 校验 vault:clone 的 target 名称：仅允许作为 parentDir 的直接子目录存在。
 * 拒绝空字符串、`.`、`..`、包含路径分隔符或解析后逃出 parentDir 的任意输入。
 * 此举与 vault-manager 的 sanitizeVaultName 语义一致，但额外做 resolve-time 检查。
 */
function ensureSafeCloneName(parentDir: string, name: string): string {
  const sanitized = sanitizeVaultName(name);
  if (!sanitized.ok) {
    throw cloneNameError(`克隆目录名称不合法：${sanitized.reason}`);
  }
  if (sanitized.value !== name.trim()) {
    throw cloneNameError(`克隆目录名称含非法字符：${name}`);
  }
  const target = pathUtil.join(parentDir, sanitized.value);
  const rel = pathUtil.relative(parentDir, target);
  if (rel === '' || rel.startsWith('..') || pathUtil.isAbsolute(rel)) {
    throw cloneNameError(`克隆目录名称必须为 ${parentDir} 的直接子目录`);
  }
  return target;
}
import type { RecentVaultEntry, VaultInfo, VaultLayout, VaultStartupState } from '@nexnote/shared';

/** 启动状态查询只做一次恢复（懒执行，避免在模块加载期做 IO）。 */
let restoreAttempted = false;

export function registerVaultHandlers(registrar: IpcRegistrar): void {
  registrar.register(
    'vault:getState',
    async (_payload, services): Promise<Result<VaultStartupState>> => {
      let current = services.vaultSession.getCurrent();
      if (!current && !restoreAttempted) {
        restoreAttempted = true;
        current = await services.vaultSession.restoreLast();
      }
      if (current) {
        const isRepo = await services.git.isRepository(current.root);
        if (isRepo) {
          services.git.setRoot(current.root);
          services.windows.sendToMainWindow('git:statusChanged', await services.git.status());
        } else {
          // A vault from an older version may predate mandatory Git. Return it to
          // onboarding so reopening follows the same explicit-confirmation path.
          services.git.setRoot(null);
          services.vaultSession.close();
          current = null;
        }
      }
      if (current) return ok({ mode: 'ready', vault: current });
      return ok({ mode: 'onboarding', recent: services.appStore.existingRecents() });
    },
  );

  registrar.register(
    'vault:pickDirectory',
    async (_payload, services): Promise<Result<string | null>> => {
      return ok(await services.dialogs.pickDirectory());
    },
  );

  registrar.register(
    'vault:create',
    async ({ parentDir, name }, services): Promise<Result<VaultInfo>> => {
      const info = await createVault(parentDir, name);
      await services.git.initialize(info.root);
      const opened = await services.vaultSession.open(info.root);
      services.git.setRoot(opened.root);
      services.windows.sendToMainWindow('git:statusChanged', await services.git.status());
      return ok(opened);
    },
  );

  registrar.register('vault:open', async ({ path }, services): Promise<Result<VaultInfo>> => {
    await validateVaultRoot(path);
    if (!(await services.git.isRepository(path))) {
      return {
        ok: false,
        error: '此文件夹尚未初始化 Git。请确认后使用“初始化 Git”操作。',
        code: 'GIT_INITIALIZATION_REQUIRED',
      };
    }
    const opened = await services.vaultSession.open(path);
    services.git.setRoot(opened.root);
    services.windows.sendToMainWindow('git:statusChanged', await services.git.status());
    return ok(opened);
  });

  registrar.register('vault:clone', async ({ url, parentDir, name }, services) => {
    await validateVaultRoot(parentDir);
    const fallbackName =
      url
        .trim()
        .replace(/\/$/, '')
        .split('/')
        .pop()
        ?.replace(/\.git$/, '') || 'vault';
    const target = ensureSafeCloneName(parentDir, name?.trim() || fallbackName);
    const targetName = pathUtil.basename(target);
    const cloned = await services.git.cloneInto(url, parentDir, targetName);
    const opened = await services.vaultSession.open(target);
    services.git.setRoot(opened.root);
    services.windows.sendToMainWindow('git:statusChanged', await services.git.status());
    return ok({ vault: opened, status: cloned.status });
  });

  registrar.register('vault:initGit', async ({ path }, services): Promise<Result<VaultInfo>> => {
    // This is deliberately a separate, user-confirmed IPC path. vault:open never
    // initializes a folder by itself, preventing accidental .git creation.
    await validateVaultRoot(path);
    services.git.setRoot(path);
    await services.git.initialize(path);
    const opened = await services.vaultSession.open(path);
    services.git.setRoot(opened.root);
    services.windows.sendToMainWindow('git:statusChanged', await services.git.status());
    return ok(opened);
  });

  registrar.register('vault:close', async (_payload, services): Promise<Result<void>> => {
    // setRoot(null) cancels an outstanding debounce timer before its callback can
    // observe a stale vault root and commit into a closed workspace.
    services.git.setRoot(null);
    services.vaultSession.close();
    services.windows.sendToMainWindow('git:statusChanged', {
      repository: false,
      branch: null,
      changed: 0,
      ahead: 0,
      behind: 0,
      remote: null,
      usingSystemGit: services.appStore.getUseSystemGit(),
    });
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
    services.git.scheduleAutoCommit('保存 vault 布局');
    // Layout persistence is successful even if Git status is temporarily unavailable.
    try {
      services.windows.sendToMainWindow('git:statusChanged', await services.git.status());
    } catch {
      // The scheduled commit will publish status later.
    }
    return ok(undefined);
  });
}

/** 供单测重置懒恢复标记。 */
export function __resetVaultStateRestore(): void {
  restoreAttempted = false;
}
