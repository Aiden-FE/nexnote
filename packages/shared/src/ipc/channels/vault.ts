import type { Result } from '../result';
import type {
  RecentVaultEntry,
  VaultInfo,
  VaultInspection,
  VaultLayout,
  VaultStartupState,
} from '../../types/vault';
import type { GitOperationResult } from './git';

export const VAULT_CHANNELS = [
  'vault:getState',
  'vault:pickDirectory',
  'vault:create',
  'vault:open',
  'vault:clone',
  'vault:initGit',
  'vault:inspect',
  'vault:clonePreflight',
  'vault:cancelOperation',
  'vault:close',
  'vault:listRecent',
  'vault:removeRecent',
  'vault:getLayout',
  'vault:saveLayout',
  'vault:reveal',
] as const;

export type VaultChannel = (typeof VAULT_CHANNELS)[number];

export interface VaultChannelMap {
  /** 启动状态：无 vault → 向导；有上次 vault → 直接 ready */
  'vault:getState': { request: void; response: Result<VaultStartupState> };
  /** 打开系统目录选择对话框，返回目录或 null（用户取消） */
  'vault:pickDirectory': { request: void; response: Result<string | null> };
  /**
   * 在 parentDir 下新建名为 name 的空 vault（创建 .nexnote/config.json）。
   * `initGit` 是显式 opt-in：新建路径由 renderer 默认勾选但必须让用户明确看到；
   * 服务端绝不隐式 mutate。`operationId` 使该操作可被同 sender 取消。
   */
  'vault:create': {
    request: { parentDir: string; name: string; initGit?: boolean; operationId?: string };
    response: Result<VaultInfo>;
  };
  /**
   * 打开已有文件夹作为 vault（缺 .nexnote 自动补齐）。绝不由服务端初始化 Git：
   * 非 Git 目录返回 GIT_INITIALIZATION_REQUIRED，引导走显式 initGit opt-in。
   * `initGit=true` 是 renderer 明确确认后的一次性 opt-in。
   */
  'vault:open': { request: { path: string; initGit?: boolean }; response: Result<VaultInfo> };
  /** 关闭当前 vault，回到首启动向导 */
  'vault:close': { request: void; response: Result<void> };
  'vault:listRecent': { request: void; response: Result<RecentVaultEntry[]> };
  'vault:removeRecent': { request: { path: string }; response: Result<void> };
  'vault:getLayout': { request: void; response: Result<VaultLayout | null> };
  /** 渲染层布局变化时持久化进 vault 配置 */
  'vault:saveLayout': { request: { layout: VaultLayout }; response: Result<void> };
  /**
   * 克隆远程仓库到 parentDir。必须先经 vault:clonePreflight 获得一次性、
   * sender 绑定、TTL 的 preflightToken；token 与 url/parentDir 必须逐项匹配。
   * 克隆到 exclusively-owned 临时目录后原子 move；失败只删除自有临时目录。
   */
  'vault:clone': {
    request: {
      url: string;
      parentDir: string;
      name?: string;
      preflightToken: string;
      operationId?: string;
    };
    response: Result<{ vault: VaultInfo; status: GitOperationResult['status'] }>;
  };
  /** 经用户确认后初始化并打开一个已有文件夹；不会由 vault:open 隐式执行。 */
  'vault:initGit': { request: { path: string }; response: Result<VaultInfo> };
  /** 检查一个路径：是否为目录、是否为 Obsidian vault、是否为 Git 仓库、条目数。 */
  'vault:inspect': { request: { path: string }; response: Result<VaultInspection> };
  /** 授权预检 + 签发一次性 clone 授权 token（webContents/sender 绑定 + TTL）。 */
  'vault:clonePreflight': {
    request: { url: string; parentDir: string };
    response: Result<{ reachable: boolean; preflightToken?: string; error?: string }>;
  };
  /** 撤销一个进行中的向导文件操作（new/open/clone），仅当 sender 匹配。 */
  'vault:cancelOperation': { request: { operationId: string }; response: Result<void> };
  /** 在 Finder / 资源管理器中显示 vault 内文件 */
  'vault:reveal': { request: { path: string }; response: Result<void> };

}
