import type { PluginRpcRequest, PluginRpcResponse } from '@nexnote/shared';
import { PLUGIN_API_VERSION } from '@nexnote/shared';

export interface PermissionDecision {
  allowed: boolean;
  alwaysAllow: boolean;
}

export interface PermissionFlowApi {
  rpc(pluginId: string, request: PluginRpcRequest): Promise<PluginRpcResponse>;
  grant(pluginId: string, permission: string, alwaysAllow: boolean): Promise<void>;
}

/** 未授权 RPC → renderer prompt → grant → 原请求重试。拒绝时 permission.request 返回 granted:false。 */
export async function invokeWithPermissionRetry(
  pluginId: string,
  request: PluginRpcRequest,
  ask: (permission: string) => Promise<PermissionDecision>,
  api: PermissionFlowApi,
): Promise<PluginRpcResponse> {
  const first = await api.rpc(pluginId, request);
  if (first.ok || first.error?.code !== 'PERMISSION_REQUIRED') return first;
  const permission = (request.params as { permission?: unknown }).permission;
  if (typeof permission !== 'string') return first;
  const decision = await ask(permission);
  if (!decision.allowed) {
    return request.method === 'permission.request'
      ? {
          apiVersion: PLUGIN_API_VERSION,
          id: request.id,
          ok: true,
          data: { granted: false, alwaysAllow: false },
        }
      : {
          apiVersion: PLUGIN_API_VERSION,
          id: request.id,
          ok: false,
          error: { code: 'PERMISSION_DENIED', message: `用户拒绝授权 ${permission}` },
        };
  }
  await api.grant(pluginId, permission, decision.alwaysAllow);
  return api.rpc(pluginId, request);
}
