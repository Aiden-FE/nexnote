export type GitSyncIssueCategory =
  | 'conflict'
  | 'dirty'
  | 'auth'
  | 'network'
  | 'non-fast-forward'
  | 'no-remote'
  | 'git-missing'
  | 'unknown';
export type GitRepairAction = 'commit' | 'pull' | 'push' | 'abort-rebase-or-merge';
export interface GitSyncIssue {
  category: GitSyncIssueCategory;
  message: string;
  code: string;
}
export interface GitRepairPlan {
  action: GitRepairAction | null;
  commandPreview: string | null;
  requiresConfirmation: boolean;
  safe: boolean;
  manualGuidance: string;
}
export interface GitDoctorStatusSnapshot {
  branch: string | null;
  changed: number;
  ahead: number;
  behind: number;
  remote: string | null;
  conflict: boolean;
  /** DEV-082: persisted on the snapshot so doctor execute's TOCTOU check refuses
   * to abort after the rebase state has already cleared. */
  rebaseInProgress?: boolean;
  /** Content-bound TOCTOU data; hashes never contain file contents or credentials. */
  headOid?: string | null;
  remoteOid?: string | null;
  porcelain?: string;
  files?: Array<{ path: string; sha256: string | null }>;
}
export interface GitDoctorDiagnosis {
  issue: GitSyncIssue;
  plan: GitRepairPlan;
  conflictFiles: string[];
  explanation: string;
  explanationSource: 'ai' | 'rules';
  status: GitDoctorStatusSnapshot;
}
export interface GitDoctorRepairPrepareResult {
  diagnosis: GitDoctorDiagnosis;
  ticket: string;
  ticketExpiresAt: number;
}
export interface GitDoctorRepairExecuteResult {
  message: string;
  status: GitDoctorStatusSnapshot;
}
