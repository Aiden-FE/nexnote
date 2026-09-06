import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';
import { GitService } from '../src/git/git-service';

const enabled = process.env.NEXNOTE_GIT_ACCEPT === '1';
const scenarios = [
  ['HTTPS public', process.env.NEXNOTE_GIT_HTTPS_PUBLIC_URL],
  ['SSH private', process.env.NEXNOTE_GIT_SSH_PRIVATE_URL],
] as const;
const roots: string[] = [];
const branches: Array<{ url: string; branch: string; cwd: string }> = [];

function temp(label: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `nexnote-${label}-`));
  roots.push(root);
  return root;
}

function raw(cwd: string, args: string[]): void {
  execFileSync(process.env.NEXNOTE_TEST_GIT ?? 'git', args, { cwd, stdio: 'inherit' });
}

afterAll(() => {
  if (process.env.NEXNOTE_GIT_KEEP_BRANCH !== '1') {
    for (const { url, branch, cwd } of branches) {
      try {
        raw(cwd, ['push', url, '--delete', branch]);
      } catch {
        // Reported by Git; continue cleanup for the other protocol.
      }
    }
  }
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe.runIf(enabled)('credentialed GitService remote acceptance', () => {
  for (const [label, url] of scenarios) {
    it(`${label}: GitService addRemote/push/pull round trip`, async () => {
      if (!url)
        throw new Error(
          `Missing ${label === 'HTTPS public' ? 'NEXNOTE_GIT_HTTPS_PUBLIC_URL' : 'NEXNOTE_GIT_SSH_PRIVATE_URL'}`,
        );
      const branch = `nexnote-acceptance-${Date.now()}-${label.startsWith('HTTPS') ? 'https' : 'ssh'}`;
      const first = temp('accept-first');
      const second = temp('accept-second');
      const firstService = new GitService({ useSystemGit: true, minCommitIntervalMs: 0 });
      firstService.setRoot(first);
      await firstService.initialize(first);
      const firstGit = simpleGit({ baseDir: first });
      await firstGit.checkoutLocalBranch(branch);
      await firstService.addRemote('origin', url);
      await firstGit.raw(['commit', '--allow-empty', '-m', 'nexnote:acceptance: initial push']);
      await firstService.push();
      branches.push({ url, branch, cwd: first });

      raw(second, ['init']);
      const secondGit = simpleGit({ baseDir: second });
      await secondGit.addRemote('origin', url);
      await secondGit.fetch('origin', branch);
      await secondGit.checkout(['-b', branch, '--track', `origin/${branch}`]);
      const secondService = new GitService({ useSystemGit: true, minCommitIntervalMs: 0 });
      secondService.setRoot(second);
      await secondGit.raw(['commit', '--allow-empty', '-m', 'nexnote:acceptance: collaborator']);
      await secondService.push();

      const before = (await firstService.timeline()).length;
      await firstService.pull();
      expect((await firstService.timeline()).length).toBeGreaterThan(before);
    });
  }
});
