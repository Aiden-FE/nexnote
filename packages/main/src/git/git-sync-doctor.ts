import { randomUUID } from 'node:crypto';
import type {
  GitDoctorDiagnosis,
  GitDoctorRepairExecuteResult,
  GitDoctorRepairPrepareResult,
  GitDoctorStatusSnapshot,
  GitRepairAction,
  GitRepairPlan,
  GitSyncIssue,
  GitSyncIssueCategory,
} from '@nexnote/shared';
import type { GitService } from './git-service';
import { GitServiceError, sanitizeRemoteText } from './git-service';
import type { AiService } from '../ai/ai-service';

/** 修复票据 TTL：预览到显式确认执行之间的最大窗口。 */
export const GIT_DOCTOR_TICKET_TTL_MS = 5 * 60_000;
export const GIT_REPAIR_ACTIONS: readonly GitRepairAction[] = [
  'commit',
  'pull',
  'push',
  'abort-rebase-or-merge',
  'preserve-local-and-abort',
  'force-abort-rebase-or-merge',
];

/**
 * 白名单：doctor 只可能执行这六条等价操作（经 GitService 既有安全路径）。
 * 任何破坏性命令（reset --hard / clean / checkout -- . / push --force）都没有入口。
 */
const COMMAND_PREVIEW: Record<GitRepairAction, string> = {
  // Keep this wording aligned with GitService.commitManual: it stages the vault
  // with `git add .` and adds the manual-message prefix itself.
  commit: 'git add . && git commit（手动提交，消息由应用生成）',
  pull: 'git pull --no-rebase（拒绝脏工作区）',
  push: 'git push（普通推送，从不 force）',
  // DEV-082: rebase/merge --abort is read-mostly: it restores HEAD and the
  // pre-operation index without touching worktree files. Safe to expose.
  'abort-rebase-or-merge': 'git rebase --abort（或 git merge --abort，按当前状态选择）',
  // DEV-083: preserve-local-and-abort does NOT touch worktree files. It uses
  // git format-patch to export ahead commits to .nexnote/.rebase-recovery/,
  // aborts the rebase, then replays patches via git am --3way. Failures are
  // quarantined into FAILED/ inside the recovery directory, never silently lost.
  'preserve-local-and-abort':
    'git format-patch（ahead→.nexnote/.rebase-recovery/）→ git rebase --abort → git am --3way',
  // DEV-083: explicit user-confirmed destructive variant of abort-rebase-or-merge.
  // Drops ahead commits without backup. Surfaced only when the user opts in.
  'force-abort-rebase-or-merge': 'git rebase --abort（丢弃 ahead commits，不备份）',
};

const MANUAL_GUIDANCE: Record<GitSyncIssueCategory, string> = {
  conflict:
    '存在未完成的 rebase 或合并冲突：AI 不会覆盖冲突文件。默认推荐「保留笔记并中止 rebase」——它会把本地未推送的笔记提交导出为补丁、应用完中止后自动回放，不会丢笔记内容；也可以点击「让 Agent 帮助解决」获取步骤指引；如需手动干预，请前往仓库目录操作。',
  dirty: '工作区有未提交变更：可以让 Agent 帮你提交保存，或一键暂存后继续同步。',
  auth: '远程认证失败：请在设置中更新 HTTPS 凭证或 SSH key（应用不会代填密钥）。',
  network: '网络不可达：请检查网络连接或远程地址后重试，或在设置中配置代理。',
  'non-fast-forward': '本地与远程历史不一致：可以让 Agent 帮你拉取合并，或选择以本地为准覆盖远程。',
  'no-remote': '当前分支未配置远程仓库：请在设置中添加远程地址。',
  'git-missing': '应用内捆绑 Git 不可用：请重新安装应用，或在设置中启用「使用系统 Git」。',
  unknown: '未能识别该同步问题：可以让 Agent 协助诊断，或在仓库目录查看 git status。',
};

export class GitSyncDoctorError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NO_VAULT'
      | 'INVALID_ACTION'
      | 'ACTION_NOT_ALLOWED'
      | 'INVALID_TICKET'
      | 'TICKET_EXPIRED'
      | 'ROOT_CHANGED'
      | 'STATE_DRIFT'
      | 'CONFLICT_PRESENT'
      | 'NO_OPERATION'
      | 'NO_AHEAD_TO_PRESERVE'
      | 'PRESERVE_LOCAL_FAILED'
      | 'STATUS_FAILED',
  ) {
    super(message);
    this.name = 'GitSyncDoctorError';
  }
}

interface DoctorTicket {
  root: string;
  action: GitRepairAction;
  snapshot: GitDoctorStatusSnapshot;
  fingerprint?: Awaited<ReturnType<GitService['doctorFingerprint']>>;
  expiresAt: number;
}

export interface GitSyncDoctorDeps {
  git: GitService;
  /** 可选：未配置 AI 时自动降级为规则解释（explanationSource: 'rules'）。 */
  ai?: Pick<AiService, 'chatCompletion'>;
  getRoot: () => string | null;
  now?: () => number;
  ttlMs?: number;
}

function snapshotOf(
  status: {
    branch: string | null;
    changed: number;
    ahead: number;
    behind: number;
    remote: string | null;
    conflict: boolean;
    rebaseInProgress?: boolean;
  },
  fingerprint?: Awaited<ReturnType<GitService['doctorFingerprint']>>,
): GitDoctorStatusSnapshot {
  const snapshot: GitDoctorStatusSnapshot = {
    branch: status.branch,
    changed: status.changed,
    ahead: status.ahead,
    behind: status.behind,
    remote: status.remote,
    conflict: status.conflict,
    rebaseInProgress: status.rebaseInProgress ?? false,
    ...(fingerprint ?? {}),
  };
  return snapshot;
}

function sameFiles(
  a: Array<{ path: string; sha256: string | null }>,
  b: Array<{ path: string; sha256: string | null }>,
): boolean {
  return (
    a.length === b.length &&
    a.every((file, index) => file.path === b[index]?.path && file.sha256 === b[index]?.sha256)
  );
}

type DoctorFingerprint = Awaited<ReturnType<GitService['doctorFingerprint']>>;

/** 诊断快照若带内容指纹则直接复用，避免 prepare 二次读仓库。 */
function fingerprintFromSnapshot(snapshot: GitDoctorStatusSnapshot): DoctorFingerprint | undefined {
  return snapshot.headOid !== undefined &&
    snapshot.porcelain !== undefined &&
    snapshot.files !== undefined &&
    snapshot.remoteOid !== undefined
    ? {
        headOid: snapshot.headOid,
        remoteOid: snapshot.remoteOid,
        porcelain: snapshot.porcelain,
        files: snapshot.files,
      }
    : undefined;
}

/** 发送给 AI 或渲染层之前剥离错误文本中的凭据/URL 细节。 */
export function sanitizeDiagnosticText(value: string): string {
  return sanitizeRemoteText(value).slice(0, 500);
}

/** 纯规则分类：状态码优先，其次错误文本启发式。冲突永远最先判定（不自动覆盖）。 */
export function classifySyncIssue(input: {
  repository: boolean;
  conflict: boolean;
  rebaseInProgress?: boolean;
  changed: number;
  ahead: number;
  behind: number;
  remote: string | null;
}): { category: GitSyncIssueCategory; code: string; message: string } {
  if (!input.repository)
    return { category: 'git-missing', code: 'NOT_A_REPOSITORY', message: '当前目录不是 Git 仓库' };
  // DEV-082: rebase/merge paused state surfaces before unmerged-index conflicts
  // because it covers the wider window where the user is locked out of
  // committing even though git status may not yet report unmerged entries.
  if (input.rebaseInProgress) {
    return {
      category: 'conflict',
      code: 'REBASE_IN_PROGRESS',
      message: '存在未完成的 rebase/merge',
    };
  }
  if (input.conflict)
    return { category: 'conflict', code: 'MERGE_CONFLICT', message: '存在未解决的合并冲突' };
  if (input.changed > 0)
    return {
      category: 'dirty',
      code: 'WORKTREE_DIRTY',
      message: `工作区有 ${input.changed} 个未提交变更`,
    };
  if (!input.remote)
    return { category: 'no-remote', code: 'NO_REMOTE', message: '当前分支未配置远程仓库' };
  if (input.ahead > 0 && input.behind > 0)
    return { category: 'non-fast-forward', code: 'DIVERGED', message: '本地与远程分支已分叉' };
  if (input.behind > 0 || input.ahead > 0)
    return {
      category: 'non-fast-forward',
      code: input.behind > 0 ? 'BEHIND_REMOTE' : 'AHEAD_REMOTE',
      message:
        input.behind > 0
          ? `远程有 ${input.behind} 个提交待拉取`
          : `本地有 ${input.ahead} 个提交待推送`,
    };
  return { category: 'unknown', code: 'SYNC_OK', message: '本地与远程同步正常' };
}

/** 从异常文本/错误码分类（statusFor 抛出时的兜底路径）。 */
export function classifySyncError(error: unknown): {
  category: GitSyncIssueCategory;
  code: string;
  message: string;
} {
  const text = sanitizeDiagnosticText(
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error),
  );
  const code = (error as { code?: string } | null)?.code;
  if (code === 'GIT_BINARY_MISSING' || /bundled Git|GIT_BINARY_MISSING|git binary/i.test(text))
    return { category: 'git-missing', code: 'GIT_BINARY_MISSING', message: 'Git 可执行文件不可用' };
  if (
    /Authentication failed|auth|credential|permission denied|403|could not read from remote/i.test(
      text,
    )
  )
    return { category: 'auth', code: 'AUTH_FAILED', message: '远程认证失败' };
  if (
    /network|timed? ?out|timeout|ENOTFOUND|EAI_AGAIN|could not resolve|connection refused|offline/i.test(
      text,
    )
  )
    return { category: 'network', code: 'NETWORK_ERROR', message: '网络不可达或远程超时' };
  if (/non-fast-forward|fetch first|rejected|divergent/i.test(text))
    return {
      category: 'non-fast-forward',
      code: 'PUSH_REJECTED',
      message: '推送被拒绝：远程包含本地没有的提交',
    };
  if (/CONFLICT|unmerged/i.test(text))
    return { category: 'conflict', code: 'MERGE_CONFLICT', message: '存在未解决的合并冲突' };
  return { category: 'unknown', code: code ?? 'UNKNOWN', message: text };
}

/** 规则层修复计划：conflict 永不自动修复。 */
function planFor(
  category: GitSyncIssueCategory,
  status: {
    changed: number;
    ahead: number;
    behind: number;
    remote: string | null;
    rebaseInProgress?: boolean;
  },
): {
  action: GitRepairAction | null;
  allowedAction: GitRepairAction | null;
  plan: Omit<GitRepairPlan, 'action' | 'commandPreview'> & { commandPreview: string | null };
} {
  const manual = {
    requiresConfirmation: false,
    safe: false,
    manualGuidance: MANUAL_GUIDANCE[category],
  };
  switch (category) {
    case 'conflict':
      // DEV-083: rebase/merge 暂停时的默认推荐动作改为「保留本地 ahead 提交并中止」。
      // 这避免了 `git rebase --abort` 把用户未推送的笔记提交也撤回的副作用——
      // 用户感知到的「内容被还原」正是这个根源。
      // 旧的 `abort-rebase-or-merge` 仍然保留在白名单里供显式降级使用。
      if (status.rebaseInProgress) {
        return {
          action: 'preserve-local-and-abort',
          allowedAction: 'preserve-local-and-abort',
          plan: {
            ...manual,
            requiresConfirmation: true,
            safe: true,
            commandPreview: COMMAND_PREVIEW['preserve-local-and-abort'],
          },
        };
      }
      return { action: null, allowedAction: null, plan: { ...manual, commandPreview: null } };
    case 'dirty':
      return {
        action: 'commit',
        allowedAction: 'commit',
        plan: {
          ...manual,
          requiresConfirmation: true,
          safe: true,
          commandPreview: COMMAND_PREVIEW.commit,
        },
      };
    case 'non-fast-forward':
      if (status.remote && status.ahead > 0 && status.behind > 0)
        return { action: null, allowedAction: null, plan: { ...manual, commandPreview: null } }; // 分叉必须人工
      if (status.remote && status.behind > 0 && status.changed === 0)
        return {
          action: 'pull',
          allowedAction: 'pull',
          plan: {
            ...manual,
            requiresConfirmation: true,
            safe: true,
            commandPreview: COMMAND_PREVIEW.pull,
          },
        };
      if (status.remote && status.ahead > 0 && status.behind === 0)
        return {
          action: 'push',
          allowedAction: 'push',
          plan: {
            ...manual,
            requiresConfirmation: true,
            safe: true,
            commandPreview: COMMAND_PREVIEW.push,
          },
        };
      return { action: null, allowedAction: null, plan: { ...manual, commandPreview: null } };
    default:
      return { action: null, allowedAction: null, plan: { ...manual, commandPreview: null } };
  }
}

/** 规则解释（AI 不可用时的降级文案）。 */
function ruleExplanation(issue: GitSyncIssue, snapshot: GitDoctorStatusSnapshot): string {
  const detail: string[] = [issue.message];
  if (snapshot.branch) detail.push(`当前分支 ${snapshot.branch}`);
  if (snapshot.changed > 0) detail.push(`${snapshot.changed} 个未提交文件`);
  if (snapshot.ahead > 0) detail.push(`领先远程 ${snapshot.ahead} 个提交`);
  if (snapshot.behind > 0) detail.push(`落后远程 ${snapshot.behind} 个提交`);
  if (!snapshot.remote && snapshot.branch) detail.push('未配置远程');
  return detail.join('；') + '。';
}

/**
 * 主进程 Git 同步诊断/修复编排：
 * - 诊断只读（dry-run），修复必须先 prepare（生成一次性 ticket）再显式 execute；
 * - AI 仅用于生成脱敏解释文案，从不解析为命令；未配置时规则降级；
 * - 禁止 reset --hard / clean / checkout -- . / push --force；冲突只列文件并引导人工。
 */
export class GitSyncDoctor {
  private readonly tickets = new Map<string, DoctorTicket>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(private readonly deps: GitSyncDoctorDeps) {
    this.now = deps.now ?? Date.now;
    this.ttlMs = deps.ttlMs ?? GIT_DOCTOR_TICKET_TTL_MS;
  }

  /** 只读诊断（dry-run）：不产生任何写操作。 */
  async diagnose(): Promise<GitDoctorDiagnosis> {
    const root = this.deps.getRoot();
    if (!root) {
      const snapshot: GitDoctorStatusSnapshot = {
        branch: null,
        changed: 0,
        ahead: 0,
        behind: 0,
        remote: null,
        conflict: false,
      };
      const issue: GitSyncIssue = {
        category: 'git-missing',
        code: 'NO_VAULT',
        message: '尚未打开任何知识库',
      };
      return {
        issue,
        plan: {
          action: null,
          commandPreview: null,
          requiresConfirmation: false,
          safe: false,
          manualGuidance: MANUAL_GUIDANCE.unknown,
        },
        conflictFiles: [],
        explanation: issue.message,
        explanationSource: 'rules',
        status: snapshot,
      };
    }
    let snapshot: GitDoctorStatusSnapshot;
    let classified: ReturnType<typeof classifySyncIssue>;
    let conflictFiles: string[] = [];
    try {
      const status = await this.deps.git.statusFor(root);
      [snapshot] = await this.captureSnapshot(root, status);
      classified = classifySyncIssue(status);
      conflictFiles = await this.conflictFiles(root, status.conflict);
    } catch (error) {
      const classifiedError = classifySyncError(error);
      snapshot = {
        branch: null,
        changed: 0,
        ahead: 0,
        behind: 0,
        remote: null,
        conflict: false,
      };
      classified = {
        category: classifiedError.category,
        code: classifiedError.code,
        message: classifiedError.message,
      };
    }
    const { action, plan } = planFor(classified.category, snapshot);
    const base = ruleExplanation(classified, snapshot);
    const ai = await this.explain(base, classified);
    return {
      issue: classified,
      plan: { action, ...plan },
      conflictFiles,
      explanation: ai.text,
      explanationSource: ai.source,
      status: snapshot,
    };
  }

  /**
   * 预览修复（仍不写仓库）：校验类别允许该 action 后签发一次性 ticket，
   * 绑定 root + 当前状态快照 + TTL。
   */
  async prepare(action: GitRepairAction): Promise<GitDoctorRepairPrepareResult> {
    if (!GIT_REPAIR_ACTIONS.includes(action))
      throw new GitSyncDoctorError(`不支持的修复操作: ${String(action)}`, 'INVALID_ACTION');
    const diagnosis = await this.diagnose();
    const { category, code } = diagnosis.issue;
    // DEV-082: REBASE_IN_PROGRESS keeps the user inside the conflict category
    // but the doctor offers a one-click abort — let prepare proceed so the
    // ticket pipeline can show the action button in the dialog.
    if (category === 'conflict' && code !== 'REBASE_IN_PROGRESS')
      throw new GitSyncDoctorError(
        '存在未解决的冲突：自动修复不会覆盖冲突文件，请人工解决后重新诊断',
        'CONFLICT_PRESENT',
      );
    const { allowedAction } = planFor(category, diagnosis.status);
    // DEV-083: REBASE_IN_PROGRESS 的 plan 默认推荐 preserve-local-and-abort，
    // 但弹窗同时提供 force-abort（用户显式放弃本地）与旧 abort 入口；
    // 三个 abort 系 action 都被允许签发票据，安全边界由 execute 的
    // TOCTOU + GitService 层保持。
    const abortFamily: readonly GitRepairAction[] = [
      'abort-rebase-or-merge',
      'preserve-local-and-abort',
      'force-abort-rebase-or-merge',
    ];
    const actionAllowed =
      allowedAction === action ||
      (code === 'REBASE_IN_PROGRESS' && abortFamily.includes(action));
    if (!actionAllowed)
      throw new GitSyncDoctorError(
        `当前问题（${category}）不允许执行 ${action}；${diagnosis.plan.manualGuidance}`,
        'ACTION_NOT_ALLOWED',
      );
    const root = this.deps.getRoot();
    if (!root) throw new GitSyncDoctorError('尚未打开任何知识库', 'NO_VAULT');
    const fingerprint = fingerprintFromSnapshot(diagnosis.status);
    this.sweepExpired();
    const ticket = randomUUID();
    this.tickets.set(ticket, {
      root,
      action,
      snapshot: diagnosis.status,
      ...(fingerprint ? { fingerprint } : {}),
      expiresAt: this.now() + this.ttlMs,
    });
    return { diagnosis, ticket, ticketExpiresAt: this.now() + this.ttlMs };
  }

  /**
   * 显式确认执行：ticket 一次性消费 + TTL + root/action/status 三重 TOCTOU 校验。
   * 只调用 GitService 既有安全路径（commitManual / pull / push），无其它命令入口。
   */
  async execute(ticket: string): Promise<GitDoctorRepairExecuteResult> {
    const entry = this.tickets.get(ticket);
    if (!entry) throw new GitSyncDoctorError('修复票据无效或已被使用', 'INVALID_TICKET');
    this.tickets.delete(ticket); // 一次性：无论成败都消费
    if (entry.expiresAt <= this.now())
      throw new GitSyncDoctorError('修复票据已过期，请重新诊断并确认', 'TICKET_EXPIRED');
    if (this.deps.getRoot() !== entry.root)
      throw new GitSyncDoctorError('知识库已切换，请重新诊断后重试', 'ROOT_CHANGED');
    // TOCTOU：execute 前重新取完整快照（含内容指纹），与 prepare 时不一致即拒绝。
    // statusFor 失败时以稳定错误码返回，避免原始异常消息经 IPC 暴露。
    let status;
    try {
      status = await this.deps.git.statusFor(entry.root);
    } catch {
      throw new GitSyncDoctorError('无法读取当前仓库状态，请重试', 'STATUS_FAILED');
    }
    const [snapshot, fingerprint] = await this.captureSnapshot(entry.root, status);
    const sameRootState =
      snapshot.branch === entry.snapshot.branch &&
      snapshot.changed === entry.snapshot.changed &&
      snapshot.ahead === entry.snapshot.ahead &&
      snapshot.behind === entry.snapshot.behind &&
      snapshot.remote === entry.snapshot.remote &&
      snapshot.conflict === entry.snapshot.conflict;
    const sameContent =
      entry.fingerprint !== undefined &&
      fingerprint !== undefined &&
      entry.fingerprint.headOid === fingerprint.headOid &&
      entry.fingerprint.remoteOid === fingerprint.remoteOid &&
      entry.fingerprint.porcelain === fingerprint.porcelain &&
      sameFiles(entry.fingerprint.files, fingerprint.files);
    // DEV-082/083: a rebase that ended on its own between prepare and execute
    // is the only drift we want to translate into NO_OPERATION rather than the
    // blanket STATE_DRIFT. Resolve that case first so users get an accurate
    // "already resolved" message instead of "you must re-diagnose".
    if (
      (entry.action === 'abort-rebase-or-merge' ||
        entry.action === 'preserve-local-and-abort' ||
        entry.action === 'force-abort-rebase-or-merge') &&
      !(snapshot.rebaseInProgress ?? false)
    )
      throw new GitSyncDoctorError(
        '当前已经没有进行中的 rebase/merge，无需中止',
        'NO_OPERATION',
      );
    if (!sameRootState || !sameContent)
      throw new GitSyncDoctorError('仓库状态在确认后发生了变化，请重新诊断', 'STATE_DRIFT');
    // DEV-082: a true unmerged-index conflict still aborts even for the abort
    // action — `git rebase --abort` may refuse to run when the user has staged
    // partial resolutions that diverge from the original HEAD, so refuse early.
    // DEV-083: preserve-local-and-abort still allows unmerged conflicts because
    // format-patch + git am --3way replays patches one at a time and quarantines
    // any failure into FAILED/ — the user can reconcile later.
    if (
      snapshot.conflict &&
      entry.action !== 'abort-rebase-or-merge' &&
      entry.action !== 'preserve-local-and-abort' &&
      entry.action !== 'force-abort-rebase-or-merge'
    )
      throw new GitSyncDoctorError('检测到未解决冲突，拒绝执行', 'CONFLICT_PRESENT');

    let message: string;
    let preserve: GitDoctorRepairExecuteResult['preserve'] | undefined;
    if (entry.action === 'commit') {
      await this.deps.git.commitManual('nexnote:doctor: 同步前保存本地变更');
      message = '已提交本地变更';
    } else if (entry.action === 'pull') {
      await this.deps.git.pull();
      message = '已拉取远程更新';
    } else if (entry.action === 'abort-rebase-or-merge') {
      await this.deps.git.abortInProgressRebaseOrMerge();
      message = '已中止未完成的 rebase/merge';
    } else if (entry.action === 'preserve-local-and-abort') {
      let result;
      try {
        result = await this.deps.git.preserveLocalAndAbortRebaseOrMerge();
      } catch (error) {
        if (error instanceof GitServiceError) {
          if (error.code === 'NO_OPERATION')
            throw new GitSyncDoctorError(error.message, 'NO_OPERATION');
          if (error.code === 'NO_AHEAD_TO_PRESERVE')
            throw new GitSyncDoctorError(error.message, 'NO_AHEAD_TO_PRESERVE');
          if (error.code === 'PRESERVE_LOCAL_FAILED')
            throw new GitSyncDoctorError(error.message, 'PRESERVE_LOCAL_FAILED');
        }
        throw error;
      }
      preserve = {
        aheadCount: result.aheadCount,
        exported: result.exported,
        replayed: result.replayed,
        failed: result.failed,
        recoveryDir: result.recoveryDir,
      };
      message = result.message;
    } else if (entry.action === 'force-abort-rebase-or-merge') {
      await this.deps.git.abortInProgressRebaseOrMerge();
      message = '已丢弃本地 ahead commits 并中止 rebase';
    } else {
      await this.deps.git.push();
      message = '已推送本地提交';
    }
    let after;
    try {
      after = await this.deps.git.statusFor(entry.root);
    } catch {
      throw new GitSyncDoctorError('修复已执行，但读取最新状态失败，请手动刷新', 'STATUS_FAILED');
    }
    const [afterSnapshot] = await this.captureSnapshot(entry.root, after);
    return { message, status: afterSnapshot, ...(preserve ? { preserve } : {}) };
  }

  /** 渲染层「忽略」：清空所有未消费票据。 */
  dismiss(): void {
    this.tickets.clear();
  }

  private async fingerprintOf(
    root: string,
  ): Promise<Awaited<ReturnType<GitService['doctorFingerprint']>> | undefined> {
    try {
      return await this.deps.git.doctorFingerprint(root);
    } catch {
      return undefined; // 无指纹 → execute 一律拒绝（fail-closed）
    }
  }

  /**
   * 组装快照并附加内容绑定指纹；指纹抓取失败时按无指纹处理（execute 会拒绝）。
   * 指纹只含 OID、porcelain 状态行与文件 sha256，绝不包含文件内容或凭据。
   */
  private async captureSnapshot(
    root: string,
    status: Awaited<ReturnType<GitService['statusFor']>>,
  ): Promise<
    [GitDoctorStatusSnapshot, Awaited<ReturnType<GitService['doctorFingerprint']>> | undefined]
  > {
    if (!status.repository)
      return [snapshotOf(status), { headOid: null, remoteOid: null, porcelain: '', files: [] }];
    try {
      const fingerprint = await this.deps.git.doctorFingerprint(root);
      return [snapshotOf(status, fingerprint), fingerprint];
    } catch {
      return [snapshotOf(status), undefined];
    }
  }

  /** 冲突文件列表（unmerged index + 冲突标记文件），只读。 */
  private async conflictFiles(root: string, conflict: boolean): Promise<string[]> {
    if (!conflict) return [];
    try {
      const output = await this.deps.git.rawStatusPorcelain(root);
      return output;
    } catch {
      return [];
    }
  }

  /** AI 解释（脱敏输入，纯文本输出；失败/未配置 → 规则降级）。 */
  private async explain(
    base: string,
    issue: GitSyncIssue,
  ): Promise<{ text: string; source: 'ai' | 'rules' }> {
    if (!this.deps.ai) return { text: base, source: 'rules' };
    try {
      const result = await this.deps.ai.chatCompletion({
        feature: 'chat',
        messages: [
          {
            role: 'user',
            content:
              `你是笔记应用的同步助手。用一两句简体中文向用户解释下面这个 Git 同步问题的影响，` +
              `并给出安全的下一步建议。只输出解释文字；不要输出任何命令、代码或 JSON；` +
              `不要请求或猜测任何凭据。问题：${issue.category}（${issue.code}）；状态：${base}`,
          },
        ],
      });
      const text = result.content.trim();
      // 防御：若模型仍返回了命令样式文本，丢弃并降级为规则文案。
      if (
        !text ||
        /\b(git\s+\w+|rm\s+-rf|reset\s+--hard|checkout\s+--|clean\b)/i.test(text) ||
        text.length > 800
      )
        return { text: base, source: 'rules' };
      return { text: sanitizeDiagnosticText(text), source: 'ai' };
    } catch {
      return { text: base, source: 'rules' };
    }
  }

  private sweepExpired(): void {
    const now = this.now();
    for (const [ticket, entry] of this.tickets)
      if (entry.expiresAt <= now) this.tickets.delete(ticket);
  }
}
