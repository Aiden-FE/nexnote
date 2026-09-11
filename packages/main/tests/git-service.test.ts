import { execFileSync } from 'node:child_process';
import { promises as fsp, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GitService,
  GitServiceError,
  DEFAULT_DEBOUNCE_MS,
  DEBOUNCE_RANGE_MS,
  normalizeDebounceMs,
  sanitizeRemoteText,
} from '../src/git/git-service';

const SKIP = process.env.NEXNOTE_SKIP_GIT_TESTS === '1';

function gitBinary(): string {
  return process.env.NEXNOTE_TEST_GIT ?? 'git';
}

function systemGitAvailable(): boolean {
  try {
    execFileSync(gitBinary(), ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
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
  rmSync(root, { recursive: true, force: true });
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

    // The config MUST be tracked (versioned); the index MUST NOT be tracked.
    const tracked = await simpleGit({ baseDir: root, binary: gitBinary() }).raw(['ls-files']);
    expect(tracked).toContain('.nexnote/config.json');
    expect(tracked).not.toContain('.nexnote/index/');

    const log = await service.timeline();
    expect(log.length).toBe(1);
    expect(log[0]!.kind).toBe('initial');
    expect(log[0]!.isHead).toBe(true);
  });

  it('initialize 升级旧仓库时 untrack 本地产物但保留 config/layout', async () => {
    const git = simpleGit({ baseDir: root, binary: gitBinary() });
    await git.init();
    await git.addConfig('user.name', 'NexNote');
    await git.addConfig('user.email', 'noreply@nexnote.local');
    await fsp.mkdir(path.join(root, '.nexnote', 'index'), { recursive: true });
    await fsp.writeFile(path.join(root, '.nexnote', 'config.json'), '{}');
    await fsp.writeFile(path.join(root, '.nexnote', 'layout.json'), '{}');
    await fsp.writeFile(path.join(root, '.nexnote', 'index', 'legacy.db'), 'local');
    await git.add(['.']);
    await git.commit('legacy vault');

    await service.initialize(root);

    const tracked = (await git.raw(['ls-files'])).split('\n');
    expect(tracked).toContain('.nexnote/config.json');
    expect(tracked).toContain('.nexnote/layout.json');
    expect(tracked).not.toContain('.nexnote/index/legacy.db');
    expect(await fsp.readFile(path.join(root, '.nexnote', 'index', 'legacy.db'), 'utf8')).toBe(
      'local',
    );
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
    // The configured 500ms floor fires within ~1s instead of default 30s.
    await new Promise((r) => setTimeout(r, 1000));
    const log = await service.timeline();
    expect(log.some((e) => e.kind === 'auto' && e.message.includes('debounce'))).toBe(true);
    expect(Date.now() - started).toBeLessThan(30_000);
  });

  it('scheduleAutoCommit 对每次调用的 override 同样强制 500ms 下限', async () => {
    await service.initialize(root);
    const file = path.join(root, 'notes', 'page.md');
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, 'v1');
    service.scheduleAutoCommit('保存 notes/page.md', 50);
    await new Promise((r) => setTimeout(r, 250));
    expect(await service.timeline()).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 450));
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
      rmSync(outside, { recursive: true, force: true });
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
        rmSync(otherRoot, { recursive: true, force: true });
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
      rmSync(remoteRoot, { recursive: true, force: true });
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
        await fsp.writeFile(path.join(shadow, 'c.md'), 'A\nremote-edited\nC\n');
        execFileSync(gitBinary(), ['add', '.'], { cwd: shadow, stdio: 'ignore' });
        execFileSync(gitBinary(), ['commit', '-m', 'remote edit'], {
          cwd: shadow,
          stdio: 'ignore',
        });
        execFileSync(gitBinary(), ['push'], { cwd: shadow, stdio: 'ignore' });
      } finally {
        rmSync(shadow, { recursive: true, force: true });
      }

      await expect(service.pull()).rejects.toMatchObject({ code: 'MERGE_CONFLICT' });
      const beforeAuto = (await service.timeline()).length;
      await service.commitAuto('不得提交未解决冲突');
      const afterAuto = await service.timeline();
      expect(afterAuto).toHaveLength(beforeAuto);
      expect(afterAuto.every((entry) => !entry.message.includes('不得提交未解决冲突'))).toBe(true);
    } finally {
      rmSync(remoteRoot, { recursive: true, force: true });
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
