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

/**
 * git:* 命名空间 handler：与 shared 契约一一对应，主进程唯一 Git 调用点。
 * `git:statusChanged` 事件在 ipc/index.ts 组合根处统一接线（含无 IPC 请求的自动提交）。
 */
export function registerGitHandlers(registrar: IpcRegistrar): void {
  registrar.register('git:ping', async () =>
    ok({ pong: true as const, namespace: 'git' as const, implementedBy: 'DEV-007' as const }),
  );

  registrar.register(
    'git:inspect',
    async ({ root }, services): Promise<Result<{ repository: boolean }>> => {
      return ok({ repository: await services.git.isRepository(root) });
    },
  );

  registrar.register(
    'git:init',
    async ({ root }, services): Promise<Result<GitOperationResult>> => {
      services.git.setRoot(root);
      return ok(await services.git.initialize(root));
    },
  );

  registrar.register('git:getStatus', async (_payload, services): Promise<Result<GitStatus>> => {
    return ok(await services.git.status());
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
    'git:clone',
    async ({ url, targetDir }, services): Promise<Result<GitOperationResult>> => {
      return ok(await services.git.clone(url, targetDir));
    },
  );

  registrar.register(
    'git:setUseSystemGit',
    async ({ enabled }, services): Promise<Result<void>> => {
      services.git.setUseSystemGit(enabled);
      services.appStore.setUseSystemGit(enabled);
      services.windows.sendToMainWindow('git:statusChanged', await services.git.status());
      return ok(undefined);
    },
  );

  registrar.register('git:getAutoCommitDebounce', async (_payload, services) => {
    return ok({ milliseconds: services.git.getDebounceMs() });
  });

  registrar.register('git:setAutoCommitDebounce', async ({ milliseconds }, services) => {
    const accepted = services.git.setDebounceMs(milliseconds);
    services.appStore.setAutoCommitDebounceMs(accepted);
    return ok({ milliseconds: accepted });
  });
}

export { GitServiceError };
