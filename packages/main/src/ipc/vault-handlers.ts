import { ok, err, type Result } from '@nexnote/shared';
import type { IpcRegistrar } from './registrar';
import * as pathUtil from 'node:path';
import { promises as fsp } from 'node:fs';
import {
  createVault,
  readVaultConfig,
  sanitizeVaultName,
  saveVaultLayout,
  validateVaultRoot,
} from '../vault/vault-manager';
import type {
  RecentVaultEntry,
  VaultInfo,
  VaultInspection,
  VaultLayout,
  VaultStartupState,
} from '@nexnote/shared';

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
      if (current) return ok({ mode: 'ready', vault: current, showWelcome: false });
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
    async ({ parentDir, name, initGit }, services): Promise<Result<VaultInfo>> => {
      const info = await createVault(parentDir, name);
      if (initGit) {
        await services.git.initialize(info.root);
      }
      const opened = await services.vaultSession.open(info.root);
      if (initGit) {
        services.git.setRoot(opened.root);
        services.windows.sendToMainWindow('git:statusChanged', await services.git.status());
      }
      return ok(opened);
    },
  );

  registrar.register(
    'vault:open',
    async ({ path, initGit }, services): Promise<Result<VaultInfo>> => {
      await validateVaultRoot(path);
      if (!(await services.git.isRepository(path))) {
        if (initGit) {
          services.git.setRoot(path);
          await services.git.initialize(path);
        } else {
          return {
            ok: false,
            error: '此文件夹尚未初始化 Git。请确认后使用”初始化 Git”操作。',
            code: 'GIT_INITIALIZATION_REQUIRED',
          };
        }
      }
      const opened = await services.vaultSession.open(path);
      services.git.setRoot(opened.root);
      services.windows.sendToMainWindow('git:statusChanged', await services.git.status());
      return ok(opened);
    },
  );

  registrar.register(
    'vault:clone',
    async ({ url, parentDir, name, preflightToken }, services, context) => {
      await validateVaultRoot(parentDir);
      const fallbackName =
        url
          .trim()
          .replace(/\/$/, '')
          .split('/')
          .pop()
          ?.replace(/\.git$/, '') || 'vault';
      const targetName = sanitizeVaultName(name?.trim() || fallbackName);
      if (!targetName.ok) {
        return err(`克隆目录名称不合法：${targetName.reason}`, 'INVALID_NAME');
      }
      const targetDir = pathUtil.join(parentDir, targetName.value);
      // 消费一次性 preflight token：sender 绑定 + TTL + url/targetDir 逐项匹配
      const consume = services.vaultClones.consume(
        preflightToken,
        context.senderId,
        url,
        targetDir,
      );
      if (!consume.ok) {
        return err(`克隆授权无效：${consume.reason}`, 'CLONE_TOKEN_INVALID');
      }
      // 原子克隆：先到 exclusively-owned 临时目录，成功后 move（no-replace）
      const tmpDir = `${targetDir}.nexnote-clone-${Date.now()}.tmp`;
      try {
        await fsp.mkdir(tmpDir, { recursive: false });
        await services.git.cloneInto(url, tmpDir, targetName.value);
        // 原子 no-replace move：若目标目录已存在则失败，绝不覆盖
        await fsp.rename(pathUtil.join(tmpDir, targetName.value), targetDir);
      } catch (error) {
        // 失败只删自有临时目录
        await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        throw error;
      } finally {
        // 确保临时目录被清理（clone 把仓库放在 tmpDir/name 里，成功后 name 被 move）
        await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
      const opened = await services.vaultSession.open(targetDir);
      services.git.setRoot(opened.root);
      services.windows.sendToMainWindow('git:statusChanged', await services.git.status());
      return ok({ vault: opened, status: { repository: true, branch: 'main', changed: 0, ahead: 0, behind: 0, remote: null, usingSystemGit: false, conflict: false } });
    },
  );

  registrar.register('vault:inspect', async ({ path }, services): Promise<Result<VaultInspection>> => {
    const result: VaultInspection = {
      path,
      exists: false,
      isDirectory: false,
      hasNexnote: false,
      isGitRepo: false,
      isObsidian: false,
      entryCount: 0,
    };
    const stat = await fsp.stat(path).catch(() => null);
    if (!stat) return ok(result);
    result.exists = true;
    if (!stat.isDirectory()) return ok(result);
    result.isDirectory = true;
    const entries = await fsp.readdir(path).catch(() => []);
    result.entryCount = entries.length;
    const entrySet = new Set(entries);
    result.hasNexnote = entrySet.has('.nexnote');
    result.isGitRepo = entrySet.has('.git');
    result.isObsidian = entrySet.has('.obsidian');
    void services;
    return ok(result);
  });

  registrar.register(
    'vault:clonePreflight',
    async ({ url, parentDir }, services, context): Promise<Result<{ reachable: boolean; preflightToken?: string; error?: string }>> => {
      await validateVaultRoot(parentDir);
      // 尝试 ls-remote 来验证远端可达（轻量探测，不下载内容）
      try {
        await services.git.lsRemote(url);
      } catch (e) {
        return ok({ reachable: false, error: e instanceof Error ? e.message : '远端不可达' });
      }
      const token = services.vaultClones.createToken(context.senderId, url, parentDir);
      return ok({ reachable: true, preflightToken: token });
    },
  );

  registrar.register(
    'vault:cancelOperation',
    async ({ operationId }, services, context): Promise<Result<void>> => {
      services.vaultOperations.cancel(context.senderId, operationId);
      return ok(undefined);
    },
  );

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
      conflict: false,
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

  registrar.register('vault:reveal', async ({ path }, services): Promise<Result<void>> => {
    const { abs } = await services.fs.resolve(path);
    await services.revealItem(abs);
    return ok(undefined);
  });
}

/** 供单测重置懒恢复标记。 */
export function __resetVaultStateRestore(): void {
  restoreAttempted = false;
}
