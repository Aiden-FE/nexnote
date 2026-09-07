/* eslint-env node */
/**
 * Smoke test runner for CI: launches the built app in smoke mode and collects
 * evidence. Exits non-zero if smoke controller reports failures.
 *
 * Requires a real packaged binary. Missing artifacts are a hard failure so the
 * publication workflow can never report a skipped smoke test as passing.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const appPath =
  process.env.NEXNOTE_APP_PATH ?? resolve('release/mac/NexNote.app/Contents/MacOS/NexNote');

if (!existsSync(appPath)) {
  console.error(`[smoke:ci] app binary not found at ${appPath}`);
  console.error('[smoke:ci] a real packaged application is required');
  process.exit(1);
}

const outputDir =
  process.env.NEXNOTE_SMOKE_OUTPUT_DIR ?? mkdtempSync(join(tmpdir(), 'nexnote-smoke-results-'));
console.log(`[smoke:ci] writable evidence directory: ${outputDir}`);
const child = spawn(appPath, [], {
  env: {
    ...process.env,
    NEXNOTE_SMOKE: '1',
    NEXNOTE_SMOKE_EXIT_AFTER: '1',
    NEXNOTE_SMOKE_OUTPUT_DIR: outputDir,
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const timer = setTimeout(() => {
  console.error('[smoke:ci] timeout (180s)');
  child.kill('SIGTERM');
}, 180_000);
child.on('exit', (code) => {
  clearTimeout(timer);
  console.log(`[smoke:ci] app exited with code ${code}`);
  process.exit(code === 0 ? 0 : 1);
});
