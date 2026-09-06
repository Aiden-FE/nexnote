import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const run = (script: string, args: string[], env = {}) => spawnSync(process.execPath, [resolve(root, 'scripts', script), ...args], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });

describe('release policy executable gates', () => {
  it('requires an explicit matching semver release tag', () => {
    expect(run('check-version.mjs', ['--require-tag']).status).toBe(1);
    expect(run('check-version.mjs', ['--require-tag', 'master']).status).toBe(1);
    expect(run('check-version.mjs', ['--require-tag', 'dev/DEV-018']).status).toBe(1);
    expect(run('check-version.mjs', ['--require-tag', 'v9.9.9']).status).toBe(1);
    expect(run('check-version.mjs', ['--require-tag', 'v0.1.0']).status).toBe(0);
  });

  it('fails closed for missing evidence and binds attestation to the run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-evidence-'));
    const file = join(dir, 'evidence.json');
    const env = {
      GITHUB_REPOSITORY: 'Aiden-FE/nexnote', GITHUB_RUN_ID: '123',
      GITHUB_REF_NAME: 'v0.1.0', GITHUB_SHA: 'a'.repeat(40), RELEASE_CHANNEL: 'stable',
      QA_EVIDENCE_URL: 'https://github.com/Aiden-FE/nexnote/issues/1',
      QA_EVIDENCE_SHA256: 'b'.repeat(64), QA_ALL_REQUIRED_CHECKS_PASSED: 'true',
    };
    try {
      expect(run('release-evidence.mjs', ['create', file], { ...env, QA_ALL_REQUIRED_CHECKS_PASSED: 'false' }).status).not.toBe(0);
      expect(run('release-evidence.mjs', ['create', file], env).status).toBe(0);
      expect(run('release-evidence.mjs', ['validate', file], env).status).toBe(0);
      expect(run('release-evidence.mjs', ['validate', file], { ...env, GITHUB_RUN_ID: '124' }).status).not.toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('remote ref create-if-absent rejects a second unique owner until release', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-lock-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    try {
      git('init', '--bare', 'remote.git');
      git('init', 'client');
      const opts = { cwd: join(dir, 'client'), encoding: 'utf8' as const, env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' } };
      const tree = execFileSync('git', ['mktree'], { ...opts, input: '' }).trim();
      const owners = ['one', 'two'].map((input) => execFileSync('git', ['commit-tree', tree], { ...opts, input }).trim());
      const ref = 'refs/heads/release-publication-lock';
      const push = (owner: string, expected = '') => spawnSync('git', ['push', `--force-with-lease=${ref}:${expected}`, '../remote.git', `${owner}:${ref}`], opts).status;
      expect(push(owners[0]!)).toBe(0);
      expect(push(owners[1]!)).not.toBe(0);
      expect(push('', owners[0]!)).toBe(0);
      expect(push(owners[1]!)).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
