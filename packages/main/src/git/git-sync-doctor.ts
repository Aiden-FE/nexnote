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
import type { AiService } from '../ai/ai-service';

/** 修复票据 TTL：预览到显式确认执行之间的最大窗口。 */
export const GIT_DOCTOR_TICKET_TTL_MS = 5 * 60_000;
export const GIT_REPAIR_ACTIONS: readonly GitRepairAction[] = ['commit', 'pull', 'push'];

/**
 * 白名单：doctor 只可能执行这三条等价操作（经 GitService 既有安全路径）。
 * 任何破坏性命令（reset --hard / clean / checkout -- . / push --force）都没有入口。
 */
const COMMAND_PREVIEW: Record<GitRepairAction, string> = {
  commit: 'git add -A && git commit（仅当前 vault）',
  pull: 'git pull --no-rebase（拒绝脏工作区）',
  push: 'git push（普通推送，从不 force）',
};

const MANUAL_GUIDANCE: Record<GitSyncIssueCategory, string> = {
  conflict:
    '存在未解决的合并冲突：AI 与自动修复都不会覆盖冲突文件，请在仓库目录中逐文件人工解决后重新同步。',
  dirty: '工作区有未提交变更：可先提交，或手动 stash 后再同步。',
  auth: '远程认证失败：请检查 HTTPS 凭证或 SSH key（可在系统凭据管理器 / ssh-agent 中更新），应用不会代填密钥。',
  network: '网络不可达：请检查网络连接或远程地址后重试。',
  'non-fast-forward': '本地与远程历史不一致：先拉取合并（或人工在终端 rebase），再推送。',
  'no-remote': '当前分支未配置远程仓库：请在设置中添加远程地址。',
  'git-missing': '应用内捆绑 Git 不可用：请重新安装应用，或在设置中启用「使用系统 Git」。',
  unknown: '未能识别该同步问题：请手动检查仓库状态（git status / git log）。',
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
      | 'CONFLICT_PRESENT',
  ) {
    super(message);
    this.name = 'GitSyncDoctorError';
  }
}

interface DoctorTicket {
  root: string;
  action: GitRepairAction;
  snapshot: GitDoctorStatusSnapshot;
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

function snapshotOf(status: {
  branch: string | null;
  changed: number;
  ahead: number;
  behind: number;
  remote: string | null;
  conflict: boolean;
}): GitDoctorStatusSnapshot {
  return {
    branch: status.branch,
    changed: status.changed,
    ahead: status.ahead,
    behind: status.behind,
    remote: status.remote,
    conflict: status.conflict,
  };
}

/** 发送给 AI 或渲染层之前剥离错误文本中的凭据/URL 细节。 */
export function sanitizeDiagnosticText(value: string): string {
  return (
    value
      // userinfo 凭据：https://user:token@host → https://***@host
      .replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):[^\s/@]+@/gi, '$1***@')
      // token/password/secret 形式的键值对
      .replace(/\b(token|password|passwd|secret|api[_-]?key)\b\s*[=:]\s*\S+/gi, '$1=***')
      // SSH 用户名@主机保留协议性信息但去掉路径查询
      .replace(/([?&](?:access_token|token|password|passwd|secret)=)[^\s&#]+/gi, '$1***')
      .slice(0, 500)
  );
}

/** 纯规则分类：状态码优先，其次错误文本启发式。冲突永远最先判定（不自动覆盖）。 */
export function classifySyncIssue(input: {
  repository: boolean;
  conflict: boolean;
  changed: number;
  ahead: number;
  behind: number;
  remote: string | null;
}): { category: GitSyncIssueCategory; code: string; message: string } {
  if (!input.repository)
    return { category: 'git-missing', code: 'NOT_A_REPOSITORY', message: '当前目录不是 Git 仓库' };
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
        message: '尚未打开任何 vault',
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
      snapshot = snapshotOf(status);
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
    const { category } = diagnosis.issue;
    if (category === 'conflict')
      throw new GitSyncDoctorError(
        '存在未解决的冲突：自动修复不会覆盖冲突文件，请人工解决后重新诊断',
        'CONFLICT_PRESENT',
      );
    const { allowedAction } = planFor(category, diagnosis.status);
    if (allowedAction !== action)
      throw new GitSyncDoctorError(
        `当前问题（${category}）不允许执行 ${action}；${diagnosis.plan.manualGuidance}`,
        'ACTION_NOT_ALLOWED',
      );
    const root = this.deps.getRoot();
    if (!root) throw new GitSyncDoctorError('尚未打开任何 vault', 'NO_VAULT');
    this.sweepExpired();
    const ticket = randomUUID();
    this.tickets.set(ticket, {
      root,
      action,
      snapshot: diagnosis.status,
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
      throw new GitSyncDoctorError('vault 已切换，请重新诊断后重试', 'ROOT_CHANGED');
    const current = await this.deps.git.statusFor(entry.root);
    const snapshot = snapshotOf(current);
    const sameRootState =
      snapshot.branch === entry.snapshot.branch &&
      snapshot.changed === entry.snapshot.changed &&
      snapshot.ahead === entry.snapshot.ahead &&
      snapshot.behind === entry.snapshot.behind &&
      snapshot.remote === entry.snapshot.remote &&
      snapshot.conflict === entry.snapshot.conflict;
    if (!sameRootState)
      throw new GitSyncDoctorError('仓库状态在确认后发生了变化，请重新诊断', 'STATE_DRIFT');
    if (snapshot.conflict)
      throw new GitSyncDoctorError('检测到未解决冲突，拒绝执行', 'CONFLICT_PRESENT');

    let message: string;
    if (entry.action === 'commit') {
      await this.deps.git.commitManual('nexnote:doctor: 同步前保存本地变更');
      message = '已提交本地变更';
    } else if (entry.action === 'pull') {
      await this.deps.git.pull();
      message = '已拉取远程更新';
    } else {
      await this.deps.git.push();
      message = '已推送本地提交';
    }
    const after = snapshotOf(await this.deps.git.statusFor(entry.root));
    return { message, status: after };
  }

  /** 渲染层「忽略」：清空所有未消费票据。 */
  dismiss(): void {
    this.tickets.clear();
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
