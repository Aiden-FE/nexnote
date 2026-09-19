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
import { sanitizeRemoteText } from '../git/git-service';
import type {
  RecentVaultEntry,
  VaultInfo,
  VaultInspection,
  VaultLayout,
  VaultStartupState,
} from '@nexnote/shared';

/** 启动恢复共享同一个 in-flight Promise；guard 成功前 session 不可见。 */
let restoreAttempted = false;
let restoreInFlight: Promise<VaultInfo | null> | null = null;

/**
 * 根据 URL 推导默认的本地目录名。
 * 与 clone handler 中使用的 fallback 逻辑保持一致，
 * 保证 preflight 与 clone 对同一对 (url, name?) 计算出相同的 canonical targetDir。
 */
function fallbackVaultName(url: string): string {
  return (
    url
      .trim()
      .replace(/\/$/, '')
      .split('/')
      .pop()
      ?.replace(/\.git$/, '') || 'vault'
  );
}

/**
 * 计算 clone 的最终目标目录的规范化路径（preflight 和 clone 共用，确保 token 两侧完全一致）。
 * 失败返回错误；成功返回 { targetDir, targetName }。
 */
function resolveCloneTarget(
  parentDir: string,
  url: string,
  name: string | undefined,
):
  | { ok: true; targetDir: string; targetName: string }
  | { ok: false; reason: string; code: string } {
  const targetName = sanitizeVaultName(name?.trim() || fallbackVaultName(url));
  if (!targetName.ok) {
    return { ok: false, reason: `克隆目录名称不合法：${targetName.reason}`, code: 'INVALID_NAME' };
  }
  const targetDir = pathUtil.join(parentDir, targetName.value);
  return { ok: true, targetDir, targetName: targetName.value };
}

export function registerVaultHandlers(registrar: IpcRegistrar): void {
  registrar.register(
    'vault:getState',
    async (_payload, services): Promise<Result<VaultStartupState>> => {
      let current = services.vaultSession.getCurrent();
      if (!current && !restoreAttempted) {
        restoreAttempted = true;
        restoreInFlight ??= services.vaultSession.restoreLast(async (candidate) => {
          if (!(await services.git.isRepository(candidate.root))) {
            throw new Error('RESTORED_VAULT_NOT_REPOSITORY');
          }
          // Guard is inside VaultSession.open's pre-commit transaction: current/last/
          // broadcast remain unchanged while this awaits, including reentrant getState.
          await services.git.ensureSyncGuard(candidate.root);
        });
      }
      if (!current && restoreInFlight) {
        try {
          current = await restoreInFlight;
        } catch (error) {
          services.git.setRoot(null);
          services.appStore.setLastVault(null);
          restoreAttempted = false;
          throw error;
        } finally {
          restoreInFlight = null;
        }
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
    async (
      { parentDir, name, initGit, operationId },
      services,
      context,
    ): Promise<Result<VaultInfo>> => {
      const op = operationId ? services.vaultOperations.start(context.senderId, 'create') : null;
      try {
        const info = await createVault(parentDir, name);
        if (initGit) await services.git.initialize(info.root);
        else await services.git.writeDefaultGitignore(info.root);
        const opened = await services.vaultSession.open(info.root);
        if (initGit) {
          services.git.setRoot(opened.root);
          services.windows.sendToMainWindow('git:statusChanged', await services.git.status());
        }
        return ok(opened);
      } finally {
        if (op) services.vaultOperations.finish(context.senderId, op.operationId);
      }
    },
  );

  registrar.register(
    'vault:open',
    async ({ path, initGit }, services): Promise<Result<VaultInfo>> => {
      const safe = await validateVaultRoot(path);
      if (!(await services.git.isRepository(safe))) {
        if (initGit) {
          services.git.setRoot(safe);
          await services.git.initialize(safe);
        } else {
          return {
            ok: false,
            error: '此文件夹尚未初始化 Git。请确认后使用”初始化 Git”操作。',
            code: 'GIT_INITIALIZATION_REQUIRED',
          };
        }
      } else {
        await services.git.ensureSyncGuard(safe);
      }
      const opened = await services.vaultSession.open(safe);
      services.git.setRoot(opened.root);
      services.windows.sendToMainWindow('git:statusChanged', await services.git.status());
      return ok(opened);
    },
  );

  registrar.register(
    'vault:clone',
    async ({ url, parentDir, name, preflightToken, operationId }, services, context) => {
      const safeParent = await validateVaultRoot(parentDir);
      // 解析目标目录：与 preflight 共用逻辑，保证 token 绑定的 targetDir 完全一致
      const resolved = resolveCloneTarget(safeParent, url, name);
      if (!resolved.ok) {
        return err(resolved.reason, resolved.code);
      }
      const { targetDir, targetName } = resolved;

      // 登记操作（如提供 operationId），支持取消与生命周期追踪
      const op = operationId ? services.vaultOperations.start(context.senderId, 'clone') : null;
      const signal = op?.signal;

      try {
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

        // 若用户已取消，直接拒绝
        if (signal?.aborted) {
          return err('操作已取消', 'OPERATION_CANCELLED');
        }

        // 原子克隆：先到 exclusively-owned 临时目录，成功后 move（no-replace）
        const tmpDir = `${targetDir}.nexnote-clone-${Date.now()}.tmp`;
        try {
          await fsp.mkdir(tmpDir, { recursive: false });
          await services.git.cloneInto(url, tmpDir, targetName);
          // 原子 no-replace move：若目标目录已存在则失败，绝不覆盖
          await fsp.rename(pathUtil.join(tmpDir, targetName), targetDir);
        } catch (error) {
          // 失败只删自有临时目录
          await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
          throw error;
        } finally {
          // 确保临时目录被清理（clone 把仓库放在 tmpDir/name 里，成功后 name 被 move）
          await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }

        const safeTarget = await validateVaultRoot(targetDir);
        await services.git.ensureSyncGuard(safeTarget);
        const opened = await services.vaultSession.open(safeTarget);
        services.git.setRoot(opened.root);
        // 真实 post-clone status：从 GitService 查询，包含 branch/ahead/behind/remote 等
        const status = await services.git.status();
        services.windows.sendToMainWindow('git:statusChanged', status);
        return ok({ vault: opened, status });
      } finally {
        if (op) services.vaultOperations.finish(context.senderId, op.operationId);
      }
    },
  );

  registrar.register(
    'vault:inspect',
    async ({ path }, services): Promise<Result<VaultInspection>> => {
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
    },
  );

  registrar.register(
    'vault:clonePreflight',
    async (
      { url, parentDir, name },
      services,
      context,
    ): Promise<Result<{ reachable: boolean; preflightToken?: string; error?: string }>> => {
      const safeParent = await validateVaultRoot(parentDir);
      // 先解析目标目录，保证 token 与 clone 消费端绑定同一个 canonical targetDir
      const resolved = resolveCloneTarget(safeParent, url, name);
      if (!resolved.ok) {
        return err(resolved.reason, resolved.code);
      }
      // 尝试 ls-remote 来验证远端可达（轻量探测，不下载内容）
      try {
        await services.git.lsRemote(url);
      } catch (e) {
        // 错误信息可能包含 URL 凭据（user:token@host），必须脱敏后再返回给 renderer
        const raw = e instanceof Error ? e.message : String(e);
        const safe = sanitizeRemoteText(raw);
        return ok({ reachable: false, error: safe || '远端不可达' });
      }
      const token = services.vaultClones.createToken(context.senderId, url, resolved.targetDir);
      return ok({ reachable: true, preflightToken: token });
    },
  );

  registrar.register(
    'vault:cancelOperation',
    async ({ operationId }, services, context): Promise<Result<void>> => {
      const cancelled = services.vaultOperations.cancel(context.senderId, operationId);
      if (!cancelled) {
        return err('找不到该操作或操作已完成', 'OPERATION_NOT_FOUND');
      }
      return ok(undefined);
    },
  );

  registrar.register('vault:initGit', async ({ path }, services): Promise<Result<VaultInfo>> => {
    // This is deliberately a separate, user-confirmed IPC path. vault:open never
    // initializes a folder by itself, preventing accidental .git creation.
    const safe = await validateVaultRoot(path);
    services.git.setRoot(safe);
    await services.git.initialize(safe);
    const opened = await services.vaultSession.open(safe);
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
      usingSystemGit: services.git.effectiveUsesSystemGit(),
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
    if (!current) return { ok: false, error: '尚未打开任何知识库', code: 'NO_VAULT' };
    await saveVaultLayout(current.root, layout);
    services.git.scheduleAutoCommit('保存知识库布局');
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
  restoreInFlight = null;
}
