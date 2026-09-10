import { execFileSync } from 'node:child_process';
import { promises as fsp, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitService } from '../src/git/git-service';

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
  root = mkdtempSync(path.join(tmpdir(), 'nexnote-git-formats-'));
  service = new GitService({ useSystemGit: true, defaultDebounceMs: 50, minCommitIntervalMs: 0 });
  service.setRoot(root);
});

afterEach(() => {
  if (!runIfGit() || !root) return;
  service.cancelAutoCommit();
  rmSync(root, { recursive: true, force: true });
});

describe.runIf(runIfGit())('Git 文档历史多格式', () => {
  it('confidenceHistory 覆盖 .md/.markdown/.docx 且不含 .nexnote sidecar', async () => {
    await service.initialize(root);
    await fsp.writeFile(path.join(root, 'page.md'), '# md');
    await fsp.writeFile(path.join(root, 'note.markdown'), '# markdown');
    await fsp.writeFile(path.join(root, 'report.docx'), Buffer.from('PK\u0003\u0004docx-bytes'));
    await fsp.mkdir(path.join(root, '.nexnote', 'metadata'), { recursive: true });
    await fsp.writeFile(path.join(root, '.nexnote', 'metadata', 'cGFnZS5tZA.json'), '{}');
    await service.commitManual('multi-format');

    const history = await service.confidenceHistory();
    expect(history.has('page.md')).toBe(true);
    expect(history.has('note.markdown')).toBe(true);
    expect(history.has('report.docx')).toBe(true);
    expect([...history.keys()].some((f) => f.startsWith('.nexnote/'))).toBe(false);
  });
});
