import type { Result } from '../result';

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  date: string;
  message: string;
  /** NexNote 自动提交可由时间线折叠；手动及恢复提交单独突出显示。 */
  kind: 'initial' | 'auto' | 'manual' | 'restore' | 'other';
  isHead: boolean;
}

export interface GitStatus {
  repository: boolean;
  branch: string | null;
  changed: number;
  ahead: number;
  behind: number;
  remote: string | null;
  usingSystemGit: boolean;
}

export interface GitRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface GitRestorePreview {
  path: string;
  commit: string;
  current: string | null;
  target: string;
}

export interface GitOperationResult {
  message: string;
  status: GitStatus;
}

/** Git 底座的主进程 IPC 契约。所有路径均为 vault 内相对路径。 */
export const GIT_CHANNELS = [
  'git:ping',
  'git:inspect',
  'git:init',
  'git:getStatus',
  'git:getTimeline',
  'git:recordAutoCommit',
  'git:commit',
  'git:addRemote',
  'git:listRemotes',
  'git:pull',
  'git:push',
  'git:previewRestore',
  'git:restoreFile',
  'git:clone',
  'git:setUseSystemGit',
  'git:getAutoCommitDebounce',
  'git:setAutoCommitDebounce',
] as const;

export type GitChannel = (typeof GIT_CHANNELS)[number];

export interface GitChannelMap {
  'git:ping': {
    request: void;
    response: Result<{ pong: true; namespace: 'git'; implementedBy: 'DEV-007' }>;
  };
  'git:inspect': { request: { root: string }; response: Result<{ repository: boolean }> };
  'git:init': { request: { root: string }; response: Result<GitOperationResult> };
  'git:getStatus': { request: void; response: Result<GitStatus> };
  'git:getTimeline': { request: { path?: string; limit?: number }; response: Result<GitCommit[]> };
  'git:recordAutoCommit': {
    request: { summary?: string; debounceMs?: number };
    response: Result<void>;
  };
  'git:commit': { request: { message: string }; response: Result<GitOperationResult> };
  'git:addRemote': { request: { name: string; url: string }; response: Result<GitOperationResult> };
  'git:listRemotes': { request: void; response: Result<GitRemote[]> };
  'git:pull': { request: { force?: boolean }; response: Result<GitOperationResult> };
  'git:push': { request: void; response: Result<GitOperationResult> };
  'git:previewRestore': {
    request: { path: string; commit: string };
    response: Result<GitRestorePreview>;
  };
  'git:restoreFile': {
    request: { path: string; commit: string };
    response: Result<GitOperationResult>;
  };
  'git:clone': {
    request: { url: string; targetDir: string };
    response: Result<GitOperationResult>;
  };
  'git:setUseSystemGit': { request: { enabled: boolean }; response: Result<void> };
  /** 当前生效的自动提交防抖（毫秒）。 */
  'git:getAutoCommitDebounce': { request: void; response: Result<{ milliseconds: number }> };
  /** 保存并立即应用自动提交防抖；主进程会收敛到 500ms–10min。 */
  'git:setAutoCommitDebounce': {
    request: { milliseconds: number };
    response: Result<{ milliseconds: number }>;
  };
}
