import { execFileSync } from 'node:child_process';
import { promises as fsp, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GitService,
  sanitizeGitProcessEnv,
  GitServiceError,
  DEFAULT_DEBOUNCE_MS,
  DEBOUNCE_RANGE_MS,
  isVaultSyncGuardedPath,
  normalizeDebounceMs,
  sanitizeRemoteText,
} from '../src/git/git-service';
import type { GitStatus } from '@nexnote/shared';

const SKIP = process.env.NEXNOTE_SKIP_GIT_TESTS === '1';
const isWindows = process.platform === 'win32';

function gitBinary(): string {
  return process.env.NEXNOTE_TEST_GIT ?? 'git';
}

function removeTempTree(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch (error) {
    if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EBUSY')
      throw error;
  }
}

function countBufferOccurrences(haystack: Buffer, needle: Buffer): number {
  let count = 0;
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function systemGitAvailable(): boolean {
  try {
    execFileSync(gitBinary(), ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function configureTestIdentity(repository: string): void {
  execFileSync(gitBinary(), ['config', 'user.name', 'NexNote Tests'], {
    cwd: repository,
    stdio: 'ignore',
  });
  execFileSync(gitBinary(), ['config', 'user.email', 'tests@nexnote.local'], {
    cwd: repository,
    stdio: 'ignore',
  });
}

const runIfGit = (): boolean => !SKIP && systemGitAvailable();

let root: string;
let service: GitService;

beforeEach(() => {
  if (!runIfGit()) return;
  root = mkdtempSync(path.join(tmpdir(), 'nexnote-git-test-'));
  service = new GitService({ useSystemGit: true, defaultDebounceMs: 50, minCommitIntervalMs: 0 });
  service.setRoot(root);
});

afterEach(() => {
  if (!runIfGit() || !root) return;
  service.cancelAutoCommit();
  service.setRoot(null);
  // Windows 上 simple-git 子进程退出与句柄释放存在毫秒级竞态；交给 Node 的
  // maxRetries 重试（覆盖 EBUSY/ENOTEMPTY/EPERM），而不是在测试里手写 sleep。
  removeTempTree(root);
});

describe.runIf(runIfGit())('GitService（系统 Git，临时仓库）', () => {
  it('initialize 创建仓库、写 .gitignore（ADR 0003 allowlist）、提交初始版本', async () => {
    // Pre-seed the vault config & a search index so we can assert the allowlist
    // re-includes config while the index remains ignored.
    await fsp.mkdir(path.join(root, '.nexnote', 'index'), { recursive: true });
    await fsp.writeFile(path.join(root, '.nexnote', 'config.json'), '{"version":1}');
    await fsp.writeFile(path.join(root, '.nexnote', 'index', 'blob.bin'), 'idx');
    await fsp.writeFile(path.join(root, 'README.md'), '# 临时测试');

    const result = await service.initialize(root);
    expect(result.status.repository).toBe(true);
    expect(result.status.changed).toBe(0);
    const ignore = await fsp.readFile(path.join(root, '.gitignore'), 'utf8');
    expect(ignore).toMatch(/^\.nexnote\/$/m);
    expect(ignore).toMatch(/!\/\.nexnote\/config\.json/);
    expect(ignore).toMatch(/!\/\.nexnote\/layout\.json/);
    expect(ignore).toMatch(/^\.DS_Store$/m);
    expect(ignore).toMatch(/^Thumbs\.db$/m);
    expect(ignore).toMatch(/^desktop\.ini$/m);

    // The config MUST be tracked (versioned); the index MUST NOT be tracked.
    const tracked = await simpleGit({ baseDir: root, binary: gitBinary() }).raw(['ls-files']);
    expect(tracked).toContain('.nexnote/config.json');
    expect(tracked).not.toContain('.nexnote/index/');

    const log = await service.timeline();
    expect(log.length).toBe(1);
    expect(log[0]!.kind).toBe('initial');
    expect(log[0]!.isHead).toBe(true);
  });

  it('继承宿主拦截变量（编辑器/SSH/askpass 等）时 initialize 不被 simple-git 拦截', async () => {
    // 宿主 shell（如 VS Code 集成终端）遗留的这些变量会被 simple-git
    // block-unsafe-operations 插件拦截；剥离 + unsafe 豁免后 initialize 必须照常工作。
    const polluted = [
      'GIT_EDITOR',
      'GIT_SEQUENCE_EDITOR',
      'EDITOR',
      'GIT_PROXY_COMMAND',
      'GIT_EXTERNAL_DIFF',
      'GIT_CONFIG_COUNT',
      'GIT_SSH_COMMAND',
      'GIT_SSH',
      'GIT_ASKPASS',
      'SSH_ASKPASS',
    ];
    const saved: Record<string, string | undefined> = {};
    for (const key of polluted) {
      saved[key] = process.env[key];
      process.env[key] = 'vim';
    }
    try {
      const result = await service.initialize(root);
      expect(result.status.repository).toBe(true);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('sanitizeGitProcessEnv 剥离拦截变量、保留 SSH 配置与常规环境', () => {
    const sanitized = sanitizeGitProcessEnv({
      GIT_EDITOR: 'vim',
      GIT_SEQUENCE_EDITOR: 'vim',
      EDITOR: 'vim',
      GIT_PROXY_COMMAND: 'proxy.sh',
      GIT_EXTERNAL_DIFF: 'difftool.sh',
      GIT_CONFIG_COUNT: '2',
      GIT_SSH_COMMAND: 'ssh -i ~/.ssh/id_ed25519',
      SSH_ASKPASS: '/usr/bin/ssh-askpass',
      PATH: '/usr/bin:/bin',
      HOME: '/Users/dev',
    });
    for (const key of [
      'GIT_EDITOR',
      'GIT_SEQUENCE_EDITOR',
      'EDITOR',
      'GIT_PROXY_COMMAND',
      'GIT_EXTERNAL_DIFF',
      'GIT_CONFIG_COUNT',
    ]) {
      expect(sanitized).not.toHaveProperty(key);
    }
    // SSH/askpass 是 vault 远程同步的真实依赖，必须原样保留（由 unsafe 豁免放行）。
    expect(sanitized.GIT_SSH_COMMAND).toBe('ssh -i ~/.ssh/id_ed25519');
    expect(sanitized.SSH_ASKPASS).toBe('/usr/bin/ssh-askpass');
    expect(sanitized.PATH).toBe('/usr/bin:/bin');
    expect(sanitized.HOME).toBe('/Users/dev');
  });

  it('同步护栏识别 OS 元数据和 .nexnote 运行时产物，但保留 allowlist', () => {
    expect(isVaultSyncGuardedPath('.DS_Store')).toBe(true);
    expect(isVaultSyncGuardedPath('docs/.DS_Store')).toBe(true);
    expect(isVaultSyncGuardedPath('Thumbs.db')).toBe(true);
    expect(isVaultSyncGuardedPath('assets/desktop.ini')).toBe(true);
    expect(isVaultSyncGuardedPath('.nexnote/index/index.db')).toBe(true);
    expect(isVaultSyncGuardedPath('.nexnote/config.json')).toBe(false);
    expect(isVaultSyncGuardedPath('.nexnote/layout.json')).toBe(false);
    expect(isVaultSyncGuardedPath('page.md')).toBe(false);
  });

  it('initialize 升级旧仓库时 untrack 本地产物和 OS 元数据但保留 config/layout', async () => {
    const git = simpleGit({ baseDir: root, binary: gitBinary() });
    await git.init();
    await git.addConfig('user.name', 'NexNote');
    await git.addConfig('user.email', 'noreply@nexnote.local');
    await fsp.mkdir(path.join(root, '.nexnote', 'index'), { recursive: true });
    await fsp.writeFile(path.join(root, '.nexnote', 'config.json'), '{}');
    await fsp.writeFile(path.join(root, '.nexnote', 'layout.json'), '{}');
    await fsp.writeFile(path.join(root, '.nexnote', 'index', 'legacy.db'), 'local');
    await fsp.writeFile(path.join(root, '.DS_Store'), 'metadata');
    await git.add(['.']);
    await git.commit('legacy vault');

    await service.initialize(root);

    const tracked = (await git.raw(['ls-files'])).split('\n');
    expect(tracked).toContain('.nexnote/config.json');
    expect(tracked).toContain('.nexnote/layout.json');
    expect(tracked).not.toContain('.nexnote/index/legacy.db');
    expect(tracked).not.toContain('.DS_Store');
    expect(await fsp.readFile(path.join(root, '.nexnote', 'index', 'legacy.db'), 'utf8')).toBe(
      'local',
    );
    expect(await fsp.readFile(path.join(root, '.DS_Store'), 'utf8')).toBe('metadata');
  });

  it.each(['manual', 'auto'] as const)(
    'ensureSyncGuard 后 %s 提交实际迁移 HEAD，保留磁盘',
    async (mode) => {
      const git = simpleGit({ baseDir: root, binary: gitBinary() });
      await git.init();
      await git.addConfig('user.name', 'NexNote');
      await git.addConfig('user.email', 'noreply@nexnote.local');
      await fsp.mkdir(path.join(root, '.nexnote', 'index'), { recursive: true });
      await fsp.writeFile(path.join(root, '.nexnote', 'index', 'legacy.db'), 'local');
      await fsp.writeFile(path.join(root, '.DS_Store'), 'metadata');
      await fsp.writeFile(path.join(root, 'page.md'), 'v1');
      await git.add(['.']);
      await git.commit('legacy vault');

      const before = await git.revparse('HEAD');
      await service.ensureSyncGuard(root);
      expect(await git.revparse('HEAD')).toBe(before);
      // 移除模板改动，让下一次提交仅剩迁移删除，不能靠 allowed.length 短路。
      await fsp.rm(path.join(root, '.gitignore'));
      if (mode === 'manual') await service.commitManual('after migration');
      else await service.commitAuto('after migration');
      expect(await git.revparse('HEAD')).not.toBe(before);
      expect(await fsp.readFile(path.join(root, '.DS_Store'), 'utf8')).toBe('metadata');

      const headPaths = (await git.raw(['ls-tree', '-r', '--name-only', 'HEAD'])).split('\n');
      expect(headPaths).not.toContain('.nexnote/index/legacy.db');
      expect(headPaths).not.toContain('.DS_Store');
      expect(headPaths).toContain('page.md');
    },
  );

  it('目录压缩和 pathspec magic 不会使违规文件进入提交', async () => {
    await service.initialize(root);
    await fsp.rm(path.join(root, '.gitignore'));
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(path.join(root, 'notes', '.DS_Store'), 'metadata');
    await fsp.writeFile(path.join(root, isWindows ? 'evil.md' : ':evil.md'), 'literal');

    await service.commitManual('literal paths');

    const git = simpleGit({ baseDir: root, binary: gitBinary() });
    const head = (await git.raw(['ls-tree', '-r', '--name-only', 'HEAD'])).split('\n');
    expect(head).toContain(isWindows ? 'evil.md' : ':evil.md');
    expect(head).not.toContain('notes/.DS_Store');
  });

  it('仅有未跟踪违规文件时 HEAD 和 index 不变且磁盘文件保留', async () => {
    await service.initialize(root);
    await fsp.rm(path.join(root, '.gitignore'));
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    const metadata = path.join(root, 'notes', '.DS_Store');
    await fsp.writeFile(metadata, 'metadata');
    const git = simpleGit({ baseDir: root, binary: gitBinary() });
    // Establish the missing-template baseline first: its tracked deletion must not
    // masquerade as a guarded-only change in the commit under test.
    await git.raw(['add', '-u', '--', '.gitignore']);
    await git.commit('remove template baseline');
    const before = await git.revparse('HEAD');

    await service.commitManual('only guarded');

    expect(await git.revparse('HEAD')).toBe(before);
    expect(await git.raw(['diff', '--cached', '--name-only', '-z'])).toBe('');
    await expect(git.raw(['ls-files', '--error-unmatch', 'notes/.DS_Store'])).rejects.toThrow();
    expect(await fsp.readFile(metadata, 'utf8')).toBe('metadata');
  });

  it('正常模板存在时跳过日志只记录违规文件数量', async () => {
    await service.initialize(root);
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(path.join(root, 'notes', '.DS_Store'), 'metadata');
    await fsp.writeFile(path.join(root, 'Thumbs.db'), 'metadata');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      await service.commitManual('guard count');
      expect(info).toHaveBeenCalledWith('[git] sync guard skipped:', 2);
      expect(info.mock.calls.flat().join(' ')).not.toContain('.DS_Store');
      expect(info.mock.calls.flat().join(' ')).not.toContain('Thumbs.db');
    } finally {
      info.mockRestore();
    }
  });

  it('HEAD 普通文件替换为同名目录时递归吸入被阻止', async () => {
    const git = simpleGit({ baseDir: root, binary: gitBinary() });
    await git.init();
    await git.addConfig('user.name', 'NexNote');
    await git.addConfig('user.email', 'noreply@nexnote.local');
    await fsp.writeFile(path.join(root, 'notes'), 'v1');
    await git.add(['.']);
    await git.commit('file baseline');

    await fsp.rm(path.join(root, 'notes'));
    await fsp.mkdir(path.join(root, 'notes'));
    await fsp.writeFile(path.join(root, 'notes', '.DS_Store'), 'metadata');

    await service.commitManual('file became directory');

    const head = (await git.raw(['ls-tree', '-r', '--name-only', 'HEAD'])).split('\n');
    expect(head).not.toContain('notes');
    expect(head).not.toContain('notes/.DS_Store');
    expect(await fsp.readFile(path.join(root, 'notes', '.DS_Store'), 'utf8')).toBe('metadata');
    await expect(git.raw(['ls-files', '--error-unmatch', 'notes/.DS_Store'])).rejects.toThrow();
  });

  it('目录内预暂存违规文件不会被叶子 staging 吸入', async () => {
    const git = simpleGit({ baseDir: root, binary: gitBinary() });
    await git.init();
    await git.addConfig('user.name', 'NexNote');
    await git.addConfig('user.email', 'noreply@nexnote.local');
    await fsp.writeFile(path.join(root, 'doc.md'), 'v1');
    await git.add(['.']);
    await git.commit('base');
    await fsp.mkdir(path.join(root, 'bundle'), { recursive: true });
    await fsp.writeFile(path.join(root, 'bundle', 'note.md'), 'content');
    await fsp.writeFile(path.join(root, 'bundle', '.DS_Store'), 'metadata');
    await git.raw(['add', '-f', '--', 'bundle/.DS_Store']);

    await service.commitManual('leaf staging');

    const head = (await git.raw(['ls-tree', '-r', '--name-only', 'HEAD'])).split('\n');
    expect(head).toContain('bundle/note.md');
    expect(head).not.toContain('bundle/.DS_Store');
    await expect(git.raw(['ls-files', '--error-unmatch', 'bundle/.DS_Store'])).rejects.toThrow();
  });

  it('预暂存允许文件不会泄漏，预暂存违规文件会作为迁移删除提交', async () => {
    const git = simpleGit({ baseDir: root, binary: gitBinary() });
    await git.init();
    await git.addConfig('user.name', 'NexNote');
    await git.addConfig('user.email', 'noreply@nexnote.local');
    await fsp.writeFile(path.join(root, 'staged.md'), 'v1');
    await fsp.writeFile(path.join(root, '.DS_Store'), 'v1');
    await git.add(['.']);
    await git.commit('base');
    await service.ensureSyncGuard(root);
    await fsp.writeFile(path.join(root, 'staged.md'), 'v2');
    await fsp.writeFile(path.join(root, '.DS_Store'), 'v2');
    await git.raw(['add', '-f', '--', 'staged.md', '.DS_Store']);

    await service.commitManual('staged isolation');

    const head = (await git.raw(['ls-tree', '-r', '--name-only', 'HEAD'])).split('\n');
    expect(head).not.toContain('.DS_Store');
    expect(await git.show(['HEAD:staged.md'])).toBe('v1');
    expect((await git.status()).staged).toContain('staged.md');
  });

  it('真实 cached deletion 不被 NexNote 提交吸收', async () => {
    const git = simpleGit({ baseDir: root, binary: gitBinary() });
    await git.init();
    await git.addConfig('user.name', 'NexNote');
    await git.addConfig('user.email', 'noreply@nexnote.local');
    await fsp.writeFile(path.join(root, 'a.md'), 'v1');
    await git.add(['.']);
    await git.commit('base');
    await fsp.rm(path.join(root, 'a.md'));
    await git.raw(['add', '-u', '--', 'a.md']);
    const headBefore = await git.revparse('HEAD');
    const cachedBefore = await git.raw(['diff', '--cached', '--name-status', '-z', '--no-renames']);
    const porcelainBefore = await git.raw(['status', '--porcelain=v1', '-z', '--no-renames']);

    await service.commitManual('must preserve cached deletion');

    expect(await git.revparse('HEAD')).toBe(headBefore);
    expect(await git.show(['HEAD:a.md'])).toBe('v1');
    expect(await git.raw(['diff', '--cached', '--name-status', '-z', '--no-renames'])).toBe(
      cachedBefore,
    );
    expect(await git.raw(['status', '--porcelain=v1', '-z', '--no-renames'])).toBe(porcelainBefore);
  });

  it('预暂存修改后删除文件不被吸收删除，保留用户 staged 状态', async () => {
    const git = simpleGit({ baseDir: root, binary: gitBinary() });
    await git.init();
    await git.addConfig('user.name', 'NexNote');
    await git.addConfig('user.email', 'noreply@nexnote.local');
    await fsp.writeFile(path.join(root, 'a.md'), 'v1');
    await git.add(['.']);
    await git.commit('base');
    // Stage v2, then delete from disk. The staged v2 blob and deletion intent belong to
    // the user; NexNote's commit must neither remove a.md from HEAD nor touch the index.
    await fsp.writeFile(path.join(root, 'a.md'), 'v2');
    await git.add(['--', 'a.md']);
    await fsp.rm(path.join(root, 'a.md'));
    const before = await git.revparse('HEAD');
    const indexOidBefore = (await git.raw(['ls-files', '-s', '--', 'a.md'])).trim().split(/\s+/)[1];

    await service.commitManual('must not delete staged-after-delete');

    expect(await git.revparse('HEAD')).toBe(before);
    expect(await git.show(['HEAD:a.md'])).toBe('v1');
    const indexLine = (await git.raw(['ls-files', '-s', '--', 'a.md'])).trim();
    const indexOidAfter = indexLine.split(/\s+/)[1];
    expect(indexOidAfter).toBe(indexOidBefore);
    const blob = await git.raw(['cat-file', '-p', indexOidAfter]);
    expect(blob).toBe('v2');
  });

  it('预暂存文件被替换为目录时不受 NexNote 提交影响', async () => {
    const git = simpleGit({ baseDir: root, binary: gitBinary() });
    await git.init();
    await git.addConfig('user.name', 'NexNote');
    await git.addConfig('user.email', 'noreply@nexnote.local');
    await fsp.writeFile(path.join(root, 'a.md'), 'v1');
    await git.add(['.']);
    await git.commit('base');
    // Stage v2 first, then replace the worktree file with a directory. The staged a.md
    // file owns the `a.md/` namespace, so inner.md must not enter NexNote's commit.
    await fsp.writeFile(path.join(root, 'a.md'), 'v2');
    await git.add(['--', 'a.md']);
    const indexOidBefore = (await git.raw(['ls-files', '-s', '--', 'a.md'])).trim().split(/\s+/)[1];
    await fsp.rm(path.join(root, 'a.md'));
    await fsp.mkdir(path.join(root, 'a.md'));
    await fsp.writeFile(path.join(root, 'a.md', 'inner.md'), 'inner');
    const before = await git.revparse('HEAD');
    const stagedBefore = await git.raw(['status', '--porcelain=v1', '-z', '--no-renames']);

    await service.commitManual('must not touch directory replacement');

    expect(await git.revparse('HEAD')).toBe(before);
    expect(await git.show(['HEAD:a.md'])).toBe('v1');
    expect((await git.raw(['ls-files', '-s', '--', 'a.md'])).trim().split(/\s+/)[1]).toBe(
      indexOidBefore,
    );
    expect(await git.raw(['status', '--porcelain=v1', '-z', '--no-renames'])).toBe(stagedBefore);
    await expect(git.raw(['ls-files', '--error-unmatch', 'a.md/inner.md'])).rejects.toThrow();
  });

  it('预暂存 rename 源和目标都不会被 NexNote 提交吸收', async () => {
    const git = simpleGit({ baseDir: root, binary: gitBinary() });
    await git.init();
    await git.addConfig('user.name', 'NexNote');
    await git.addConfig('user.email', 'noreply@nexnote.local');
    await fsp.writeFile(path.join(root, 'old.md'), 'content\n');
    await git.add(['.']);
    await git.commit('base');
    await fsp.rename(path.join(root, 'old.md'), path.join(root, 'new.md'));
    await git.add(['--all']);
    const stagedRename = await git.raw(['status', '--porcelain=v1', '-z', '--no-renames']);
    const before = await git.revparse('HEAD');

    await service.commitManual('must not absorb staged rename');

    expect(await git.revparse('HEAD')).toBe(before);
    expect(await git.show(['HEAD:old.md'])).toBe('content\n');
    const after = await git.raw(['status', '--porcelain=v1', '-z', '--no-renames']);
    expect(after).toBe(stagedRename);
  });

  it('删除 .gitignore 后手动提交仍不会暂存同步护栏路径', async () => {
    await service.initialize(root);
    await fsp.rm(path.join(root, '.gitignore'));
    await fsp.writeFile(path.join(root, 'page.md'), '# changed');
    await fsp.writeFile(path.join(root, '.DS_Store'), 'metadata');
    await fsp.mkdir(path.join(root, '.nexnote', 'index'), { recursive: true });
    await fsp.writeFile(path.join(root, '.nexnote', 'index', 'index.db'), 'db');

    await service.commitManual('guarded commit');

    const git = simpleGit({ baseDir: root, binary: gitBinary() });
    const tracked = (await git.raw(['ls-files'])).split('\n');
    expect(tracked).toContain('page.md');
    expect(tracked).not.toContain('.DS_Store');
    expect(tracked).not.toContain('.nexnote/index/index.db');
    const subject = await git.raw(['log', '-1', '--pretty=%s']);
    expect(subject).toContain('guarded commit');
  });

  it('无用户规则时普通数据库正常提交', async () => {
    await service.initialize(root);
    await fsp.writeFile(path.join(root, 'user.db'), 'database-bytes');
    await service.commitManual('user db');

    const git = simpleGit({ baseDir: root, binary: gitBinary() });
    expect((await git.raw(['ls-tree', '-r', '--name-only', 'HEAD'])).split('\n')).toContain(
      'user.db',
    );
    expect(await git.show(['HEAD:user.db'])).toBe('database-bytes');
    expect(await fsp.readFile(path.join(root, 'user.db'), 'utf8')).toBe('database-bytes');
  });

  it('ensureSyncGuard 保留用户规则字节、幂等且不泛屏蔽用户数据库', async () => {
    const original = '# user rules\n*.db\n!keep.db  \n';
    await fsp.writeFile(path.join(root, '.gitignore'), original);
    await simpleGit({ baseDir: root, binary: gitBinary() }).init();

    await service.ensureSyncGuard(root);
    const once = await fsp.readFile(path.join(root, '.gitignore'), 'utf8');
    await service.ensureSyncGuard(root);
    const twice = await fsp.readFile(path.join(root, '.gitignore'), 'utf8');

    expect(once.endsWith(original)).toBe(true);
    expect(twice).toBe(once);
    expect(once).not.toMatch(/^\.nexnote\/.*\.db/m);
    expect(once).not.toMatch(/^\*\.sqlite/m);
  });

  it('非 UTF-8 用户字节经模板前置后逐字节保留', async () => {
    const original = Buffer.from([0x23, 0x20, 0xff, 0x0a]);
    await fsp.writeFile(path.join(root, '.gitignore'), original);
    await simpleGit({ baseDir: root, binary: gitBinary() }).init();

    await service.ensureSyncGuard(root);

    const result = await fsp.readFile(path.join(root, '.gitignore'));
    expect(result.subarray(result.length - original.length)).toEqual(original);
    expect([...result]).toContain(0xff);
    expect(Buffer.from(result).includes(Buffer.from([0xef, 0xbf, 0xbd]))).toBe(false);
  });

  it.each([
    { eol: '\n', label: 'LF' },
    { eol: '\r\n', label: 'CRLF' },
  ])('$label 模板移动保留相邻用户行边界与反转语义', async ({ eol }) => {
    const git = simpleGit({ baseDir: root, binary: gitBinary() });
    await git.init();
    const userBefore = Buffer.from(`!/.DS_Store${eol}`, 'utf8');
    const template = Buffer.from(`${GitService.GITIGNORE_LINES.join(eol)}${eol}`, 'utf8');
    const userAfter = Buffer.from(`# tail${eol}`, 'utf8');
    await fsp.writeFile(
      path.join(root, '.gitignore'),
      Buffer.concat([userBefore, template, userAfter]),
    );
    await fsp.writeFile(path.join(root, '.DS_Store'), 'metadata');

    await service.ensureSyncGuard(root);

    const result = await fsp.readFile(path.join(root, '.gitignore'));
    const canonical = Buffer.from(`${GitService.GITIGNORE_LINES.join('\n')}\n`, 'utf8');
    expect(result.subarray(0, canonical.length)).toEqual(canonical);
    expect(result.subarray(canonical.length)).toEqual(Buffer.concat([userBefore, userAfter]));
    expect(countBufferOccurrences(result, canonical)).toBe(1);
    expect((await git.raw(['check-ignore', '.DS_Store'])).trim()).toBe('');
  });

  it.each([
    { eol: '\n', label: 'LF' },
    { eol: '\r\n', label: 'CRLF' },
  ])('$label 非行首伪模板不遮蔽后续合法模板', async ({ eol }) => {
    const git = simpleGit({ baseDir: root, binary: gitBinary() });
    await git.init();
    const template = Buffer.from(`${GitService.GITIGNORE_LINES.join(eol)}${eol}`, 'utf8');
    const inline = Buffer.concat([Buffer.from('# inline ', 'utf8'), template]);
    const between = Buffer.from(`!/.DS_Store${eol}${eol}`, 'utf8');
    await fsp.writeFile(path.join(root, '.gitignore'), Buffer.concat([inline, between, template]));
    await fsp.writeFile(path.join(root, '.DS_Store'), 'metadata');

    await service.ensureSyncGuard(root);

    const result = await fsp.readFile(path.join(root, '.gitignore'));
    const canonical = Buffer.from(`${GitService.GITIGNORE_LINES.join('\n')}\n`, 'utf8');
    expect(result.subarray(0, canonical.length)).toEqual(canonical);
    expect(result.subarray(canonical.length)).toEqual(Buffer.concat([inline, between]));
    expect(
      result.subarray(canonical.length).indexOf(Buffer.concat([Buffer.from('\n'), canonical])),
    ).toBe(-1);
    expect(result.includes(inline)).toBe(true);
    expect((await git.raw(['check-ignore', '.DS_Store'])).trim()).toBe('');
  });

  it('中间 CRLF 模板同样移动一次并保留前后用户字节', async () => {
    const git = simpleGit({ baseDir: root, binary: gitBinary() });
    await git.init();
    const prefix = Buffer.from('before.txt\r\n\r\n', 'utf8');
    const crlfTemplate = Buffer.from(`${GitService.GITIGNORE_LINES.join('\r\n')}\r\n`, 'utf8');
    const suffix = Buffer.from('\r\nafter.txt\r\n', 'utf8');
    await fsp.writeFile(
      path.join(root, '.gitignore'),
      Buffer.concat([prefix, crlfTemplate, suffix]),
    );

    await service.ensureSyncGuard(root);

    const result = await fsp.readFile(path.join(root, '.gitignore'));
    const canonical = Buffer.from(`${GitService.GITIGNORE_LINES.join('\n')}\n`, 'utf8');
    expect(result.subarray(0, canonical.length)).toEqual(canonical);
    expect(countBufferOccurrences(result, canonical)).toBe(1);
    expect(result.includes(prefix.subarray(0, 'before.txt'.length))).toBe(true);
    expect(result.includes(Buffer.from('after.txt\r\n'))).toBe(true);
    expect(result.includes(crlfTemplate)).toBe(false);
  });

  it('BOM 用户规则经模板前置后仍保持真实 Git ignore 语义', async () => {
    const git = simpleGit({ baseDir: root, binary: gitBinary() });
    await git.init();
    await fsp.writeFile(path.join(root, '.gitignore'), '\uFEFFsecret.txt\n');
    await fsp.writeFile(path.join(root, 'secret.txt'), 'secret');
    expect((await git.raw(['check-ignore', 'secret.txt'])).trim()).toBe('secret.txt');

    await service.ensureSyncGuard(root);

    expect((await git.raw(['check-ignore', 'secret.txt'])).trim()).toBe('secret.txt');
    expect((await fsp.readFile(path.join(root, '.gitignore'), 'utf8')).startsWith('\uFEFF')).toBe(
      true,
    );
  });

  it('拒绝 .. 折叠经过 symlink 的根路径，Git 操作不落到外部目录', async () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'nexnote-dotdot-parent-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'nexnote-dotdot-outside-'));
    const safeVault = path.join(parent, 'vault');
    await fsp.mkdir(safeVault);
    // /parent/link -> outside ；再以 /parent/link/../vault 形式折叠绕过
    await fsp.symlink(outside, path.join(parent, 'link'));
    const folded = `${parent}${path.sep}link${path.sep}..${path.sep}vault`;
    const outsideGitignore = path.join(outside, '.gitignore');
    try {
      await expect(service.writeDefaultGitignore(folded)).rejects.toMatchObject({
        code: 'INVALID_PATH',
      });
      await expect(fsp.access(outsideGitignore)).rejects.toThrow();
      // 中间组件同样覆盖：link 本身存在于 folded 路径中间。
      const nested = `${parent}${path.sep}link${path.sep}..${path.sep}deeper`;
      await expect(service.writeDefaultGitignore(nested)).rejects.toMatchObject({
        code: 'INVALID_PATH',
      });
    } finally {
      removeTempTree(parent);
      removeTempTree(outside);
    }
  });

  it.skipIf(isWindows)('ensureSyncGuard 拒绝 vault 根 symlink，不写入外部目录', async () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'nexnote-vault-link-parent-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'nexnote-vault-link-outside-'));
    const linkedRoot = path.join(parent, 'vault');
    await fsp.symlink(outside, linkedRoot);
    try {
      await expect(service.writeDefaultGitignore(linkedRoot)).rejects.toMatchObject({
        code: 'SYMLINK_COMPONENT',
      });
      await expect(fsp.access(path.join(outside, '.gitignore'))).rejects.toThrow();
    } finally {
      removeTempTree(parent);
      removeTempTree(outside);
    }
  });

  it.skipIf(isWindows)('ensureSyncGuard 拒绝 .gitignore symlink，不写入知识库外部', async () => {
    const outside = path.join(tmpdir(), `nexnote-ignore-${Date.now()}`);
    await fsp.writeFile(outside, 'outside');
    await fsp.symlink(outside, path.join(root, '.gitignore'));
    await simpleGit({ baseDir: root, binary: gitBinary() }).init();
    try {
      await expect(service.ensureSyncGuard(root)).rejects.toMatchObject({ code: 'INVALID_PATH' });
      expect(await fsp.readFile(outside, 'utf8')).toBe('outside');
    } finally {
      await fsp.rm(outside, { force: true });
    }
  });

  it.skipIf(isWindows)('ensureSyncGuard 拒绝 .gitignore 硬链接，不写入共享 inode', async () => {
    const outside = path.join(tmpdir(), `nexnote-ignore-hardlink-${Date.now()}`);
    await fsp.writeFile(outside, 'outside');
    await fsp.link(outside, path.join(root, '.gitignore'));
    await simpleGit({ baseDir: root, binary: gitBinary() }).init();
    try {
      await expect(service.ensureSyncGuard(root)).rejects.toMatchObject({ code: 'INVALID_PATH' });
      expect(await fsp.readFile(outside, 'utf8')).toBe('outside');
    } finally {
      await fsp.rm(outside, { force: true });
    }
  });

  it('空库 initialize 共用护栏并生成可识别的初始提交', async () => {
    await service.initialize(root);
    expect((await service.timeline())[0]).toMatchObject({ kind: 'initial', isHead: true });
    expect(await fsp.readFile(path.join(root, '.gitignore'), 'utf8')).toContain('.nexnote/');
  });

  it('normalizeDebounceMs 收敛到合法区间并回退默认', () => {
    expect(normalizeDebounceMs(undefined)).toBe(DEFAULT_DEBOUNCE_MS);
    expect(normalizeDebounceMs(NaN)).toBe(DEFAULT_DEBOUNCE_MS);
    expect(normalizeDebounceMs('x')).toBe(DEFAULT_DEBOUNCE_MS);
    // under min → min ; over max → max ; fractional → rounded
    expect(normalizeDebounceMs(1)).toBe(DEBOUNCE_RANGE_MS.min);
    expect(normalizeDebounceMs(DEBOUNCE_RANGE_MS.max + 1000)).toBe(DEBOUNCE_RANGE_MS.max);
    expect(normalizeDebounceMs(1500.4)).toBe(1500);
  });

  it('setDebounceMs 持久化到 GitService 并被 scheduleAutoCommit 使用', async () => {
    await service.initialize(root);
    const accepted = service.setDebounceMs(1234);
    expect(accepted).toBe(1234);
    expect(service.getDebounceMs()).toBe(1234);
    // clamp below min
    expect(service.setDebounceMs(10)).toBe(DEBOUNCE_RANGE_MS.min);
    // scheduleAutoCommit with no arg uses the configured debounce
    const file = path.join(root, 'debounce.md');
    await fsp.writeFile(file, 'v1');
    const started = Date.now();
    service.scheduleAutoCommit('debounce');
    // 500ms floor must fire; on shared runners the commit lands later, so poll until it does.
    const deadline = Date.now() + 10_000;
    let log = await service.timeline();
    while (
      Date.now() < deadline &&
      !log.some((e) => e.kind === 'auto' && e.message.includes('debounce'))
    ) {
      await new Promise((r) => setTimeout(r, 50));
      log = await service.timeline();
    }
    expect(log.some((e) => e.kind === 'auto' && e.message.includes('debounce'))).toBe(true);
    expect(Date.now() - started).toBeLessThan(30_000);
  });

  it('scheduleAutoCommit 对每次调用的 override 同样强制 500ms 下限', async () => {
    await service.initialize(root);
    const file = path.join(root, 'notes', 'page.md');
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, 'v1');
    service.scheduleAutoCommit('保存 notes/page.md', 50);
    // CI 共享 runner 的 FS 抖动会让 init/auto 提交落地晚于固定 sleep；按截止时间轮询而非猜时序。
    const waitForCommits = async (count: number, deadlineMs: number) => {
      const deadline = Date.now() + deadlineMs;
      let log = await service.timeline();
      while (Date.now() < deadline && log.length < count) {
        await new Promise((r) => setTimeout(r, 50));
        log = await service.timeline();
      }
      return log;
    };
    await waitForCommits(2, 10_000);
    const log = await service.timeline();
    expect(log).toHaveLength(2);
    expect(log[0]!.kind).toBe('auto');
    expect(log[0]!.message).toMatch(/保存 notes\/page\.md/);
  });

  it('restore and preview reject root, lexical directory, and symlink escape targets', async () => {
    await service.initialize(root);
    const commit = (await service.timeline())[0]!.hash;
    await expect(service.restoreFile('.', commit)).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(service.previewRestore('notes/.', commit)).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });

    const outside = mkdtempSync(path.join(tmpdir(), 'nexnote-restore-outside-'));
    try {
      await fsp.writeFile(path.join(outside, 'secret.md'), 'secret');
      await fsp.symlink(outside, path.join(root, 'escape'));
      await expect(service.previewRestore('escape/secret.md', commit)).rejects.toMatchObject({
        code: 'INVALID_PATH',
      });
      await expect(service.restoreFile('escape/secret.md', commit)).rejects.toMatchObject({
        code: 'INVALID_PATH',
      });
    } finally {
      removeTempTree(outside);
    }
  });

  it('auto commit refuses conflict marker files even without unmerged index state', async () => {
    await service.initialize(root);
    await fsp.writeFile(
      path.join(root, 'marker.md'),
      '<<<<<<< local\na\n=======\nb\n>>>>>>> remote\n',
    );
    await service.commitAuto('不得提交标记冲突');
    expect(
      (await service.timeline()).every((entry) => !entry.message.includes('不得提交标记冲突')),
    ).toBe(true);
  });

  it('cloneInto 拒绝经过 symlink 祖先的目标且不写入外部目录', async () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'nexnote-clone-link-parent-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'nexnote-clone-link-outside-'));
    const linked = path.join(parent, 'linked');
    await fsp.symlink(outside, linked);
    try {
      await expect(service.cloneInto('unused', linked, 'vault')).rejects.toMatchObject({
        code: 'SYMLINK_COMPONENT',
      });
      expect(await fsp.readdir(outside)).toEqual([]);
    } finally {
      removeTempTree(parent);
      removeTempTree(outside);
    }
  });

  it('remote text strips credentials before IPC-facing results', () => {
    const secret = 'https://alice:token-123@example.test/repo.git?access_token=abc&token=def';
    const redacted = sanitizeRemoteText(secret);
    expect(redacted).not.toContain('token-123');
    expect(redacted).not.toContain('abc');
    expect(redacted).not.toContain('def');
    expect(redacted).toContain('https://***@');
  });

  it('remote text strips modern credential variants', () => {
    const samples = [
      'Authorization: Bearer sk-live-abcdef123',
      'Authorization: Basic dXNlcjpwYXNz',
      'Authorization: Token ghp_1234567890',
      'fatal: client_secret=supersecret call failed',
      "remote: api_key: 'AKIA1234567890'",
      'https://example.test/repo?client_secret=cs-1&api_key=ak-1',
    ];
    for (const sample of samples) {
      const redacted = sanitizeRemoteText(sample);
      expect(redacted, sample).not.toContain('sk-live-abcdef123');
      expect(redacted, sample).not.toContain('dXNlcjpwYXNz');
      expect(redacted, sample).not.toContain('ghp_1234567890');
      expect(redacted, sample).not.toContain('supersecret');
      expect(redacted, sample).not.toContain('AKIA1234567890');
      expect(redacted, sample).not.toContain('cs-1');
      expect(redacted, sample).not.toContain('ak-1');
    }
  });

  it('commitManual 创建带 manual 前缀的提交，kind=manual', async () => {
    await service.initialize(root);
    const file = path.join(root, 'manual.md');
    await fsp.writeFile(file, 'manual content');
    const result = await service.commitManual('首次手写提交');
    expect(result.status.repository).toBe(true);
    const log = await service.timeline();
    expect(log[0]!.kind).toBe('manual');
    expect(log[0]!.message).toMatch(/nexnote:manual:/);
  });

  it('onStatusChanged 在 initialize / commitAuto / commitManual / restoreFile 后触发', async () => {
    const events: Array<Record<string, unknown>> = [];
    service.onStatusChanged((status) => events.push({ ...status }));
    await service.initialize(root);
    expect(events.length).toBe(1);
    expect(events[0]!.repository).toBe(true);

    await fsp.writeFile(path.join(root, 'events.md'), 'v1');
    await service.commitAuto('自动保存');
    expect(events.length).toBe(2);

    await fsp.writeFile(path.join(root, 'events.md'), 'v2');
    await service.commitManual('手动保存');
    expect(events.length).toBe(3);

    const log = await service.timeline();
    await service.restoreFile('events.md', log[1]!.hash);
    expect(events.length).toBe(4);
    service.onStatusChanged(null);
  });

  it('setRoot(null) 取消待执行的自动提交（不会在关闭后提交）', async () => {
    await service.initialize(root);
    await fsp.writeFile(path.join(root, 'pending.md'), 'uncommitted');
    service.scheduleAutoCommit('不应提交', 30);
    service.setRoot(null);
    await new Promise((r) => setTimeout(r, 200));
    // 重新指回 root 验证：没有任何 auto 提交产生
    service.setRoot(root);
    const log = await service.timeline();
    expect(log.some((entry) => entry.message.includes('不应提交'))).toBe(false);
    // 工作区仍有未提交变更
    const status = await service.status();
    expect(status.changed).toBeGreaterThan(0);
  });

  it('timeline(path) 只返回涉及指定文件的提交（--follow）', async () => {
    await service.initialize(root);
    await fsp.writeFile(path.join(root, 'A.md'), 'A1');
    await service.commitAuto('保存 A.md');
    await fsp.writeFile(path.join(root, 'B.md'), 'B1');
    await service.commitAuto('保存 B.md');
    const onlyA = await service.timeline('A.md');
    expect(onlyA.length).toBe(1);
    expect(onlyA[0]!.message).toMatch(/A\.md/);
  });

  it('预览 + 恢复：写两个版本，restoreFile 生成新提交且内容回到目标版本', async () => {
    await service.initialize(root);
    const file = path.join(root, 'doc.md');
    await fsp.writeFile(file, 'line1\n');
    await service.commitAuto('版本 1');
    await fsp.writeFile(file, 'line1\nline2 new\n');
    await service.commitAuto('版本 2');
    // An unrelated staged edit must not be included in the restore commit.
    await fsp.writeFile(path.join(root, 'unrelated.md'), 'keep staged\n');
    const git = simpleGit({ baseDir: root, binary: gitBinary() });
    await git.add(['unrelated.md']);
    const log = await service.timeline();
    const target = log[1]!.hash;
    const preview = await service.previewRestore('doc.md', target);
    expect(preview.target).toBe('line1\n');
    const restore = await service.restoreFile('doc.md', target);
    expect(restore.message).toMatch(/恢复/);
    const after = await fsp.readFile(file, 'utf8');
    expect(after).toBe('line1\n');
    const newLog = await service.timeline();
    expect(newLog[0]!.kind).toBe('restore');
    expect(newLog[0]!.message).toMatch(/nexnote:restore:/);
    const restoreFiles = await git.raw(['show', '--pretty=format:', '--name-only', 'HEAD']);
    expect(restoreFiles.trim()).toBe('doc.md');
    expect((await git.status()).staged).toContain('unrelated.md');
  });

  it('远程：file:// 本地 bare 仓库 push 与 pull 完整往返', async () => {
    const remoteRoot = mkdtempSync(path.join(tmpdir(), 'nexnote-remote-'));
    execFileSync(gitBinary(), ['init', '--bare', '--initial-branch=master', remoteRoot], {
      stdio: 'ignore',
    });
    try {
      await service.initialize(root);
      const events: Array<{ remote: string | null; ahead: number; behind: number }> = [];
      service.onStatusChanged((status) => events.push(status));
      await fsp.writeFile(path.join(root, 'shared.md'), 'hello from local\n');
      await service.commitAuto('本地初稿');
      const add = await service.addRemote('origin', remoteRoot);
      expect(add.status.remote).toBe('origin');
      expect(events.at(-1)?.remote).toBe('origin');
      // 推送当前分支
      execFileSync(gitBinary(), ['push', '-u', 'origin', 'HEAD'], { cwd: root, stdio: 'ignore' });
      expect((await service.status()).ahead).toBe(0);

      // 在远端裸仓基础上新建一个克隆，模拟协作方
      const otherRoot = mkdtempSync(path.join(tmpdir(), 'nexnote-clone-'));
      try {
        execFileSync(gitBinary(), ['clone', remoteRoot, otherRoot], { stdio: 'ignore' });
        configureTestIdentity(otherRoot);
        const newRemoteLog = path.join(otherRoot, 'shared.md');
        await fsp.writeFile(newRemoteLog, 'hello from local\nadd a new line\n');
        execFileSync(gitBinary(), ['add', '.'], { cwd: otherRoot, stdio: 'ignore' });
        execFileSync(gitBinary(), ['commit', '-m', 'collaborator edit'], {
          cwd: otherRoot,
          stdio: 'ignore',
        });
        execFileSync(gitBinary(), ['push'], { cwd: otherRoot, stdio: 'ignore' });

        // 主仓库拉取应看到新提交
        const beforePullEvents = events.length;
        const pulled = await service.pull();
        expect(pulled.status.repository).toBe(true);
        expect(events.length).toBeGreaterThan(beforePullEvents);
        const afterPull = await fsp.readFile(path.join(root, 'shared.md'), 'utf8');
        expect(afterPull).toBe('hello from local\nadd a new line\n');
      } finally {
        removeTempTree(otherRoot);
      }

      // 本地再修改推回
      await fsp.writeFile(
        path.join(root, 'shared.md'),
        'hello from local\nadd a new line\nlocal ack\n',
      );
      await service.commitManual('本地回写');
      const beforePushEvents = events.length;
      const pushed = await service.push();
      expect(pushed.status.ahead).toBe(0);
      expect(events.length).toBeGreaterThan(beforePushEvents);
    } finally {
      removeTempTree(remoteRoot);
    }
  });

  it('远程预检失败时抛 REMOTE_AUTH_FAILED', async () => {
    await service.initialize(root);
    await expect(
      service.addRemote('origin', 'https://127.0.0.1:1/never.git'),
    ).rejects.toMatchObject({
      code: 'REMOTE_AUTH_FAILED',
    });
  });

  it('pull 在冲突时抛 MERGE_CONFLICT', async () => {
    const remoteRoot = mkdtempSync(path.join(tmpdir(), 'nexnote-remote-conflict-'));
    try {
      execFileSync(gitBinary(), ['init', '--bare', '--initial-branch=master', remoteRoot], {
        stdio: 'ignore',
      });
      await service.initialize(root);
      await fsp.writeFile(path.join(root, 'c.md'), 'A\nB\nC\n');
      await service.commitAuto('base');
      await service.addRemote('origin', remoteRoot);
      execFileSync(gitBinary(), ['push', '-u', 'origin', 'HEAD'], { cwd: root, stdio: 'ignore' });

      // 分叉：本地修改并提交
      await fsp.writeFile(path.join(root, 'c.md'), 'A\nlocal-edited\nC\n');
      await service.commitAuto('local edit');

      // 在远端裸仓的镜像上添加提交
      const shadow = mkdtempSync(path.join(tmpdir(), 'nexnote-shadow-'));
      try {
        execFileSync(gitBinary(), ['clone', remoteRoot, shadow], { stdio: 'ignore' });
        configureTestIdentity(shadow);
        await fsp.writeFile(path.join(shadow, 'c.md'), 'A\nremote-edited\nC\n');
        execFileSync(gitBinary(), ['add', '.'], { cwd: shadow, stdio: 'ignore' });
        execFileSync(gitBinary(), ['commit', '-m', 'remote edit'], {
          cwd: shadow,
          stdio: 'ignore',
        });
        execFileSync(gitBinary(), ['push'], { cwd: shadow, stdio: 'ignore' });
      } finally {
        removeTempTree(shadow);
      }

      await expect(service.pull()).rejects.toMatchObject({ code: 'MERGE_CONFLICT' });
      const beforeAuto = (await service.timeline()).length;
      await service.commitAuto('不得提交未解决冲突');
      const afterAuto = await service.timeline();
      expect(afterAuto).toHaveLength(beforeAuto);
      expect(afterAuto.every((entry) => !entry.message.includes('不得提交未解决冲突'))).toBe(true);
    } finally {
      removeTempTree(remoteRoot);
    }
  });

  it('addRemote 拒绝带 .. 的非法路径', async () => {
    await service.initialize(root);
    await expect(service.addRemote('origin', '../../../etc/passwd')).rejects.toBeInstanceOf(
      GitServiceError,
    );
  });

  it('previewRestore 对不存在文件返回 null current，对目标内容返回', async () => {
    await service.initialize(root);
    await fsp.writeFile(path.join(root, 'doc.md'), 'origin\n');
    await service.commitAuto('seed');
    await fsp.rm(path.join(root, 'doc.md'));
    await service.commitAuto('remove');
    const log = await service.timeline();
    const before = log[1]!.hash;
    const preview = await service.previewRestore('doc.md', before);
    expect(preview.current).toBeNull();
    expect(preview.target).toBe('origin\n');
  });
});

// DEV-076：sync 阶段事件应经 syncProgressListener 全局可监听。
// 包括自动同步触发的那一次——修复前 setInterval 内部传 onProgress: undefined，
// 导致 UI 完全静默收不到阶段/终态文案，spinner 也没法收尾。
describe.runIf(runIfGit())('DEV-076 GitService syncProgressListener 全局可达', () => {
  it('sync() 的 error 路径会发 fetching 起头 + 终态给 onSyncProgress listener', async () => {
    await service.initialize(root);
    const events: Array<{ phase: string; message?: string }> = [];
    service.onSyncProgress((event) => events.push(event));
    try {
      await service.sync({ strategy: 'rebase' });
    } catch {
      // 没有远程时必然报错；本测试只关心 listener 是否被调用
    } finally {
      service.onSyncProgress(null);
    }
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.phase).toBe('fetching');
    expect(events.some((e) => e.phase === 'done' || e.phase === 'error')).toBe(true);
  });

  it('configureAutoSync 的 sync 调用注入 syncProgressListener 作为 onProgress（等价验证）', async () => {
    // 等价验证"自动同步路径"的全局 listener 可达性：
    // 注册 listener → configureAutoSync → 等一次 setInterval 触发
    // → 验证 sync() 收到 onProgress 与 listener 是同一引用。
    // 若实现回退为 onProgress: undefined（DEV-076 修复前），此测试失败。
    // 注意：intervalSec 会被 Math.round，最小非零值是 1 秒。
    await service.initialize(root);
    const listener = vi.fn();
    service.onSyncProgress(listener);

    let capturedOnProgress: unknown = undefined;
    let callCount = 0;
    const originalSync = service.sync.bind(service);
    Object.defineProperty(service, 'sync', {
      value: (async (options: Parameters<typeof service.sync>[0]) => {
        callCount += 1;
        capturedOnProgress = options.onProgress;
        // 不真正跑 git（避免 1s 窗口内被 IO 拖过），返回占位 status
        return { message: 'skip', status: baseStatusForTest() };
      }) as typeof service.sync,
      writable: true,
      configurable: true,
    });

    service.configureAutoSync(1, 'rebase');
    await new Promise((r) => setTimeout(r, 1600));
    service.stopAutoSync();
    Object.defineProperty(service, 'sync', {
      value: originalSync,
      writable: true,
      configurable: true,
    });
    service.onSyncProgress(null);

    expect(callCount).toBeGreaterThan(0);
    expect(capturedOnProgress).toBe(listener);
  });
});

function baseStatusForTest(): GitStatus {
  return {
    repository: true,
    branch: 'main',
    changed: 0,
    ahead: 0,
    behind: 0,
    remote: null,
    conflict: false,
    usingSystemGit: true,
  };
}

describe.runIf(runIfGit())('DEV-082 rebase/merge in-progress 时的自动提交与中止', () => {
  // 现实里一个 paused rebase 是在 `git rebase` 撞到内容冲突时自然形成的，
  // 但生产 git 在没有 TTY 的测试环境里行为不稳（自动 3-way merge / rerere
  // 可能让 rebase 直接成功）。这里直接手工伪造 `.git/rebase-merge/` 的最小
  // 文件集，保证 GitService.isRebaseOrMergeInProgress() 一定返回 true。
  async function setupPausedRebase(): Promise<{ cleanup: () => void }> {
    await service.initialize(root);
    const headSha = execFileSync(gitBinary(), ['rev-parse', 'HEAD'], { cwd: root })
      .toString()
      .trim();
    const rebaseDir = path.join(root, '.git', 'rebase-merge');
    mkdirSync(rebaseDir, { recursive: true });
    writeFileSync(path.join(rebaseDir, 'head-name'), 'refs/heads/master\n');
    writeFileSync(path.join(rebaseDir, 'onto'), `${headSha}\n`);
    writeFileSync(path.join(rebaseDir, 'orig-head'), `${headSha}\n`);
    writeFileSync(path.join(rebaseDir, 'msgnum'), '1\n');
    return {
      cleanup: () => {
        rmSync(rebaseDir, { recursive: true, force: true });
      },
    };
  }

  it('commitAuto 在 rebase 暂停时拒绝创建提交，不修改 HEAD', async () => {
    const { cleanup } = await setupPausedRebase();
    try {
      const before = execFileSync(gitBinary(), ['rev-parse', 'HEAD'], { cwd: root }).toString();
      const beforeCount = (await service.timeline()).length;
      const listener = vi.fn();
      service.onStatusChanged(listener);
      await fsp.writeFile(path.join(root, 'extra.md'), 'extra\n');
      await service.commitAuto('保存页面');
      const after = execFileSync(gitBinary(), ['rev-parse', 'HEAD'], { cwd: root }).toString();
      expect(after).toBe(before);
      expect((await service.timeline()).length).toBe(beforeCount);
      expect(listener).toHaveBeenCalled();
      const last = listener.mock.calls.at(-1)?.[0] as { rebaseInProgress?: boolean } | undefined;
      expect(last?.rebaseInProgress).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('scheduleAutoCommit 在 rebase 暂停时调度窗口不落地为提交', async () => {
    const { cleanup } = await setupPausedRebase();
    try {
      await fsp.writeFile(path.join(root, 'extra.md'), 'extra\n');
      service.scheduleAutoCommit('保存页面', 50);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const timeline = await service.timeline();
      expect(timeline.some((entry) => entry.message.includes('保存页面'))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('abortInProgressRebaseOrMerge 清理 rebase-merge/ 并回到干净 HEAD', async () => {
    const { cleanup } = await setupPausedRebase();
    try {
      const before = execFileSync(gitBinary(), ['rev-parse', 'HEAD'], { cwd: root }).toString();
      const result = await service.abortInProgressRebaseOrMerge();
      expect(result.message).toMatch(/rebase/);
      const gitDirRaw = execFileSync(gitBinary(), ['rev-parse', '--git-dir'], { cwd: root })
        .toString();
      const gitDir = path.join(root, gitDirRaw.trim());
      const rebaseMergeExists = await fsp
        .access(path.join(gitDir, 'rebase-merge'))
        .then(() => true)
        .catch(() => false);
      const rebaseApplyExists = await fsp
        .access(path.join(gitDir, 'rebase-apply'))
        .then(() => true)
        .catch(() => false);
      expect(rebaseMergeExists).toBe(false);
      expect(rebaseApplyExists).toBe(false);
      const after = execFileSync(gitBinary(), ['rev-parse', 'HEAD'], { cwd: root }).toString();
      expect(after).toBe(before);
      const status = await service.status();
      expect(status.rebaseInProgress).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('abortInProgressRebaseOrMerge 在没有进行中操作时抛 NO_OPERATION', async () => {
    await service.initialize(root);
    await fsp.writeFile(path.join(root, 'doc.md'), 'hi\n');
    await service.commitAuto('seed');
    await expect(service.abortInProgressRebaseOrMerge()).rejects.toMatchObject({
      code: 'NO_OPERATION',
    });
  });
});

