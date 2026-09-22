import { createHash } from 'node:crypto';
import { constants, mkdirSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit, type SimpleGit } from 'simple-git';
import { resolveInstalledGitRuntime, type GitRuntimeResolution } from './git-runtime';
import { isDocumentPath } from '../document/document-domain';
import { safeVaultPath } from '../vault/vault-manager';
import type {
  GitCommit,
  GitOperationResult,
  GitRemote,
  GitRestorePreview,
  GitStatus,
} from '@nexnote/shared';

const AUTO_PREFIX = 'nexnote:auto:';
const MANUAL_PREFIX = 'nexnote:manual:';
const RESTORE_PREFIX = 'nexnote:restore:';
const INITIAL_MESSAGE = 'nexnote:init: 知识库初始化';
export const DEFAULT_DEBOUNCE_MS = 30_000;
export const MIN_COMMIT_INTERVAL_MS = 2_000;
/** 编辑器防抖窗口允许的最小/最大范围（用户配置受此约束）。 */
export const DEBOUNCE_RANGE_MS = { min: 500, max: 10 * 60_000 };
/** 校验并修正用户传入的 debounce 毫秒数（公开给 main IPC 与 settings 校验）。 */
export function normalizeDebounceMs(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_DEBOUNCE_MS;
  return Math.min(DEBOUNCE_RANGE_MS.max, Math.max(DEBOUNCE_RANGE_MS.min, Math.round(n)));
}

const VERSIONED_NEXNOTE_FILES: readonly string[] = [];
const OS_METADATA_FILES = ['.DS_Store', 'Thumbs.db', 'desktop.ini'] as const;
const VERSIONED_NEXNOTE_PATHS = VERSIONED_NEXNOTE_FILES.map((file) => `.nexnote/${file}`);
const OS_METADATA_FILES_LOWER = OS_METADATA_FILES.map((file) => file.toLowerCase());

export function isVaultSyncGuardedPath(file: string): boolean {
  // Git emits '/' separators on every platform; a backslash can be a literal
  // filename character on Unix, so do not reinterpret it as a directory here.
  // DEV-083/ADR-0016: `.nexnote/` 整目录默认 ignore，UI/config 状态不再跨设备同步。
  // 同步护栏只阻断 OS 临时文件与 `.nexnote/` 下所有运行时产物。
  const normalized = file.replace(/^\.\//, '');
  const segments = normalized.toLowerCase().split('/');
  if (segments.some((segment) => OS_METADATA_FILES_LOWER.includes(segment))) return true;
  return segments[0] === '.nexnote' && !VERSIONED_NEXNOTE_PATHS.includes(normalized);
}

export class GitServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'GitServiceError';
  }
}

export interface GitServiceOptions {
  /** 生产默认使用 dugite 的嵌入式 Git；因安装损坏不可用时仅开发环境退回系统 Git。 */
  useSystemGit?: boolean;
  /**
   * 是否允许在 bundled Git 不可用时回退 PATH 系统 Git。
   * 应用入口以 !app.isPackaged 传入：开发 checkout（fresh install 下载失败/离线）可继续调试；
   * 打包产物默认 fail-closed，避免用户机静默依赖不确定的 PATH Git。
   */
  allowSystemGitFallback?: boolean;
  defaultDebounceMs?: number;
  minCommitIntervalMs?: number;
}

export interface SyncProgressEvent {
  phase: 'fetching' | 'rebasing' | 'merging' | 'pushing' | 'done' | 'error';
  message?: string;
}

export interface SyncOptions {
  strategy: 'rebase' | 'merge';
  onProgress?: (event: SyncProgressEvent) => void;
}

/** DEV-073：一键同步 — fetch → 按策略合并 → push（仅当 ahead>0）。返回最新状态。 */
export interface SyncResult {
  message: string;
  status: GitStatus;
}

/** DEV-083：保留本地 ahead commits 并中止 rebase 的统计结果。 */
export interface PreserveLocalAbortResult {
  message: string;
  root: string;
  /** 探测到的 ahead commit 数（rebase orig-head 到 HEAD 之间）。 */
  aheadCount: number;
  /** 实际写入恢复目录的 patch 文件数。 */
  exported: number;
  /** 成功 `git am` 回放的 patch 数。 */
  replayed: number;
  /** 回放失败的 patch 文件名（已移到 `<recoveryDir>/FAILED/`）。 */
  failed: string[];
  /** vault 相对路径，便于 UI 提示用户前往 reconcile。 */
  recoveryDir: string;
}

export interface GitHistoryEvent {
  date: string;
  additions: number;
  deletions: number;
}

export interface GitFileHistory {
  commits: number;
  authors: number;
  firstCommitAt: string;
  lastCommitAt: string;
  events: GitHistoryEvent[];
}

export type GitFileHistoryIndex = Map<string, GitFileHistory>;

/**
 * Vault-scoped Git orchestration. This is deliberately the only main-process
 * module that invokes git: renderer code only receives typed IPC data.
 */
/**
 * 宿主 shell 可能遗留、且会触发 simple-git block-unsafe-operations 拦截的环境变量。
 * 这里只剥离 NexNote 内部 Git 操作用不到的：交互式编辑器、外部 diff/代理命令、
 * GIT_CONFIG_COUNT 环境配置注入。SSH 相关变量（GIT_SSH、GIT_SSH_COMMAND、
 * GIT_ASKPASS、SSH_ASKPASS）不剥离——vault 远程同步依赖用户的 SSH 配置，
 * 改由下方 unsafe 豁免放行。
 */
const GIT_HOST_ENV_STRIP_VARS = [
  'GIT_EDITOR',
  'GIT_SEQUENCE_EDITOR',
  'EDITOR',
  'GIT_PROXY_COMMAND',
  'GIT_EXTERNAL_DIFF',
  'GIT_CONFIG_COUNT',
] as const;

/** 剥离宿主遗留的交互式/外部工具变量，避免 simple-git 安全拦截阻断 vault 初始化。 */
export function sanitizeGitProcessEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env };
  for (const key of GIT_HOST_ENV_STRIP_VARS) delete result[key];
  return result;
}

export class GitService {
  private root: string | null = null;
  private useSystemGit: boolean;
  private readonly allowSystemGitFallback: boolean;
  private systemFallbackWarned = false;
  private readonly defaultDebounceMs: number;
  private readonly minCommitIntervalMs: number;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCommitAt = 0;
  private statusListener: ((status: GitStatus) => void) | null = null;
  private commitListener: ((root: string, files: string[]) => void) | null = null;
  private syncProgressListener: ((event: SyncProgressEvent) => void) | null = null;
  /** 当前生效的自动提交防抖窗口。setDebounceMs 写入；fs handler 同步读它。 */
  private debounceMs: number;
  /** DEV-072：本进程生命周期内的网络代理配置；从 SettingsService 注入。 */
  private networkProxyEnv: NodeJS.ProcessEnv | null = null;
  private networkCliConfig: string[] | null = null;
  /** DEV-073：定时自动同步计时器（vault 活跃时按 vault 配置触发 sync）。 */
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null;
  private autoSyncIntervalSec = 0;
  private autoSyncStrategy: 'rebase' | 'merge' = 'rebase';

  /**
   * 分支绑定的上游远程；`branch.<name>.remote` 显式配置优先，
   * 其次解析 tracking（origin/main → origin），最后回退 origin。
   */
  private async branchRemote(git: SimpleGit, branch: string): Promise<string | null> {
    try {
      const configured = (await git.raw(['config', `branch.${branch}.remote`])).trim();
      if (configured) return configured;
    } catch {
      // no upstream configured; fall through to tracking/origin
    }
    const status = await git.status();
    if (status.tracking) {
      const slash = status.tracking.indexOf('/');
      if (slash > 0) return status.tracking.slice(0, slash);
    }
    const remotes = await git.getRemotes();
    return remotes.some((r) => r.name === 'origin') ? 'origin' : (remotes[0]?.name ?? null);
  }

  constructor(options: GitServiceOptions = {}) {
    this.useSystemGit = options.useSystemGit ?? false;
    this.allowSystemGitFallback = options.allowSystemGitFallback ?? false;
    this.defaultDebounceMs = normalizeDebounceMs(options.defaultDebounceMs ?? DEFAULT_DEBOUNCE_MS);
    this.minCommitIntervalMs = options.minCommitIntervalMs ?? MIN_COMMIT_INTERVAL_MS;
    this.debounceMs = this.defaultDebounceMs;
  }

  setRoot(root: string | null): void {
    if (this.root !== root) this.cancelAutoCommit();
    this.root = root;
  }

  setUseSystemGit(enabled: boolean): void {
    this.useSystemGit = enabled;
    this.systemFallbackWarned = false;
  }

  /** DEV-072：注入代理配置。applyToGit=false 或 mode=off 时传 null 清空。 */
  setNetworkProxy(input: { env: NodeJS.ProcessEnv | null; cliConfig: string[] | null }): void {
    this.networkProxyEnv = input.env;
    this.networkCliConfig = input.cliConfig;
  }

  /** DEV-073：注册同步进度事件监听。 */
  onSyncProgress(listener: ((event: SyncProgressEvent) => void) | null): void {
    this.syncProgressListener = listener;
  }

  /** DEV-073：配置自动同步。intervalSec=0 关闭；网络失败自动退避（指数递增到 4×interval）。 */
  configureAutoSync(intervalSec: number, strategy: 'rebase' | 'merge'): void {
    this.autoSyncIntervalSec = Math.max(0, Math.round(intervalSec));
    this.autoSyncStrategy = strategy;
    if (this.autoSyncTimer) clearInterval(this.autoSyncTimer);
    this.autoSyncTimer = null;
    if (this.autoSyncIntervalSec <= 0) return;
    let backoff = 1;
    this.autoSyncTimer = setInterval(
      () => {
        if (!this.root) return;
        void this.sync({
          strategy: this.autoSyncStrategy,
          onProgress: this.syncProgressListener ?? undefined,
        }).then(
          () => {
            backoff = 1;
          },
          () => {
            backoff = Math.min(backoff * 2, 4);
          },
        );
      },
      this.autoSyncIntervalSec * 1000 * backoff,
    );
  }

  stopAutoSync(): void {
    if (this.autoSyncTimer) clearInterval(this.autoSyncTimer);
    this.autoSyncTimer = null;
    this.autoSyncIntervalSec = 0;
  }

  /** 实际生效的 Git 是否来自系统 PATH（含开发环境 payload 缺失的回退）。 */
  effectiveUsesSystemGit(): boolean {
    return (
      resolveInstalledGitRuntime({
        useSystemGit: this.useSystemGit,
        allowSystemFallback: this.allowSystemGitFallback,
      }).source === 'system'
    );
  }

  /** 读取当前自动提交防抖窗口。 */
  getDebounceMs(): number {
    return this.debounceMs;
  }

  /**
   * 设置自动提交防抖窗口（毫秒）。接受任意输入并通过 normalizeDebounceMs 收敛到合法区间，
   * 让 IPC handler 在校验失败时仍能稳定运行（返回修正后的值）。
   */
  setDebounceMs(input: number | unknown): number {
    const next = normalizeDebounceMs(input);
    this.debounceMs = next;
    return next;
  }

  /**
   * Register a listener notified whenever repository state meaningfully changes
   * (writes, commits, remote updates, sync, restore). Handlers use this to push
   * `git:statusChanged` to the renderer without each caller knowing about windows.
   */
  onStatusChanged(listener: ((status: GitStatus) => void) | null): void {
    this.statusListener = listener;
  }

  /** Confidence recalculates the pages touched by a completed local commit. */
  onCommitted(listener: ((root: string, files: string[]) => void) | null): void {
    this.commitListener = listener;
  }

  async isRepository(root: string, runtime?: GitRuntimeResolution): Promise<boolean> {
    try {
      // simple-git discovery walks upward; a vault nested inside another repository
      // must not accidentally operate on that parent repository.
      const topLevel = (await this.git(root, runtime).raw(['rev-parse', '--show-toplevel'])).trim();
      const [realTopLevel, realRoot] = await Promise.all([
        fsp.realpath(topLevel).catch(() => path.resolve(topLevel)),
        fsp.realpath(root).catch(() => path.resolve(root)),
      ]);
      return realTopLevel === realRoot;
    } catch {
      return false;
    }
  }

  async initialize(root: string): Promise<GitOperationResult> {
    const safe = await safeVaultPath(root);
    const git = this.git(safe);
    if (!(await this.isRepository(safe))) await git.init();
    await this.ensureSyncGuard(safe);
    await this.commit(safe, INITIAL_MESSAGE);
    const result = {
      message: 'Git 仓库已初始化并创建初始提交',
      status: await this.statusFor(safe),
    };
    this.notifyStatus(result.status);
    return result;
  }

  /** fs write path calls this; it never commits synchronously on the editor hot path. */
  scheduleAutoCommit(summary = '保存页面', debounceMs?: number): void {
    // Per-call overrides are subject to the same safety floor as persisted settings.
    const ms = debounceMs === undefined ? this.debounceMs : normalizeDebounceMs(debounceMs);
    this.cancelAutoCommit();
    this.autoTimer = setTimeout(
      () => {
        void this.commitAuto(summary).catch(() => undefined);
      },
      Math.max(0, ms),
    );
  }

  cancelAutoCommit(): void {
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
  }

  async commitAuto(summary = '保存页面'): Promise<void> {
    this.autoTimer = null;
    const root = this.requireRoot();
    // A paused rebase/merge must never receive another layout commit: doing so
    // is what scrambled the todo list and stacked unstaged changes on top of
    // the conflict. Surface status so the UI shows the rebase badge instead.
    if (await this.isRebaseOrMergeInProgress(root)) {
      await this.notifyCurrentStatus();
      return;
    }
    const wait = this.minCommitIntervalMs - (Date.now() - this.lastCommitAt);
    if (wait > 0) {
      this.autoTimer = setTimeout(() => void this.commitAuto(summary).catch(() => undefined), wait);
      return;
    }
    const git = this.git(root);
    const status = await git.status();
    if (this.hasUnresolvedConflict(status) || (await this.hasConflictMarkers(root, status))) {
      await this.notifyCurrentStatus();
      return;
    }
    // Skip a layout-only auto-commit when the versioned config/layout blobs are
    // already byte-identical to HEAD. This stops the recurring pattern of many
    // "保存知识库布局" commits that rewrite config.json without a real change.
    if (await this.versionedConfigAlreadyAtHead(root, summary)) {
      await this.notifyCurrentStatus();
      return;
    }
    await this.commit(root, `${AUTO_PREFIX} ${cleanSummary(summary)}`);
    await this.notifyCurrentStatus();
  }

  async commitManual(message: string): Promise<GitOperationResult> {
    const root = this.requireRoot();
    const text = cleanSummary(message);
    if (!text) throw new GitServiceError('提交说明不能为空', 'EMPTY_MESSAGE');
    if (await this.isRebaseOrMergeInProgress(root)) {
      throw new GitServiceError(
        '存在未完成的 rebase/merge，请先在同步面板中止或继续后再提交',
        'REBASE_IN_PROGRESS',
      );
    }
    await this.commit(root, `${MANUAL_PREFIX} ${text}`);
    const result = { message: '已创建手动提交', status: await this.statusFor(root) };
    this.notifyStatus(result.status);
    return result;
  }

  /**
   * Abort a paused rebase or merge. Only callable through a doctor ticket after
   * TOCTOU validation — never exposed directly to the renderer. Neither
   * `rebase --abort` nor `merge --abort` touches worktree files; both restore
   * the pre-operation HEAD and index.
   */
  async abortInProgressRebaseOrMerge(): Promise<GitOperationResult> {
    const root = this.requireRoot();
    const git = this.git(root);
    const [hasRebase, hasMerge] = await Promise.all([
      this.hasGitDirEntry(root, 'rebase-merge').then((v) =>
        v ? true : this.hasGitDirEntry(root, 'rebase-apply'),
      ),
      this.hasGitDirEntry(root, 'MERGE_HEAD'),
    ]);
    if (hasRebase) {
      await git.raw(['rebase', '--abort']);
    } else if (hasMerge) {
      await git.raw(['merge', '--abort']);
    } else {
      throw new GitServiceError('当前没有进行中的 rebase 或 merge', 'NO_OPERATION');
    }
    return this.notified({ message: '已中止未完成的 rebase/merge', root });
  }

  /**
   * DEV-083：保留本地 ahead commits 并中止 rebase/merge。流程：
   *  1. 从 rebase-merge/orig-head 读出 rebase 起点 `baseSha`；
   *  2. 用 `git format-patch baseSha..HEAD` 把 ahead commits 导出到
   *     `.nexnote/.rebase-recovery/<timestamp>/`（该目录受 `.nexnote/` ignore
   *     保护，不会再次被纳入版本化）；
   *  3. `git rebase --abort` 回退 HEAD 与索引；
   *  4. `git am --3way` 按序回放 patches；任何 3-way 应用失败的 patch 写入
   *     `<timestamp>/FAILED/` 目录供用户后续 reconcile，绝不中断整体流程。
   *  返回导出与回放的统计信息，便于 UI 显式告知「已保留 N 个笔记提交」。
   */
  async preserveLocalAndAbortRebaseOrMerge(): Promise<PreserveLocalAbortResult> {
    const root = this.requireRoot();
    const git = this.git(root);
    const rebaseMergeDir = await this.resolveGitDirEntry(root, 'rebase-merge');
    const rebaseApplyDir = await this.resolveGitDirEntry(root, 'rebase-apply');
    const isRebase = Boolean(rebaseMergeDir) || Boolean(rebaseApplyDir);
    const hasMerge = await this.hasGitDirEntry(root, 'MERGE_HEAD');
    if (!isRebase && !hasMerge) {
      throw new GitServiceError(
        '当前没有进行中的 rebase 或 merge，无需保留',
        'NO_OPERATION',
      );
    }

    // orig-head 指向 rebase 开始前的 HEAD；merge 没有等价物，按 MERGE_HEAD
    // 退一步取 HEAD~0 直接放弃本地未提交变更。
    let baseSha: string;
    if (isRebase) {
      const baseFile = path.join(rebaseMergeDir ?? rebaseApplyDir!, 'orig-head');
      baseSha = (await fsp.readFile(baseFile, 'utf8')).trim();
    } else {
      // merge state 下保留本地 ahead commits 语义不清晰，直接中止并把 ahead
      // 留给 doctor 用户在 doctor 之外通过 commit/push 自行处理。
      await git.raw(['merge', '--abort']);
      await this.notified({
        message: '已中止 merge（merge 状态无法保留本地 commit）',
        root,
      });
      return {
        message: '已中止 merge（merge 状态无法保留本地 commit）',
        root,
        aheadCount: 0,
        exported: 0,
        replayed: 0,
        failed: [],
        recoveryDir: '',
      };
    }

    const aheadShas = (await git.raw(['rev-list', `${baseSha}..HEAD`, '--reverse']))
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    if (aheadShas.length === 0) {
      // 没有 ahead commit 也要把 rebase abort 掉（doctor 仍然需要恢复）。
      await git.raw(['rebase', '--abort']);
      throw new GitServiceError(
        '没有本地未推送的提交需要保留',
        'NO_AHEAD_TO_PRESERVE',
      );
    }

    const safe = await safeVaultPath(root);
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace(/Z$/, '');
    const recoveryDir = path.join(safe, '.nexnote', '.rebase-recovery', timestamp);
    await fsp.mkdir(recoveryDir, { recursive: true });

    let exported = 0;
    let replayed = 0;
    const failed: string[] = [];

    try {
      // 1. 导出 patches 到隔离 index（避免污染当前索引）
      const tempIndex = await fsp.mkdtemp(path.join(tmpdir(), 'nexnote-format-patch-'));
      try {
        const isolated = this.git(root, this.resolveRuntime(), {
          GIT_INDEX_FILE: path.join(tempIndex, 'index'),
        });
        await isolated.raw(['read-tree', 'HEAD']);
        const patchOutput = await isolated.raw([
          'format-patch',
          '-o',
          recoveryDir,
          `${baseSha}..HEAD`,
        ]);
        exported = patchOutput
          .split('\n')
          .filter((line) => line.startsWith(recoveryDir))
          .length;
        if (exported === 0) {
          // simple-git 不带绝对路径前缀，靠统计文件数兜底
          const entries = await fsp.readdir(recoveryDir);
          exported = entries.filter((name) => name.endsWith('.patch')).length;
        }
      } finally {
        await fsp.rm(tempIndex, { recursive: true, force: true });
      }

      // 2. 中止 rebase（恢复 HEAD 与索引到 baseSha）
      await git.raw(['rebase', '--abort']);

      // 3. 按序回放 patches；失败的移到 FAILED/ 子目录并跳过
      const patches = (await fsp.readdir(recoveryDir))
        .filter((name) => name.endsWith('.patch'))
        .sort();
      const failedDir = path.join(recoveryDir, 'FAILED');
      for (const patchFile of patches) {
        const patchPath = path.join(recoveryDir, patchFile);
        try {
          await git.raw(['am', '--3way', patchPath]);
          replayed += 1;
        } catch {
          failed.push(patchFile);
          // 回滚 am 的部分状态：把已被应用的回退到 working tree
          try {
            await git.raw(['am', '--abort']);
          } catch {
            /* 没有 am 状态时忽略 */
          }
          await fsp.mkdir(failedDir, { recursive: true });
          await fsp.rename(patchPath, path.join(failedDir, patchFile)).catch(() => undefined);
        }
      }
    } catch (error) {
      throw new GitServiceError(
        `保留本地提交失败：${errorMessage(error)}`,
        'PRESERVE_LOCAL_FAILED',
      );
    }

    const message =
      failed.length > 0
        ? `已保留 ${exported} 个提交（${replayed} 已回放，${failed.length} 待 reconcile）`
        : `已保留 ${exported} 个提交（全部回放成功）`;
    return {
      message,
      root,
      aheadCount: aheadShas.length,
      exported,
      replayed,
      failed,
      recoveryDir: path.relative(safe, recoveryDir),
    };
  }

  /** `git rev-parse --git-dir` 的绝对路径或 `null`（不存在）。 */
  private async resolveGitDirEntry(root: string, name: string): Promise<string | null> {
    const git = this.git(root);
    const gitDirRaw = await git.raw(['rev-parse', '--git-dir']).catch(() => '');
    const gitDir = gitDirRaw.trim();
    if (!gitDir) return null;
    const base = path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir);
    try {
      await fsp.access(path.join(base, name));
      return base;
    } catch {
      return null;
    }
  }

  private async hasGitDirEntry(root: string, name: string): Promise<boolean> {
    const git = this.git(root);
    const gitDirRaw = await git.raw(['rev-parse', '--git-dir']).catch(() => '');
    const gitDir = gitDirRaw.trim();
    if (!gitDir) return false;
    const base = path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir);
    return fsp
      .access(path.join(base, name))
      .then(() => true)
      .catch(() => false);
  }

  /**
   * True when a layout auto-commit has no actual tracked-file changes left by the
   * time the debounce fires. After DEV-083/ADR-0016 `.nexnote/config.json` and
   * `.nexnote/layout.json` are no longer tracked, so layout-only timer firings
   * produce an empty `git diff --name-only` and can be skipped without losing any
   * committed state.
   */
  private async versionedConfigAlreadyAtHead(root: string, summary: string): Promise<boolean> {
    if (summary !== '保存知识库布局') return false;
    const git = this.git(root);
    const hasHead = Boolean(
      (await git.raw(['rev-parse', '--verify', 'HEAD']).catch(() => '')).trim(),
    );
    if (!hasHead) return false;
    const modified = (await git.raw(['diff', '--name-only', '-z', '--no-renames']))
      .split('\0')
      .filter(Boolean);
    const untracked = (await git.raw(['ls-files', '-z', '--others', '--exclude-standard']))
      .split('\0')
      .filter(Boolean);
    return modified.length === 0 && untracked.length === 0;
  }

  async status(): Promise<GitStatus> {
    return this.statusFor(this.requireRoot());
  }

  /** Content-bound, read-only fingerprint for Git doctor ticket TOCTOU checks. */
  async doctorFingerprint(root: string): Promise<{
    headOid: string | null;
    remoteOid: string | null;
    porcelain: string;
    files: Array<{ path: string; sha256: string | null }>;
  }> {
    const runtime = this.resolveRuntime();
    const git = this.git(root, runtime);
    if (!(await this.isRepository(root, runtime)))
      return { headOid: null, remoteOid: null, porcelain: '', files: [] };
    const headOid = (await git.revparse('HEAD').catch(() => '')).trim() || null;
    const branch = (await git.revparse(['--abbrev-ref', 'HEAD']).catch(() => '')).trim();
    let remoteOid: string | null = null;
    if (branch && branch !== 'HEAD') {
      const remote = (await this.branchRemote(git, branch))?.trim();
      if (remote)
        remoteOid =
          (await git.revparse(`refs/remotes/${remote}/${branch}`).catch(() => '')).trim() || null;
    }
    const porcelain = await git.raw(['status', '--porcelain=v1']);
    const paths = porcelain
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.slice(3).replace(/\\/g, '/'));
    const files = await Promise.all(
      paths.map(async (filePath) => {
        try {
          const bytes = await fsp.readFile(path.join(root, filePath));
          return { path: filePath, sha256: createHash('sha256').update(bytes).digest('hex') };
        } catch {
          return { path: filePath, sha256: null };
        }
      }),
    );
    return { headOid, remoteOid, porcelain, files };
  }

  /** Doctor 只读获取 porcelain 冲突文件列表；不暴露 git 命令给 renderer。 */
  async rawStatusPorcelain(root: string): Promise<string[]> {
    const output = await this.git(root).raw(['status', '--porcelain=v1', '-z']);
    const files: string[] = [];
    for (const item of output.split('\0')) {
      if (!item || item.length < 4) continue;
      const value = item.slice(3).replace(/\\/g, '/');
      if (item[0] === 'U' || item[1] === 'U' || item.startsWith('AA ') || item.startsWith('DD '))
        files.push(value);
    }
    return [...new Set(files)];
  }

  async statusFor(root: string): Promise<GitStatus> {
    const runtime = this.resolveRuntime();
    const git = this.git(root, runtime);
    if (!(await this.isRepository(root, runtime))) {
      return {
        repository: false,
        branch: null,
        changed: 0,
        ahead: 0,
        behind: 0,
        remote: null,
        conflict: false,
        rebaseInProgress: false,
        usingSystemGit: runtime.source === 'system',
      };
    }
    const status = await git.status();
    const remote = status.current ? await this.branchRemote(git, status.current) : null;
    const conflict =
      this.hasUnresolvedConflict(status) || (await this.hasConflictMarkers(root, status));
    return {
      repository: true,
      branch: status.current || null,
      changed: status.files.length,
      ahead: status.ahead,
      behind: status.behind,
      remote,
      conflict,
      rebaseInProgress: await this.isRebaseOrMergeInProgress(root),
      usingSystemGit: runtime.source === 'system',
    };
  }

  async timeline(file?: string, limit = 100): Promise<GitCommit[]> {
    const root = this.requireRoot();
    const git = this.git(root);
    const logs = await git.log({
      '--max-count': Math.max(1, Math.min(limit, 500)),
      ...(file ? { file: this.requireVaultPath(file) } : {}),
    });
    const head = await git.revparse('HEAD');
    return logs.all.map((entry) => ({
      hash: entry.hash,
      shortHash: entry.hash.slice(0, 8),
      author: entry.author_name,
      authorEmail: entry.author_email,
      date: entry.date,
      message: entry.message,
      kind: commitKind(entry.message),
      isHead: entry.hash === head,
    }));
  }

  /**
   * One batched Git traversal for the confidence engine. Per-file `git log`
   * would turn a 1,000-page vault into 1,000 processes and miss the <10s target.
   */
  async confidenceHistory(): Promise<GitFileHistoryIndex> {
    const root = this.requireRoot();
    if (!(await this.isRepository(root))) return new Map();
    const git = this.git(root);
    const output = await git.raw([
      '-c',
      'core.quotepath=false',
      'log',
      '--all',
      '--numstat',
      '--format=%x1e%H%x1f%aI%x1f%an%x1f%ae',
    ]);
    const histories = new Map<string, GitFileHistory & { authorSet: Set<string> }>();
    let commit: { hash: string; date: string; author: string } | null = null;
    for (const line of output.split(/\r?\n/)) {
      if (line.startsWith('\u001e')) {
        const [hash, date, authorName, authorEmail] = line.slice(1).split('\u001f');
        commit = hash
          ? { hash, date: date ?? '', author: `${authorName ?? ''} <${authorEmail ?? ''}>` }
          : null;
        continue;
      }
      const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (!commit || !match) continue;
      const filePath = normalizeNumstatPath(match[3] ?? '');
      if (!isDocumentPath(filePath) || filePath.startsWith('.nexnote/')) continue;
      let history = histories.get(filePath);
      if (!history) {
        history = {
          commits: 0,
          authors: 0,
          firstCommitAt: commit.date,
          lastCommitAt: commit.date,
          events: [],
          authorSet: new Set(),
        };
        histories.set(filePath, history);
      }
      history.authorSet.add(commit.author);
      history.events.push({
        date: commit.date,
        additions: match[1] === '-' ? 0 : Number(match[1]),
        deletions: match[2] === '-' ? 0 : Number(match[2]),
      });
    }
    const result: GitFileHistoryIndex = new Map();
    for (const [filePath, history] of histories) {
      const events = [...history.events].sort(
        (left, right) => Date.parse(right.date) - Date.parse(left.date),
      );
      result.set(filePath, {
        commits: events.length,
        authors: history.authorSet.size,
        firstCommitAt: events.at(-1)?.date ?? history.firstCommitAt,
        lastCommitAt: events[0]?.date ?? history.lastCommitAt,
        events,
      });
    }
    return result;
  }

  async addRemote(name: string, url: string): Promise<GitOperationResult> {
    const root = this.requireRoot();
    if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(name))
      throw new GitServiceError('远程名称不合法', 'INVALID_REMOTE');
    if (!url.trim()) throw new GitServiceError('远程地址不能为空', 'INVALID_REMOTE');
    const git = this.git(root);
    // Preflight against the URL before touching repository state: a failed
    // check must not leave a newly-added remote or an overwritten URL behind.
    try {
      await git.raw(['ls-remote', '--heads', url]);
    } catch (error) {
      await this.notifyCurrentStatus();
      throw new GitServiceError(
        `远程未保存：授权预检失败。请检查网络、SSH key 或 HTTPS 凭证：${sanitizeRemoteText(errorMessage(error))}`,
        'REMOTE_AUTH_FAILED',
      );
    }
    const remotes = await git.getRemotes();
    if (remotes.some((remote) => remote.name === name)) await git.remote(['set-url', name, url]);
    else await git.addRemote(name, url);
    const result = { message: `远程 ${name} 已验证`, status: await this.statusFor(root) };
    this.notifyStatus(result.status);
    return result;
  }

  async remotes(): Promise<GitRemote[]> {
    const remotes = await this.git(this.requireRoot()).getRemotes(true);
    return remotes.map((remote) => ({
      name: remote.name,
      fetchUrl: sanitizeRemoteText(remote.refs.fetch),
      pushUrl: sanitizeRemoteText(remote.refs.push),
    }));
  }

  async pull(input: { force?: boolean } = {}): Promise<GitOperationResult> {
    const root = this.requireRoot();
    // Never allow a pre-pull debounce to race with merge/conflict handling.
    this.cancelAutoCommit();
    try {
      const git = this.git(root);
      const status = await git.status();
      // Safety: refuse to pull into a dirty worktree by default. Pull can overwrite
      // uncommitted local edits; users must explicitly confirm to bypass.
      if (status.files.length > 0 && input.force !== true) {
        throw new GitServiceError(
          `当前工作区有 ${status.files.length} 个未提交的变更；请先提交、暂存或显式确认后重试`,
          'WORKTREE_DIRTY',
        );
      }
      const remote = status.current ? await this.branchRemote(git, status.current) : null;
      if (!remote || !status.current)
        throw new GitServiceError('尚未绑定可拉取的远程分支', 'NO_REMOTE');
      // --no-rebase pins the merge strategy: without it modern Git aborts divergent
      // pulls with "Need to specify how to reconcile divergent branches", which would
      // hide a genuine conflict behind a generic network/auth error.
      await git.pull(remote, status.current, { '--no-rebase': null });
    } catch (error) {
      // A failed pull can leave conflict markers and an unmerged index.
      await this.notifyCurrentStatus();
      if (error instanceof GitServiceError) throw error;
      throw this.remoteOperationError('拉取', error);
    }
    return this.notified({ message: '拉取完成', root });
  }

  async push(): Promise<GitOperationResult> {
    const root = this.requireRoot();
    try {
      const git = this.git(root);
      const status = await git.status();
      const remote = status.current ? await this.branchRemote(git, status.current) : null;
      if (!remote || !status.current)
        throw new GitServiceError('尚未绑定可推送的远程分支', 'NO_REMOTE');
      await this.git(root).push(['-u', remote, status.current]);
    } catch (error) {
      await this.notifyCurrentStatus();
      if (error instanceof GitServiceError) throw error;
      throw this.remoteOperationError('推送', error);
    }
    return this.notified({ message: '推送完成', root });
  }

  /**
   * DEV-073：sync = fetch → rebase/merge → push（仅 ahead>0）。
   * 全程禁止 --force；遇冲突或分叉时中止并通知 UI 让 Agent 接管。
   *
   * DEV-088：sync() 与 pull() 对齐，加 WORKTREE_DIRTY 守卫——工作区有用户可见的
   * 未暂存内容（.md / docx / xlsx / xmind 等）时直接抛错，让 doctor 引导用户先
   * commit 或 stash。.gitignore 含两份 ADR-0016 模板块的脏状态属于「用户解冲突
   * 残留」，由 writeDefaultGitignore 收敛后再继续。
   */
  async sync(options: SyncOptions): Promise<SyncResult> {
    const root = this.requireRoot();
    const emit = (event: SyncProgressEvent) => {
      try {
        options.onProgress?.(event);
        this.syncProgressListener?.(event);
      } catch {
        /* listener self-contained */
      }
    };
    this.cancelAutoCommit();
    const git = this.git(root);
    try {
      emit({ phase: 'fetching', message: '正在拉取远程更新…' });
      const preStatus = await git.status();
      if (preStatus.files.length > 0) {
        // 仅 dirty 在 .gitignore（且其内容含两份 ADR-0016 模板块）时自动收敛；
        // 其他用户可见内容一律拒绝，与 pull() 行为一致。
        const dirtyOnly = preStatus.files.map((file) => file.path).filter(Boolean);
        const dirtyMeaningful = dirtyOnly.filter((p) => p !== '.gitignore');
        const dirtyGitignore = dirtyOnly.includes('.gitignore');
        if (dirtyMeaningful.length > 0) {
          throw new GitServiceError(
            `当前工作区有 ${dirtyMeaningful.length} 个未提交的变更；请先提交、暂存或显式确认后重试`,
            'WORKTREE_DIRTY',
          );
        }
        if (dirtyGitignore) {
          const recovered = await this.recoverDuplicatedGitignore(root);
          if (!recovered) {
            throw new GitServiceError(
              '.gitignore 存在未提交的修改，请先提交、暂存或显式确认后重试',
              'WORKTREE_DIRTY',
            );
          }
        }
      }
      const remote = preStatus.current ? await this.branchRemote(git, preStatus.current) : null;
      if (!remote || !preStatus.current)
        throw new GitServiceError('尚未绑定可同步的远程分支', 'NO_REMOTE');
      await git.fetch(remote);
      const afterFetch = await git.status();
      if (afterFetch.behind > 0) {
        const phase = options.strategy === 'rebase' ? 'rebasing' : 'merging';
        emit({ phase, message: options.strategy === 'rebase' ? '正在对齐远程提交…' : '正在合并远程变更…' });
        if (options.strategy === 'rebase') {
          await git.rebase(remote + '/' + preStatus.current);
        } else {
          await git.merge([remote + '/' + preStatus.current, '--no-edit']);
        }
      }
      const postMerge = await git.status();
      if (postMerge.ahead > 0) {
        emit({ phase: 'pushing', message: '正在推送本地提交…' });
        await git.push(['-u', remote, preStatus.current]);
      }
      emit({ phase: 'done' });
      const final = await this.statusFor(root);
      this.notifyStatus(final);
      return { message: '同步完成', status: final };
    } catch (error) {
      emit({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
      await this.notifyCurrentStatus();
      if (error instanceof GitServiceError) throw error;
      throw this.remoteOperationError('同步', error);
    }
  }

  /** Clone only into a validated direct child name under a caller-validated parent. */
  async cloneInto(url: string, parentDir: string, name: string): Promise<GitOperationResult> {
    if (!path.isAbsolute(parentDir))
      throw new GitServiceError('克隆父目录必须为绝对路径', 'INVALID_PATH');
    if (!name || name === '.' || name === '..' || path.basename(name) !== name) {
      throw new GitServiceError('克隆目录名称不合法', 'INVALID_PATH');
    }
    const targetDir = path.resolve(parentDir, name);
    if (path.dirname(targetDir) !== path.resolve(parentDir)) {
      throw new GitServiceError('克隆目标必须是父目录的直接子目录', 'INVALID_PATH');
    }
    const safeParent = await safeVaultPath(parentDir);
    const safeTarget = await safeVaultPath(path.join(safeParent, name));
    await this.git(safeParent).clone(url, safeTarget);
    this.setRoot(safeTarget);
    return this.notified({ message: '克隆完成', root: safeTarget });
  }

  /** 轻量探测：ls-remote --heads，仅验证远端可达（不下载仓库内容）。 */
  async lsRemote(url: string): Promise<void> {
    if (!url.trim()) throw new GitServiceError('远程地址不能为空', 'INVALID_REMOTE');
    // ls-remote 不需要本地仓库，但 simple-git 的 baseDir 必须存在。
    // 使用 Node 的跨平台临时目录，避免 Windows 上不存在 `/tmp` 导致预检恒失败。
    const baseDir = tmpdir();
    mkdirSync(baseDir, { recursive: true });
    await this.git(baseDir).raw(['ls-remote', '--heads', '--exit-code', url]);
  }

  async previewRestore(file: string, commit: string): Promise<GitRestorePreview> {
    const root = this.requireRoot();
    const relative = await this.requireRestorableFile(root, file, commit);
    const git = this.git(root);
    const [target, current] = await Promise.all([
      git.show([`${commit}:${relative}`]),
      // requireRestorableFile rejected symlink components, so this cannot follow outside root.
      fsp.readFile(path.join(root, relative), 'utf8').catch(() => null),
    ]);
    return { path: relative, commit, current, target };
  }

  async restoreFile(file: string, commit: string): Promise<GitOperationResult> {
    const root = this.requireRoot();
    const relative = await this.requireRestorableFile(root, file, commit);
    const git = this.git(root);
    // checkout stages only this file. Commit with an explicit pathspec so unrelated
    // staged or unstaged edits can never hitchhike into the restore commit.
    await git.raw(['checkout', commit, '--', relative]);
    await this.ensureIdentity(git);
    await git.raw([
      'commit',
      '--only',
      '-m',
      `${RESTORE_PREFIX} restore ${relative} from ${commit.slice(0, 8)}`,
      '--',
      relative,
    ]);
    this.lastCommitAt = Date.now();
    return this.notified({ message: `已恢复 ${relative}，并创建新的恢复提交`, root });
  }

  private hasUnresolvedConflict(status: Awaited<ReturnType<SimpleGit['status']>>): boolean {
    return (
      status.conflicted.length > 0 ||
      status.files.some((file) => file.index === 'U' || file.working_dir === 'U')
    );
  }

  /**
   * Detect a paused rebase/merge without invoking status(): the presence of any
   * of git's state files under GIT_DIR is authoritative and read-only. A rebase
   * paused on a content conflict leaves rebase-merge/ (interactive) or
   * rebase-apply/ (am) even before the index reports an unmerged path, so this
   * catches the window where commitAuto() used to stack more layout commits.
   */
  private async isRebaseOrMergeInProgress(root: string): Promise<boolean> {
    const git = this.git(root);
    const gitDirRaw = await git.raw(['rev-parse', '--git-dir']).catch(() => '');
    const gitDir = gitDirRaw.trim();
    if (!gitDir) return false;
    const base = path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir);
    const markers = [
      'rebase-merge',
      'rebase-apply',
      'MERGE_HEAD',
      'REBASE_HEAD',
    ];
    const checks = await Promise.all(
      markers.map((name) =>
        fsp
          .access(path.join(base, name))
          .then(() => true)
          .catch(() => false),
      ),
    );
    return checks.some(Boolean);
  }

  private async hasConflictMarkers(
    root: string,
    status: Awaited<ReturnType<SimpleGit['status']>>,
  ): Promise<boolean> {
    const changedFiles = status.files.map((file) => file.path).filter(Boolean);
    for (const file of changedFiles) {
      const contents = await fsp.readFile(path.join(root, file), 'utf8').catch(() => null);
      if (contents && /^(<<<<<<< |=======|>>>>>>> )/m.test(contents)) return true;
    }
    return false;
  }

  private async notified(input: { message: string; root: string }): Promise<GitOperationResult> {
    const status = await this.statusFor(input.root);
    this.notifyStatus(status);
    return { message: input.message, status };
  }

  private async notifyCurrentStatus(): Promise<void> {
    if (this.root) this.notifyStatus(await this.statusFor(this.root));
  }

  private notifyStatus(status: GitStatus): void {
    this.statusListener?.(status);
  }

  private async commit(root: string, message: string): Promise<void> {
    const git = this.git(root);
    await this.ensureIdentity(git);
    const hasHead = Boolean(
      (await git.raw(['rev-parse', '--verify', 'HEAD']).catch(() => '')).trim(),
    );
    // --no-renames reports both endpoints of a rename as separate add/delete entries;
    // with rename detection the source would collapse into the destination.
    const stagedBefore = new Set(
      (await git.raw(['diff', '--cached', '--name-only', '-z', '--no-renames']))
        .split('\0')
        .filter(Boolean),
    );
    // Leaf paths only: modified files plus tracked paths whose worktree entry is gone.
    // `git diff --name-only` can report a former FILE that is now a DIRECTORY; staging
    // through that name would recursively absorb the directory, so deletions are
    // derived from the tracked index instead and directories never become add inputs.
    const modified = (await git.raw(['diff', '--name-only', '-z', '--no-renames']))
      .split('\0')
      .filter(Boolean);
    const tracked = (await git.raw(['ls-files', '-z'])).split('\0').filter(Boolean);
    const worktreeMissing = new Set<string>();
    for (const file of tracked) {
      const stat = await fsp.lstat(path.join(root, file)).catch(() => null);
      if (!stat || stat.isDirectory()) worktreeMissing.add(file);
    }
    const untracked = (await git.raw(['ls-files', '-z', '--others', '--exclude-standard']))
      .split('\0')
      .filter(Boolean);
    const conflictsWithStaged = (file: string): boolean =>
      [...stagedBefore].some(
        (staged) =>
          file === staged || file.startsWith(`${staged}/`) || staged.startsWith(`${file}/`),
      );
    // A path already staged by the user owns its entire file/directory namespace.
    // This prevents a staged file later replaced by `file/inner.md` from being
    // overwritten in the isolated index by the descendant path.
    const leaves = [...new Set([...modified, ...untracked])].filter(
      (file) => !conflictsWithStaged(file) && !worktreeMissing.has(file),
    );
    const deletions = [...new Set([...worktreeMissing, ...modified])].filter(
      (file) => worktreeMissing.has(file) || !tracked.includes(file),
    );
    // Only accept paths that currently resolve to a regular file on disk.
    const allowed: string[] = [];
    for (const file of leaves) {
      if (stagedBefore.has(file) || isVaultSyncGuardedPath(file)) continue;
      const stat = await fsp.lstat(path.join(root, file)).catch(() => null);
      if (stat?.isFile()) allowed.push(file);
    }
    const removed = [...new Set(deletions)].filter(
      (file) => !conflictsWithStaged(file) && !isVaultSyncGuardedPath(file),
    );
    const guardedInHead = hasHead
      ? (await git.raw(['ls-tree', '-r', '-z', '--name-only', 'HEAD']))
          .split('\0')
          .filter(Boolean)
          .filter(isVaultSyncGuardedPath)
      : [];
    const guardedCandidates = (await git.raw(['ls-files', '-z', '--others']))
      .split('\0')
      .filter(Boolean)
      .filter(isVaultSyncGuardedPath);
    if (guardedCandidates.length)
      console.info('[git] sync guard skipped:', guardedCandidates.length);

    // Clean the real index first, including force-added guarded files. Do not reset:
    // migration deletions stay staged and all files remain on disk.
    await this.untrackGuardedArtifacts(git);

    // Commit through an isolated index seeded from HEAD. This guarantees unrelated
    // user-staged content cannot leak into NexNote manual/automatic commits.
    const temp = await fsp.mkdtemp(path.join(tmpdir(), 'nexnote-git-index-'));
    try {
      const isolated = this.git(root, this.resolveRuntime(), {
        GIT_INDEX_FILE: path.join(temp, 'index'),
      });
      await isolated.raw(hasHead ? ['read-tree', 'HEAD'] : ['read-tree', '--empty']);
      await this.stageLiteralPaths(isolated, ['rm', '--cached', '-f', '--ignore-unmatch'], removed);
      await this.stageLiteralPaths(isolated, ['add'], allowed);
      await this.stageLiteralPaths(
        isolated,
        ['rm', '--cached', '-f', '--ignore-unmatch'],
        guardedInHead,
      );
      // Fail closed: the isolated index must end with zero guarded paths. A violation
      // aborts the commit instead of being committed or silently rewritten.
      const finalPaths = (await isolated.raw(['ls-files', '-z', '--cached']))
        .split('\0')
        .filter(Boolean);
      const leaked = finalPaths.filter(isVaultSyncGuardedPath);
      if (leaked.length > 0) {
        console.error('[git] sync guard blocked commit:', leaked.length);
        throw new GitServiceError(
          '同步护栏检测到受保护路径即将进入提交，已中止',
          'SYNC_GUARD_VIOLATION',
        );
      }
      const committed = (await isolated.raw(['diff', '--cached', '--name-only', '-z']))
        .split('\0')
        .filter(Boolean);
      if (committed.length === 0) return;
      await isolated.commit(message);
      // Align only paths owned by this commit in the real index. User-staged paths
      // were excluded above and remain byte-for-byte staged.
      await this.stageLiteralPaths(git, ['rm', '--cached', '-f', '--ignore-unmatch'], removed);
      await this.stageLiteralPaths(git, ['add'], allowed);
      this.lastCommitAt = Date.now();
      this.commitListener?.(root, committed);
    } finally {
      await fsp.rm(temp, { recursive: true, force: true });
    }
  }

  private async ensureIdentity(git: SimpleGit): Promise<void> {
    const [name, email] = await Promise.all([
      git.raw(['config', '--get', 'user.name']).catch(() => ''),
      git.raw(['config', '--get', 'user.email']).catch(() => ''),
    ]);
    if (!name.trim()) await git.addConfig('user.name', 'NexNote');
    if (!email.trim()) await git.addConfig('user.email', 'noreply@nexnote.local');
  }

  /**
   * Vault-local `.gitignore` 模板（ADR-0016，取代 ADR-0003 的 allowlist 条款）：
   *  - 默认忽略 `.nexnote/` 整目录（运行时索引、缓存、锁、数据库以及 UI/会话配置）；
   *  - 跨设备同步只覆盖 vault 内用户笔记与二进制文档。
   *  - 绑定时幂等修复：完整模板前置，用户规则逐字保留且拥有后置优先级。
   */
  static readonly GITIGNORE_LINES: readonly string[] = [
    '# NexNote: ignore the entire .nexnote/ runtime directory (index, cache, locks,',
    '# database, and per-device UI/session state). See ADR-0016.',
    '.nexnote/',
    '# NexNote: operating-system metadata never belongs in the knowledge base.',
    ...OS_METADATA_FILES,
  ];

  /**
   * Legacy `.gitignore` block from ADR-0003 that allowed `config.json` and
   * `layout.json` to be tracked. ADR-0016 retires this allowlist; the migration
   * path strips every variant of this block from existing user `.gitignore`
   * files so the new template (full `.nexnote/` ignore) takes effect.
   */
  static readonly LEGACY_GITIGNORE_ALLOWLIST_LINES: readonly string[] = [
    '!/.nexnote/',
    '.nexnote/*',
    '!/.nexnote/config.json',
    '!/.nexnote/layout.json',
  ];

  async writeDefaultGitignore(root: string): Promise<void> {
    const safe = await safeVaultPath(root);
    const filename = path.join(safe, '.gitignore');
    // O_NOFOLLOW prevents following a vault symlink outside its root.
    const handle = await fsp
      .open(filename, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o666)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ELOOP') {
          throw new GitServiceError('同步护栏要求 .gitignore 为普通文件', 'INVALID_PATH');
        }
        throw error;
      });
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink > 1) {
        throw new GitServiceError('同步护栏要求 .gitignore 为独立普通文件', 'INVALID_PATH');
      }
      const existing = await handle.readFile();
      const bomBytes = Buffer.from([0xef, 0xbb, 0xbf]);
      const hasBom = existing.subarray(0, bomBytes.length).equals(bomBytes);
      const originalUserBytes = hasBom ? existing.subarray(bomBytes.length) : existing;
      const templateBytes = Buffer.from(`${GitService.GITIGNORE_LINES.join('\n')}\n`, 'utf8');
      const crlfTemplateBytes = Buffer.from(
        `${GitService.GITIGNORE_LINES.join('\r\n')}\r\n`,
        'utf8',
      );
      // DEV-083/ADR-0016 migration: also strip the legacy ADR-0003 allowlist
      // block (the `!/.nexnote/config.json` / `!/.nexnote/layout.json` lines) so
      // older vaults fall back to the new full-`.nexnote/` ignore template.
      const legacyAllowlistLf = Buffer.from(
        `${GitService.LEGACY_GITIGNORE_ALLOWLIST_LINES.join('\n')}\n`,
        'utf8',
      );
      const legacyAllowlistCrlf = Buffer.from(
        `${GitService.LEGACY_GITIGNORE_ALLOWLIST_LINES.join('\r\n')}\r\n`,
        'utf8',
      );
      const templateBlocks = findTemplateBlocks(originalUserBytes, [
        templateBytes,
        crlfTemplateBytes,
        legacyAllowlistLf,
        legacyAllowlistCrlf,
      ]);
      if (
        templateBlocks.length === 1 &&
        templateBlocks[0]!.start === 0 &&
        templateBlocks[0]!.bytes.equals(templateBytes)
      ) {
        return;
      }
      // Move every complete canonical block out of the user byte stream before
      // prepending one LF-canonical block. User bytes are sliced and concatenated,
      // never decoded/re-encoded, so malformed UTF-8 remains byte-identical.
      const remainingUserBytes = removeTemplateBlocks(originalUserBytes, templateBlocks);
      const content = Buffer.concat([
        hasBom ? bomBytes : Buffer.alloc(0),
        templateBytes,
        remainingUserBytes,
      ]);
      await handle.write(content, 0, content.length, 0);
      await handle.truncate(content.length);
    } finally {
      await handle.close();
    }
  }

  async ensureSyncGuard(root: string): Promise<void> {
    const git = this.git(root);
    await this.writeDefaultGitignore(root);
    await this.untrackGuardedArtifacts(git);
  }

  /**
   * Upgrade migration for vaults created before ADR 0003. `git rm --cached`
   * removes only guarded local artifacts from the index; files remain on disk.
   * Config/layout are deliberately not touched because the gitignore allowlist
   * makes them portable vault state.
   */
  /**
   * DEV-088: recover a duplicated `.gitignore` (two or more ADR-0016 template blocks)
   * written by a pre-DEV-083 build before the dedup algorithm landed, or left over from
   * a manual conflict resolution. Idempotent: delegates entirely to writeDefaultGitignore,
   * which is byte-safe and only rewrites when the file does not already match the
   * canonical single-block layout.
   *
   * @returns `true` when `.gitignore` was rewritten (the dirty state was recovered);
   *          `false` when no duplication was found and the file was left untouched.
   */
  private async recoverDuplicatedGitignore(root: string): Promise<boolean> {
    const safe = await safeVaultPath(root);
    const filename = path.join(safe, '.gitignore');
    const existing = await fsp.readFile(filename, 'utf8').catch(() => null);
    if (existing === null) return false;
    const template = GitService.GITIGNORE_LINES.join('\n');
    const occurrences = existing.split(template).length - 1;
    if (occurrences < 2) return false;
    await this.writeDefaultGitignore(root);
    return true;
  }

  private async untrackGuardedArtifacts(git: SimpleGit): Promise<void> {
    const tracked = await git.raw(['ls-files', '-z']);
    const guarded = [
      ...new Set(tracked.split('\0').filter(Boolean).filter(isVaultSyncGuardedPath)),
    ];
    // -f permits removing a staged blob that differs from both HEAD and disk.
    // --cached is mandatory: no worktree file is ever removed.
    await this.stageLiteralPaths(git, ['rm', '--cached', '-f', '--ignore-unmatch'], guarded);
    if (guarded.length) console.info('[git] sync guard untracked:', guarded.length);
  }

  /** NUL file input avoids argv limits, quoting, wildcard and pathspec interpretation. */
  private async stageLiteralPaths(
    git: SimpleGit,
    command: string[],
    files: string[],
  ): Promise<void> {
    if (files.length === 0) return;
    const temp = await fsp.mkdtemp(path.join(tmpdir(), 'nexnote-git-paths-'));
    try {
      const filename = path.join(temp, 'paths');
      await fsp.writeFile(filename, `${files.join('\0')}\0`, { mode: 0o600 });
      await git.raw([
        '--literal-pathspecs',
        ...command,
        `--pathspec-from-file=${filename}`,
        '--pathspec-file-nul',
      ]);
    } finally {
      await fsp.rm(temp, { recursive: true, force: true });
    }
  }

  private git(
    baseDir: string,
    runtime: GitRuntimeResolution = this.resolveRuntime(),
    extraEnv: NodeJS.ProcessEnv = {},
  ): SimpleGit {
    if (runtime.source === 'missing') {
      throw new GitServiceError(
        '应用内捆绑 Git 缺失（安装或打包异常），且未启用系统 Git 回退；请重新安装或到设置中启用「使用系统 Git」',
        'GIT_BINARY_MISSING',
      );
    }
    if (runtime.source === 'system' && !this.useSystemGit && !this.systemFallbackWarned) {
      this.systemFallbackWarned = true;
      console.warn(
        '[git] bundled Git payload 未就位（postinstall 下载失败或离线安装），当前回退 PATH 系统 Git；' +
          '发布/打包前请先执行 pnpm rebuild dugite 恢复捆绑 Git',
      );
    }
    // Do not inject dugite paths when its downloaded executable is unavailable.
    // In that development fallback, preserve the user's normal Git environment.
    const binary = runtime.binary;
    const env = {
      ...sanitizeGitProcessEnv(runtime.environment ?? process.env),
      ...(this.networkProxyEnv ?? {}),
      ...extraEnv,
    };
    const instance = simpleGit({
      baseDir,
      binary,
      maxConcurrentProcesses: 1,
      trimmed: false,
      unsafe: {
        allowUnsafePack: true,
        allowUnsafeCustomBinary: true,
        allowUnsafePager: true,
        allowUnsafeConfigPaths: true,
        allowUnsafeTemplateDir: true,
        allowUnsafeSshCommand: true,
        allowUnsafeAskPass: true,
      },
    }).env(env);
    // DEV-072：通过 `git -c http.proxy=...` 给单次调用注入代理，不污染用户 ~/.gitconfig。
    if (this.networkCliConfig && this.networkCliConfig.length > 0) {
      for (const flag of this.networkCliConfig) instance.raw(['-c', flag]);
    }
    return instance;
  }

  private resolveRuntime(): GitRuntimeResolution {
    return resolveInstalledGitRuntime({
      useSystemGit: this.useSystemGit,
      allowSystemFallback: this.allowSystemGitFallback,
    });
  }

  private requireRoot(): string {
    if (!this.root) throw new GitServiceError('尚未打开任何知识库', 'NO_VAULT');
    return this.root;
  }

  private requireVaultPath(file: string): string {
    if (!file || path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) {
      throw new GitServiceError('文件路径必须位于当前知识库内', 'INVALID_PATH');
    }
    return file.replace(/\\/g, '/');
  }

  private async requireRestorableFile(root: string, file: string, commit: string): Promise<string> {
    const relative = this.requireVaultPath(file);
    const normalized = path.posix.normalize(relative);
    if (
      normalized === '.' ||
      normalized.endsWith('/') ||
      normalized === '' ||
      relative.endsWith('/.') ||
      relative.split('/').some((segment) => segment === '.')
    ) {
      throw new GitServiceError('恢复目标必须是知识库内的已跟踪文件', 'INVALID_PATH');
    }

    // lstat every existing component: neither preview nor restore may follow a vault
    // symlink to disclose or overwrite an external file.
    let current = root;
    for (const segment of normalized.split('/')) {
      current = path.join(current, segment);
      const stat = await fsp.lstat(current).catch(() => null);
      if (stat?.isSymbolicLink()) {
        throw new GitServiceError('恢复目标不能经过符号链接', 'INVALID_PATH');
      }
    }

    const git = this.git(root);
    const tracked = await git.raw(['ls-tree', '-r', '--name-only', commit, '--', normalized]);
    if (!tracked.split(/\r?\n/).includes(normalized)) {
      throw new GitServiceError('恢复目标必须是所选版本中的已跟踪文件', 'INVALID_PATH');
    }
    return normalized;
  }

  private remoteOperationError(action: string, error: unknown): GitServiceError {
    const text = sanitizeRemoteText(errorMessage(error));
    const conflict = /CONFLICT|Automatic merge failed|UPDATE_NEEDED|unmerged/i.test(text);
    return new GitServiceError(
      conflict
        ? `${action}遇到冲突，请在仓库目录中手动解决后再继续：${text}`
        : `${action}失败。请检查远程地址、网络、SSH key 或 HTTPS 凭证：${text}`,
      conflict ? 'MERGE_CONFLICT' : 'REMOTE_OPERATION_FAILED',
    );
  }
}

interface TemplateBlock {
  start: number;
  end: number;
  bytes: Buffer;
}

/** Find the next line-boundary match, continuing past inline false positives. */
function findNextTemplateBlock(input: Buffer, bytes: Buffer, from: number): TemplateBlock | null {
  let search = from;
  while (search < input.length) {
    const index = input.indexOf(bytes, search);
    if (index < 0) return null;
    if (index === 0 || input[index - 1] === 0x0a) {
      return { start: index, end: index + bytes.length, bytes };
    }
    search = index + 1;
  }
  return null;
}

/** Find all complete template bodies at line boundaries without decoding user bytes. */
function findTemplateBlocks(input: Buffer, variants: Buffer[]): TemplateBlock[] {
  const blocks: TemplateBlock[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const candidates = variants
      .map((bytes) => findNextTemplateBlock(input, bytes, cursor))
      .filter((block): block is TemplateBlock => block !== null)
      .sort((left, right) => left.start - right.start || right.bytes.length - left.bytes.length);
    const found = candidates[0];
    if (!found) break;
    blocks.push(found);
    cursor = found.end;
  }
  return blocks;
}

/** Remove template bodies only; adjacent user line terminators always remain untouched. */
function removeTemplateBlocks(input: Buffer, blocks: TemplateBlock[]): Buffer {
  if (blocks.length === 0) return input;
  const pieces: Buffer[] = [];
  let cursor = 0;
  for (const block of blocks) {
    if (block.start > cursor) pieces.push(input.subarray(cursor, block.start));
    cursor = Math.max(cursor, block.end);
  }
  if (cursor < input.length) pieces.push(input.subarray(cursor));
  return Buffer.concat(pieces);
}

function cleanSummary(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 160);
}

function normalizeNumstatPath(rawPath: string): string {
  let value = rawPath.trim();
  if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  const renamed = value.match(/^(.*)\{(.*) => (.*)\}(.*)$/) ?? value.match(/^(.*) => (.*)$/);
  if (renamed) {
    if (renamed[3] !== undefined)
      value = `${renamed[1] ?? ''}${renamed[3] ?? ''}${renamed[4] ?? ''}`;
    else value = renamed[2] ?? value;
  }
  return value.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function commitKind(message: string): GitCommit['kind'] {
  if (message.startsWith(INITIAL_MESSAGE)) return 'initial';
  if (message.startsWith(AUTO_PREFIX)) return 'auto';
  if (message.startsWith(MANUAL_PREFIX)) return 'manual';
  if (message.startsWith(RESTORE_PREFIX)) return 'restore';
  return 'other';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Remove userinfo, access tokens, and query credentials before IPC can expose text. */
export function sanitizeRemoteText(value: string): string {
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):[^\s/@]+@/gi, '$1$2:***@')
    .replace(/(authorization\s*:\s*)(?:bearer|basic|token)\s+[^\s,;"']+/gi, '$1***')
    .replace(
      /([?&](?:access_token|client_secret|api_key|apikey|token|password|passwd|secret|key)=)[^\s&#]+/gi,
      '$1***',
    )
    .replace(
      /\b((?:client[_-]?secret|api[_-]?key|access[_-]?token|secret[_-]?key|private[_-]?key|refresh[_-]?token|auth[_-]?token|password|passwd|token|secret|key)\s*[=:]\s*)["']?[^\s"',;&]+/gi,
      '$1***',
    )
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1***@');
}
