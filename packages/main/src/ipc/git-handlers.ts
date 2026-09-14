import { ok, type Result } from '@nexnote/shared';
import type {
  GitCommit,
  GitOperationResult,
  GitRemote,
  GitRestorePreview,
  GitStatus,
} from '@nexnote/shared';
import type { IpcRegistrar } from './registrar';
import { GitServiceError } from '../git/git-service';
import { GitSyncDoctorError } from '../git/git-sync-doctor';

/**
 * git:* 命名空间 handler：与 shared 契约一一对应，主进程唯一 Git 调用点。
 * `git:statusChanged` 事件在 ipc/index.ts 组合根处统一接线（含无 IPC 请求的自动提交）。
 */
export function registerGitHandlers(registrar: IpcRegistrar): void {
  registrar.register('git:ping', async () =>
    ok({ pong: true as const, namespace: 'git' as const, implementedBy: 'DEV-007' as const }),
  );

  registrar.register('git:getStatus', async (_payload, services): Promise<Result<GitStatus>> => {
    return ok(await services.git.status());
  });

  registrar.register('git:doctor:diagnose', async (_payload, services) => {
    requireDoctor(services);
    return ok(await services.gitDoctor!.diagnose());
  });
  registrar.register('git:doctor:repairPrepare', async ({ action }, services) => {
    requireDoctor(services);
    return ok(await services.gitDoctor!.prepare(action));
  });
  registrar.register('git:doctor:repairExecute', async ({ ticket }, services) => {
    requireDoctor(services);
    return ok(await services.gitDoctor!.execute(ticket));
  });
  registrar.register('git:doctor:dismiss', async (_payload, services) => {
    requireDoctor(services);
    services.gitDoctor!.dismiss();
    return ok(undefined);
  });

  registrar.register(
    'git:getTimeline',
    async ({ path, limit }, services): Promise<Result<GitCommit[]>> => {
      return ok(await services.git.timeline(path, limit ?? 100));
    },
  );

  registrar.register(
    'git:recordAutoCommit',
    async ({ summary, debounceMs }, services): Promise<Result<void>> => {
      services.git.scheduleAutoCommit(summary ?? '保存页面', debounceMs);
      return ok(undefined);
    },
  );

  registrar.register(
    'git:commit',
    async ({ message }, services): Promise<Result<GitOperationResult>> => {
      return ok(await services.git.commitManual(message));
    },
  );

  registrar.register(
    'git:addRemote',
    async ({ name, url }, services): Promise<Result<GitOperationResult>> => {
      return ok(await services.git.addRemote(name, url));
    },
  );

  registrar.register(
    'git:listRemotes',
    async (_payload, services): Promise<Result<GitRemote[]>> => {
      return ok(await services.git.remotes());
    },
  );

  registrar.register(
    'git:pull',
    async ({ force } = {}, services): Promise<Result<GitOperationResult>> => {
      return ok(await services.git.pull({ force: force === true }));
    },
  );

  registrar.register(
    'git:push',
    async (_payload, services): Promise<Result<GitOperationResult>> => {
      return ok(await services.git.push());
    },
  );

  registrar.register(
    'git:previewRestore',
    async ({ path, commit }, services): Promise<Result<GitRestorePreview>> => {
      return ok(await services.git.previewRestore(path, commit));
    },
  );

  registrar.register(
    'git:restoreFile',
    async ({ path, commit }, services): Promise<Result<GitOperationResult>> => {
      return ok(await services.git.restoreFile(path, commit));
    },
  );

  registrar.register(
    'git:setUseSystemGit',
    async ({ enabled }, services): Promise<Result<void>> => {
      // DEV-016：统一以 SettingsService 为唯一权威；update 触发 onChange
      // 进而广播 settings:changed + git:statusChanged。
      services.settings.update({ git: { useSystemGit: enabled } });
      // 立即同步到运行时服务（onChange 中的同步是广播路径；这里是直接路径，
      // 确保在测试环境/无 bootstrap listener 时仍然生效）。
      services.git.setUseSystemGit(enabled);
      services.appStore.setUseSystemGit(enabled);
      return ok(undefined);
    },
  );

  registrar.register('git:getAutoCommitDebounce', async (_payload, services) => {
    return ok({ milliseconds: services.git.getDebounceMs() });
  });

  registrar.register('git:setAutoCommitDebounce', async ({ milliseconds }, services) => {
    const root = services.vaultSession.getCurrent()?.root;
    if (!root) {
      throw new GitServiceError('尚未打开任何知识库', 'NO_VAULT');
    }
    // legacy channel 仍可用，但写入 vault config 这一唯一权威，再回灌 GitService。
    const { saveVaultSettings } = await import('../vault/vault-manager');
    const updated = await saveVaultSettings(root, {
      git: { autoCommitIntervalMs: milliseconds },
    });
    const accepted = services.git.setDebounceMs(updated.git.autoCommitIntervalMs);
    services.windows.sendToMainWindow('settings:changed', {
      global: services.settings.get(),
      vault: updated,
    });
    return ok({ milliseconds: accepted });
  });
}

function requireDoctor(services: {
  gitDoctor?: unknown;
}): asserts services is { gitDoctor: NonNullable<typeof services.gitDoctor> } {
  if (!services.gitDoctor) throw new GitSyncDoctorError('Git doctor 未初始化', 'NO_VAULT');
}

export { GitServiceError, GitSyncDoctorError };
