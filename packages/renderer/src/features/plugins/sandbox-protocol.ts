import type { PluginRpcRequest, PluginRpcResponse } from '@nexnote/shared';

export type PluginLifecycleHook = 'initialize' | 'activate' | 'deactivate' | 'unload';

export type SandboxMessage =
  | { type: 'ready' }
  | { type: 'runtime-ready'; pluginId: string }
  | { type: 'heartbeat' }
  | { type: 'crash'; message: string }
  | { type: 'lifecycle'; hook: PluginLifecycleHook }
  | { type: 'lifecycle-complete'; hook: PluginLifecycleHook }
  | { type: 'rpc'; request: PluginRpcRequest }
  | { type: 'rpc-response'; response: PluginRpcResponse };

export interface PermissionPrompt {
  pluginId: string;
  permission: string;
  request: PluginRpcRequest;
  decide: (allowed: boolean, alwaysAllow: boolean) => void;
}
