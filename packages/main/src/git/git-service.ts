import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit, type SimpleGit } from 'simple-git';
import { resolveInstalledGitRuntime, type GitRuntimeResolution } from './git-runtime';
import { isDocumentPath } from '../document/document-domain';
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
const INITIAL_MESSAGE = 'nexnote:init: initialize vault';
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
  /** 当前生效的自动提交防抖窗口。setDebounceMs 写入；fs handler 同步读它。 */
  private debounceMs: number;

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
    const git = this.git(root);
    if (!(await this.isRepository(root))) await git.init();
    await this.ensureIdentity(git);
    await this.writeDefaultGitignore(root);
    await this.untrackIgnoredNexnoteArtifacts(git);
    const status = await git.status();
    if (status.files.length > 0) {
      await git.add(['.']);
      await git.commit(INITIAL_MESSAGE);
      this.lastCommitAt = Date.now();
    }
    const result = {
      message: 'Git 仓库已初始化并创建初始提交',
      status: await this.statusFor(root),
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
    await this.commit(root, `${AUTO_PREFIX} ${cleanSummary(summary)}`);
    await this.notifyCurrentStatus();
  }

  async commitManual(message: string): Promise<GitOperationResult> {
    const root = this.requireRoot();
    const text = cleanSummary(message);
    if (!text) throw new GitServiceError('提交说明不能为空', 'EMPTY_MESSAGE');
    await this.commit(root, `${MANUAL_PREFIX} ${text}`);
    const result = { message: '已创建手动提交', status: await this.statusFor(root) };
    this.notifyStatus(result.status);
    return result;
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
      if (item[0] === 'U' || item[1] === 'U' || item.startsWith('AA ') || item.startsWith('DD ')) files.push(value);
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
    await this.git(parentDir).clone(url, targetDir);
    this.setRoot(targetDir);
    return this.notified({ message: '克隆完成', root: targetDir });
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
    const status = await git.status();
    if (status.files.length === 0) return;
    const files = status.files.map((file) => file.path.replace(/\\/g, '/'));
    await git.add(['.']);
    await git.commit(message);
    this.lastCommitAt = Date.now();
    if (files.length > 0) this.commitListener?.(root, files);
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
   * Vault-local `.gitignore` 模板（ADR 0003）：
   *  - 默认忽略 `.nexnote/` 整目录（运行时索引、缓存、锁、数据库等）。
   *  - 用 allowlist 把可重建配置（config.json / layout.json）重新纳入版本化。
   *  - 幂等：每次启动检查缺失行并补齐，不覆盖用户自定义条目。
   */
  static readonly GITIGNORE_LINES: readonly string[] = [
    '# NexNote: ignore the entire .nexnote/ runtime directory by default, then re-allow',
    '# versioned, reconstructible configuration files. See ADR 0003.',
    '.nexnote/',
    '!/.nexnote/',
    '.nexnote/*',
    '!/.nexnote/config.json',
    '!/.nexnote/layout.json',
  ];

  async writeDefaultGitignore(root: string): Promise<void> {
    const filename = path.join(root, '.gitignore');
    const required = GitService.GITIGNORE_LINES;
    const existing = await fsp.readFile(filename, 'utf8').catch(() => '');
    const missing = required.filter((line) => !existing.split(/\r?\n/).includes(line));
    if (missing.length)
      await fsp.writeFile(
        filename,
        `${existing.trimEnd()}${existing.trim() ? '\n' : ''}${missing.join('\n')}\n`,
        'utf8',
      );
  }

  /**
   * Upgrade migration for vaults created before ADR 0003. `git rm --cached`
   * removes only always-local runtime files from the index; files remain on disk.
   * Config/layout are deliberately not touched because the gitignore allowlist
   * makes them portable vault state.
   */
  private async untrackIgnoredNexnoteArtifacts(git: SimpleGit): Promise<void> {
    const tracked = await git.raw(['ls-files', '-z', '--', '.nexnote']);
    const alwaysLocal = tracked
      .split('\0')
      .filter(Boolean)
      .filter((file) => file !== '.nexnote/config.json' && file !== '.nexnote/layout.json');
    if (alwaysLocal.length > 0) await git.raw(['rm', '--cached', '--', ...alwaysLocal]);
  }

  private git(baseDir: string, runtime: GitRuntimeResolution = this.resolveRuntime()): SimpleGit {
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
    const env = runtime.environment ?? process.env;
    return simpleGit({
      baseDir,
      binary,
      maxConcurrentProcesses: 1,
      trimmed: true,
      unsafe: {
        allowUnsafePack: true,
        allowUnsafeCustomBinary: true,
        allowUnsafePager: true,
        allowUnsafeConfigPaths: true,
        allowUnsafeTemplateDir: true,
      },
    }).env(env);
  }

  private resolveRuntime(): GitRuntimeResolution {
    return resolveInstalledGitRuntime({
      useSystemGit: this.useSystemGit,
      allowSystemFallback: this.allowSystemGitFallback,
    });
  }

  private requireRoot(): string {
    if (!this.root) throw new GitServiceError('尚未打开任何 vault', 'NO_VAULT');
    return this.root;
  }

  private requireVaultPath(file: string): string {
    if (!file || path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) {
      throw new GitServiceError('文件路径必须位于当前 vault 内', 'INVALID_PATH');
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
      throw new GitServiceError('恢复目标必须是 vault 内的已跟踪文件', 'INVALID_PATH');
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
    .replace(/([?&](?:access_token|token|password|passwd|secret)=)[^\s&#]+/gi, '$1***')
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1***@');
}
