/**
 * NexNote 插件公共 API 类型（DEV-014）。
 *
 * 这是面向插件作者的稳定契约：与运行时 `@nexnote/shared` 内部协议保持一致，
 * 但只暴露插件沙箱内能用到的表面。破坏性变更必须提升 API 主版本（semver）。
 */

/** 插件 API 主版本（与 PLUGIN_API_VERSION 对齐）。 */
export const PLUGIN_API_VERSION = '1.0.0' as const;

/**
 * 权限六档（最小授权原则）：
 * read（默认）/ edit（编辑事务）/ filesystem / network / external-command /
 * desktop-privileged（最高，需显式确认）。
 */
export type PluginPermission =
  | 'read'
  | 'edit'
  | 'filesystem'
  | 'network'
  | 'external-command'
  | 'desktop-privileged';

export type PluginContributionKind = 'commands' | 'menus' | 'views' | 'blockTypes';

/** manifest.json 中的贡献点声明。 */
export interface PluginContribution {
  id: string;
  title: string;
  keywords?: string[];
  /** views：挂载位置（默认 sidebar）。 */
  placement?: 'sidebar' | 'main' | 'settings';
  /** menus：右键菜单锚点（默认编辑器右键「插件」分组）。 */
  anchor?: 'editor/context' | 'block/handle' | 'app';
  /** menus：可见性条件。 */
  when?: { blockType?: string; requiresSelection?: boolean };
  /** blockTypes：块类型标识（写进 plugin_block 节点）。 */
  blockType?: string;
}

/** 插件贡献的检索 Skill（受约束，仅 retrieval 能力，参数由宿主安全执行）。 */
export interface PluginSkillContribution {
  id: string;
  name?: string;
  description?: string;
  params?: {
    topK?: number;
    confidenceWeight?: number;
    budgetChars?: number;
    disableVector?: boolean;
  };
}

/** 插件清单 manifest.json。 */
export interface PluginManifest {
  /** 反向域名式唯一 id。 */
  id: string;
  name: string;
  version: string;
  /** 兼容的最低宿主版本（semver）。 */
  minAppVersion: string;
  /** 沙箱入口文件（相对插件目录）。 */
  main: string;
  description?: string;
  capabilities: PluginPermission[];
  permissions: PluginPermission[];
  contributions?: Partial<Record<PluginContributionKind, PluginContribution[]>>;
  skills?: PluginSkillContribution[];
}

/** 版本化 RPC 请求信封。 */
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

/**
 * 注入到沙箱的全局对象 `window.nexnotePlugin`。
 * 入口脚本在 nexnote-plugin-initialize / activate 事件后可用。
 */
export interface NexnotePluginApi {
  readonly apiVersion: typeof PLUGIN_API_VERSION;
  /** 注册一个运行时命令（出现在 ⌘K 命令面板，按「插件」分组）。 */
  registerCommand(id: string, title: string, keywords?: string[]): Promise<unknown>;
  /** 编辑事务（expectedRevision 用于并发控制）。 */
  transact(intent: { type: string; payload: unknown }, expectedRevision: number): Promise<unknown>;
  /** 申请某项权限（未授权时触发宿主权限弹窗）。 */
  requestPermission(permission: PluginPermission): Promise<{ granted: boolean; alwaysAllow: boolean }>;
  /** 调用受权限保护的能力（network/filesystem/external-command 等）。 */
  callCapability(
    permission: PluginPermission,
    operation: string,
    payload?: unknown,
  ): Promise<unknown>;
}

declare global {
  interface Window {
    nexnotePlugin?: NexnotePluginApi;
  }
}
