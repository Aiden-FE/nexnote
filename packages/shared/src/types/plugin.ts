/** 插件 API 的首个稳定协议版本；破坏性变更必须提升 major。 */
export const PLUGIN_API_VERSION = '1.0.0' as const;

export type PluginPermission =
  'read' | 'edit' | 'filesystem' | 'network' | 'external-command' | 'desktop-privileged';

export type PluginContributionKind = 'commands' | 'menus' | 'views' | 'blockTypes';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  /** iframe 内运行的 UI/入口文件，相对于插件目录。 */
  main: string;
  contributions?: Partial<Record<PluginContributionKind, PluginContribution[]>>;
  capabilities: PluginPermission[];
  permissions: PluginPermission[];
  description?: string;
}

export interface PluginContribution {
  id: string;
  title: string;
  /** command contribution 可选的搜索关键字。 */
  keywords?: string[];
}

export interface PluginPermissionGrant {
  permission: PluginPermission;
  granted: boolean;
  alwaysAllow: boolean;
}

export type PluginRuntimeState = 'loaded' | 'active' | 'disabled' | 'crashed';

export interface PluginInstallTicket {
  /** preview 时由 main 生成的不可变安装票据；confirm 必须原样回传。 */
  ticket: string;
  artifactHash: string;
  source: 'directory' | 'zip';
  manifest: PluginManifest;
  requestedPermissions: PluginPermission[];
}

export interface PluginAuthChallenge {
  /** 一次性授权挑战；主进程只在用户设置/弹窗显式确认时消费。 */
  challenge: string;
  pluginId: string;
  permission: PluginPermission;
  request: PluginRpcRequest;
  /** Trusted sandbox session/frame and exact RPC target that originated the prompt. */
  sessionId: string;
  requestId: string;
  issuedAt: number;
  expiresAt: number;
}

export interface PluginSessionToken {
  token: string;
  pluginId: string;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
}

/** 绝不向渲染层、插件或导出文件暴露插件目录外的主进程能力。 */
export interface PluginView {
  id: string;
  name: string;
  version: string;
  description?: string;
  state: PluginRuntimeState;
  permissions: PluginPermission[];
  grants: PluginPermissionGrant[];
  contributionCounts: Record<PluginContributionKind, number>;
  lastError?: string;
}

export interface PluginInstallPreview {
  manifest: PluginManifest;
  /** 新安装：requested=全部声明；升级：仅新增加的权限。 */
  requestedPermissions: PluginPermission[];
  source: 'directory' | 'zip';
  signature: 'not-configured';
}

export interface PluginAuditRecord {
  id: string;
  pluginId: string;
  operation: string;
  permission?: PluginPermission;
  allowed: boolean;
  detail?: string;
  at: number;
}

export interface PluginCommandView {
  id: string;
  pluginId: string;
  title: string;
  keywords?: string[];
}

export interface PluginContributionView extends PluginContribution {
  /** 作用域化 ID，卸载时按 pluginId 整体撤销。 */
  scopedId: string;
  pluginId: string;
  kind: PluginContributionKind;
}

/** 插件对宿主发起的版本化 RPC envelope。 */
export interface PluginRpcRequest {
  apiVersion: typeof PLUGIN_API_VERSION;
  id: string;
  method: 'command.register' | 'transact' | 'permission.request' | 'capability.call';
  params: unknown;
}

export interface PluginRpcResponse {
  apiVersion: typeof PLUGIN_API_VERSION;
  id: string;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

/** 预留协作并发控制，DEV-014/编辑器协作层可消费。 */
export interface PluginTransactionIntent {
  type: string;
  payload: unknown;
}

export interface PluginTransactionRequest {
  intent: PluginTransactionIntent;
  expectedRevision: number;
}
