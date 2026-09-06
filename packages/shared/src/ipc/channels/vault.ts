import type { Result } from '../result';
import type {
  RecentVaultEntry,
  VaultInfo,
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
  'vault:close',
  'vault:listRecent',
  'vault:removeRecent',
  'vault:getLayout',
  'vault:saveLayout',
] as const;

export type VaultChannel = (typeof VAULT_CHANNELS)[number];

export interface VaultChannelMap {
  /** 启动状态：无 vault → 向导；有上次 vault → 直接 ready */
  'vault:getState': { request: void; response: Result<VaultStartupState> };
  /** 打开系统目录选择对话框，返回目录或 null（用户取消） */
  'vault:pickDirectory': { request: void; response: Result<string | null> };
  /** 在 parentDir 下新建名为 name 的空 vault（创建 .nexnote/config.json） */
  'vault:create': { request: { parentDir: string; name: string }; response: Result<VaultInfo> };
  /** 打开已有 Git 文件夹作为 vault；非 Git 目录返回 GIT_INITIALIZATION_REQUIRED。 */
  'vault:open': { request: { path: string }; response: Result<VaultInfo> };
  /** 关闭当前 vault，回到首启动向导 */
  'vault:close': { request: void; response: Result<void> };
  'vault:listRecent': { request: void; response: Result<RecentVaultEntry[]> };
  'vault:removeRecent': { request: { path: string }; response: Result<void> };
  'vault:getLayout': { request: void; response: Result<VaultLayout | null> };
  /** 渲染层布局变化时持久化进 vault 配置 */
  'vault:saveLayout': { request: { layout: VaultLayout }; response: Result<void> };
  /** 克隆远程仓库到目标目录，并自动打开。 */
  'vault:clone': {
    request: { url: string; parentDir: string; name?: string };
    response: Result<{ vault: VaultInfo; status: GitOperationResult['status'] }>;
  };
  /** 经用户确认后初始化并打开一个已有文件夹；不会由 vault:open 隐式执行。 */
  'vault:initGit': { request: { path: string }; response: Result<VaultInfo> };
}
