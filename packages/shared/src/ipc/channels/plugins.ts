import type { Result } from '../result';
import type {
  PluginAuditRecord,
  PluginAuthChallenge,
  PluginCommandView,
  PluginContributionView,
  PluginInstallTicket,
  PluginPermission,
  PluginRpcRequest,
  PluginRpcResponse,
  PluginSessionToken,
  PluginView,
} from '../../types/plugin';

/**
 * plugins:* 命名空间（DEV-013 沙箱运行时与能力 RPC）。
 * 安全模型：
 * - 会话绑定：runtime source/RPC/crash 只能凭 beginSession 颁发、绑定 pluginId 的 token 访问。
 * - 授权门禁：grant 只能消费一次性 challenge（由可信用户确认生成），渲染层无法直接授权。
 * - 安装隔离：installPreview 将 artifact 快照到不可变 staging 并返回票据，confirm 只能引用票据。
 */
export const PLUGINS_CHANNELS = [
  'plugins:ping',
  'plugins:list',
  'plugins:listCommands',
  'plugins:listContributions',
  'plugins:pickSource',
  'plugins:installPreview',
  'plugins:confirmInstall',
  'plugins:uninstall',
  'plugins:setEnabled',
  'plugins:listAuditLog',
  'plugins:revokePermission',
  'plugins:runCommand',
  'plugins:beginSession',
  'plugins:closeSession',
  'plugins:getRuntimeSource',
  'plugins:reportCrash',
  'plugins:beginAuthChallenge',
  'plugins:rejectAuthChallenge',
  'plugins:grantPermission',
  'plugins:rpc',
] as const;

export type PluginsChannel = (typeof PLUGINS_CHANNELS)[number];

export interface PluginsChannelMap {
  'plugins:ping': {
    request: void;
    response: Result<{ pong: true; namespace: 'plugins'; implementedBy: 'DEV-013' }>;
  };
  'plugins:list': { request: void; response: Result<PluginView[]> };
  'plugins:listCommands': { request: void; response: Result<PluginCommandView[]> };
  'plugins:listContributions': { request: void; response: Result<PluginContributionView[]> };
  /** 打开系统选择器：directory=选插件文件夹；zip=选 .zip 包。 */
  'plugins:pickSource': {
    request: { source: 'directory' | 'zip' };
    response: Result<{ path: string | null }>;
  };
  'plugins:installPreview': {
    request: { source: 'directory' | 'zip'; path: string };
    response: Result<PluginInstallTicket>;
  };
  'plugins:confirmInstall': {
    request: { ticket: string; accept: boolean };
    response: Result<PluginView>;
  };
  'plugins:uninstall': { request: { pluginId: string }; response: Result<void> };
  'plugins:setEnabled': {
    request: { pluginId: string; enabled: boolean };
    response: Result<PluginView>;
  };
  'plugins:listAuditLog': {
    request: { pluginId?: string; limit?: number };
    response: Result<PluginAuditRecord[]>;
  };
  'plugins:revokePermission': {
    request: { pluginId: string; permission: PluginPermission };
    response: Result<PluginView>;
  };
  'plugins:runCommand': {
    request: { pluginId: string; commandId: string; payload?: unknown };
    response: Result<unknown>;
  };
  'plugins:beginSession': {
    request: { pluginId: string; nonce: string; origin: string };
    response: Result<PluginSessionToken>;
  };
  'plugins:closeSession': {
    request: { sessionId: string; token: string };
    response: Result<void>;
  };
  'plugins:getRuntimeSource': {
    request: { sessionId: string; token: string; pluginId: string };
    response: Result<{ pluginId: string; source: string }>;
  };
  'plugins:reportCrash': {
    request: { sessionId: string; token: string; pluginId: string; message: string };
    response: Result<PluginView>;
  };
  'plugins:beginAuthChallenge': {
    request: { sessionId: string; token: string; request: PluginRpcRequest };
    response: Result<PluginAuthChallenge>;
  };
  'plugins:rejectAuthChallenge': {
    request: { challenge: string; reason?: string };
    response: Result<void>;
  };
  'plugins:grantPermission': {
    request: {
      challenge: string;
      sessionId: string;
      token: string;
      requestId: string;
      alwaysAllow: boolean;
    };
    response: Result<PluginView>;
  };
  'plugins:rpc': {
    request: { sessionId: string; token: string; request: PluginRpcRequest };
    response: Result<PluginRpcResponse>;
  };
}
