import type { Result } from '../result';
import type {
  GitDoctorDiagnosis,
  GitDoctorRepairExecuteResult,
  GitDoctorRepairPrepareResult,
  GitRepairAction,
} from '../../types/git';

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
  /** 有未解决的合并冲突（unmerged index 或文件内冲突标记）。 */
  conflict: boolean;
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
  'git:getStatus',
  'git:getTimeline',
  'git:recordAutoCommit',
  'git:commit',
  'git:addRemote',
  'git:listRemotes',
  'git:pull',
  'git:push',
  'git:sync',
  'git:configureAutoSync',
  'git:previewRestore',
  'git:restoreFile',
  'git:setUseSystemGit',
  'git:getAutoCommitDebounce',
  'git:setAutoCommitDebounce',
  'git:doctor:diagnose',
  'git:doctor:repairPrepare',
  'git:doctor:repairExecute',
  'git:doctor:dismiss',
] as const;

export type GitChannel = (typeof GIT_CHANNELS)[number];

export interface GitChannelMap {
  'git:ping': {
    request: void;
    response: Result<{ pong: true; namespace: 'git'; implementedBy: 'DEV-007' }>;
  };
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
  /** DEV-073：一键同步 — fetch → 按 vault.git.syncStrategy rebase/merge → push。 */
  'git:sync': { request: void; response: Result<GitOperationResult> };
  'git:previewRestore': {
    request: { path: string; commit: string };
    response: Result<GitRestorePreview>;
  };
  'git:restoreFile': {
    request: { path: string; commit: string };
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
  'git:doctor:diagnose': { request: void; response: Result<GitDoctorDiagnosis> };
  'git:configureAutoSync': { request: void; response: Result<void> };
  'git:doctor:repairPrepare': {
    request: { action: GitRepairAction };
    response: Result<GitDoctorRepairPrepareResult>;
  };
  'git:doctor:repairExecute': {
    request: { ticket: string };
    response: Result<GitDoctorRepairExecuteResult>;
  };
  'git:doctor:dismiss': { request: void; response: Result<void> };
}
