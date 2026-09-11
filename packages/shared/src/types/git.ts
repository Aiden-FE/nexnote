export type GitSyncIssueCategory =
  | 'conflict'
  | 'dirty'
  | 'auth'
  | 'network'
  | 'non-fast-forward'
  | 'no-remote'
  | 'git-missing'
  | 'unknown';
export type GitRepairAction = 'commit' | 'pull' | 'push';
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
