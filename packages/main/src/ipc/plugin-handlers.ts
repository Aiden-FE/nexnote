import { ok, type Result } from '@nexnote/shared';
import type { PluginView, PluginRpcResponse } from '@nexnote/shared';
import type { IpcRegistrar } from './registrar';

/**
 * plugins:* IPC（安全模型，DEV-013）：
 * - 会话绑定：source/RPC/crash 只能凭 beginSession 颁发、绑定 pluginId 的会话 token 访问。
 * - 授权门禁：grant 只能消费一次性 challenge（由渲染层可信用户确认生成），渲染层无法直接授权。
 * - 安装隔离：installPreview 快照 artifact 到不可变 staging 并返回票据，confirm 只引用同一票据。
 */
export function registerPluginHandlers(registrar: IpcRegistrar): void {
  registrar.register('plugins:list', (_p, s) => ok(s.plugins.list()));
  registrar.register('plugins:listCommands', (_p, s) => ok(s.plugins.listCommands()));
  registrar.register('plugins:listContributions', (_p, s) => ok(s.plugins.listContributions()));

  registrar.register('plugins:pickSource', async (payload, s): Promise<Result<{ path: string | null }>> => {
    const path =
      payload.source === 'zip'
        ? await s.dialogs.pickFile([{ name: 'Plugin ZIP', extensions: ['zip'] }])
        : await s.dialogs.pickDirectory();
    return ok({ path });
  });

  registrar.register('plugins:installPreview', (payload, s) =>
    ok(s.plugins.previewInstall(payload.source, payload.path)),
  );
  registrar.register('plugins:confirmInstall', (payload, s): Result<PluginView> => {
    const view = s.plugins.confirmInstall(payload.ticket, payload.accept);
    s.windows.sendToMainWindow('plugins:changed', { reason: payload.accept ? 'install' : 'install-declined' });
    return ok(view);
  });
  registrar.register('plugins:uninstall', (payload, s) => {
    s.plugins.uninstall(payload.pluginId);
    s.windows.sendToMainWindow('plugins:changed', { reason: 'uninstall' });
    return ok(undefined);
  });
  registrar.register('plugins:setEnabled', (payload, s): Result<PluginView> => {
    const view = s.plugins.setEnabled(payload.pluginId, payload.enabled);
    s.windows.sendToMainWindow('plugins:changed', { reason: payload.enabled ? 'enabled' : 'disabled' });
    return ok(view);
  });

  registrar.register('plugins:listAuditLog', (payload, s) => {
    const records = s.plugins.listAudit(payload.pluginId);
    return ok(payload.limit ? records.slice(0, payload.limit) : records);
  });
  registrar.register('plugins:revokePermission', (payload, s): Result<PluginView> => {
    const view = s.plugins.revokePermission(payload.pluginId, payload.permission);
    s.windows.sendToMainWindow('plugins:changed', { reason: 'revoke' });
    return ok(view);
  });
  registrar.register('plugins:runCommand', (payload, s) =>
    ok(s.plugins.runCommand(payload.pluginId, payload.commandId, payload.payload)),
  );

  registrar.register('plugins:beginSession', (payload, s) =>
    ok(s.plugins.beginSession(payload.pluginId, payload.nonce, payload.origin)),
  );
  registrar.register('plugins:closeSession', (payload, s) => {
    s.plugins.closeSession(payload.sessionId, payload.token);
    return ok(undefined);
  });
  registrar.register('plugins:getRuntimeSource', (payload, s) =>
    ok(
      s.plugins.runtimeSourceForSession(payload.sessionId, payload.token, payload.pluginId),
    ),
  );
  registrar.register('plugins:reportCrash', (payload, s): Result<PluginView> => {
    const view = s.plugins.reportCrashForSession(
      payload.sessionId,
      payload.token,
      payload.pluginId,
      payload.message,
    );
    s.windows.sendToMainWindow('plugins:changed', { reason: 'crashed' });
    return ok(view);
  });

  registrar.register('plugins:beginAuthChallenge', (payload, s) =>
    ok(s.plugins.beginAuthChallenge(payload.sessionId, payload.token, payload.request)),
  );
  // 授权确认只走 grantPermission（带挑战）；直接 confirm 是不受信路径，恒拒绝。
  registrar.register('plugins:rejectAuthChallenge', (payload, s) => {
    s.plugins.rejectAuthChallenge(payload.challenge, payload.reason);
    return ok(undefined);
  });
  registrar.register('plugins:grantPermission', (payload, s): Result<PluginView> => {
    const view = s.plugins.grantWithChallenge(
      payload.challenge,
      payload.sessionId,
      payload.token,
      payload.requestId,
      payload.alwaysAllow,
    );
    s.windows.sendToMainWindow('plugins:changed', { reason: 'grant' });
    return ok(view);
  });

  registrar.register('plugins:rpc', (payload, s): Result<PluginRpcResponse> => {
    const response = s.plugins.handleRpc(payload.sessionId, payload.token, payload.request);
    if (response.ok && payload.request.method === 'command.register') {
      s.windows.sendToMainWindow('plugins:changed', { reason: 'command-register' });
    }
    return ok(response);
  });
}
