import { ok, type Result } from '@nexnote/shared';
import type { AppInfo, UpdateCheckResult } from '@nexnote/shared';
import type { IpcRegistrar } from './registrar';

export function registerAppHandlers(registrar: IpcRegistrar): void {
  registrar.register('app:getInfo', async (_payload, services): Promise<Result<AppInfo>> => ok(services.appInfo()));
  registrar.register('app:checkForUpdates', async (_payload, services): Promise<Result<UpdateCheckResult>> => ok(await services.checkForUpdates()));
  registrar.register('app:downloadUpdate', async (_payload, services): Promise<Result<UpdateCheckResult>> => ok(await services.downloadUpdate()));
  registrar.register('app:installUpdate', async (_payload, services) => ok(services.installUpdate()));
  registrar.register('app:setUpdateChannel', async ({ channel }, services): Promise<Result<UpdateCheckResult>> => ok(services.setUpdateChannel(channel)));
}

/** 命名空间占位 ping（editor/git/ai/plugins）。 */
export function registerNamespacePingHandlers(registrar: IpcRegistrar): void {
  registrar.register('editor:ping', async () => ok({ pong: true as const, namespace: 'editor' as const, implementedBy: 'DEV-002' as const }));
  registrar.register('git:ping', async () => ok({ pong: true as const, namespace: 'git' as const, implementedBy: 'DEV-007' as const }));
  registrar.register('ai:ping', async () => ok({ pong: true as const, namespace: 'ai' as const, implementedBy: 'DEV-009' as const }));
  registrar.register('plugins:ping', async () => ok({ pong: true as const, namespace: 'plugins' as const, implementedBy: 'DEV-013' as const }));
}
