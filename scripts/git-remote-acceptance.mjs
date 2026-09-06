#!/usr/bin/env node
/* global process, console */
/**
 * Credential-driven DEV-007 acceptance: proves an authenticated HTTPS and SSH
 * remote can both push and pull the same disposable branch. No credential is
 * read or written by this script; Git uses the caller's credential helper and
 * SSH agent. Set NEXNOTE_GIT_ACCEPT=1 to acknowledge the remote will receive
 * three small commits on a new nexnote-acceptance-* branch.
 *
 * Required:
 *   NEXNOTE_GIT_HTTPS_URL=https://host/org/private-repo.git
 *   NEXNOTE_GIT_SSH_URL=git@host:org/private-repo.git
 * Optional: NEXNOTE_GIT_ACCEPT_BRANCH=known-disposable-branch
 *           NEXNOTE_GIT_KEEP_BRANCH=1 (diagnostics only; default cleanup deletes it)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const httpsUrl = process.env.NEXNOTE_GIT_HTTPS_URL;
const sshUrl = process.env.NEXNOTE_GIT_SSH_URL;
if (process.env.NEXNOTE_GIT_ACCEPT !== '1' || !httpsUrl || !sshUrl) {
  console.error(
    'Refusing to run. Set NEXNOTE_GIT_ACCEPT=1, NEXNOTE_GIT_HTTPS_URL, and NEXNOTE_GIT_SSH_URL.',
  );
  process.exit(2);
}

const branch = process.env.NEXNOTE_GIT_ACCEPT_BRANCH ?? `nexnote-acceptance-${Date.now()}`;
const root = mkdtempSync(join(tmpdir(), 'nexnote-git-acceptance-'));
const httpsDir = join(root, 'https');
const sshDir = join(root, 'ssh');
const git = (cwd, args) => execFileSync('git', args, { cwd, stdio: 'inherit' });
const configure = (cwd) => {
  git(cwd, ['config', 'user.name', 'NexNote acceptance']);
  git(cwd, ['config', 'user.email', 'noreply@nexnote.local']);
};
const commit = (cwd, filename, text, message) => {
  writeFileSync(join(cwd, filename), `${text}\n`, 'utf8');
  git(cwd, ['add', filename]);
  git(cwd, ['commit', '-m', message]);
};

try {
  git(root, ['clone', httpsUrl, httpsDir]);
  configure(httpsDir);
  git(httpsDir, ['checkout', '-b', branch]);
  commit(httpsDir, 'HTTPS_ACCEPTANCE.md', 'HTTPS push', 'nexnote:acceptance: HTTPS push');
  git(httpsDir, ['push', '-u', 'origin', branch]);

  git(root, ['clone', '--branch', branch, sshUrl, sshDir]);
  configure(sshDir);
  commit(sshDir, 'SSH_ACCEPTANCE.md', 'SSH push', 'nexnote:acceptance: SSH push');
  git(sshDir, ['push', 'origin', branch]);

  git(httpsDir, ['pull', '--ff-only', 'origin', branch]);
  commit(
    httpsDir,
    'HTTPS_PULL_CONFIRMED.md',
    'HTTPS pulled SSH commit',
    'nexnote:acceptance: HTTPS pull',
  );
  git(httpsDir, ['push', 'origin', branch]);
  git(sshDir, ['pull', '--ff-only', 'origin', branch]);
  console.log(`PASS: HTTPS and SSH push/pull succeeded on ${branch}`);
} finally {
  // The acceptance branch is always removed remotely, including after a partial
  // failure once either clone exists. Keep NEXNOTE_GIT_KEEP_BRANCH=1 only for
  // intentional diagnostics; the default leaves the credentialed repository clean.
  if (process.env.NEXNOTE_GIT_KEEP_BRANCH !== '1') {
    for (const cwd of [httpsDir, sshDir]) {
      try {
        git(cwd, ['push', 'origin', '--delete', branch]);
        break;
      } catch {
        // Try the other protocol clone; neither existing means no branch was pushed.
      }
    }
  } else {
    console.log(`NEXNOTE_GIT_KEEP_BRANCH=1: retained remote branch ${branch}`);
  }
  rmSync(root, { recursive: true, force: true });
}
