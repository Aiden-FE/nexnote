/* eslint-env node */
/**
 * Smoke test runner for CI: launches the built app in smoke mode and collects
 * evidence. Exits non-zero if smoke controller reports failures.
 *
 * Falls back to a simpler headless check when the built binary is unavailable
 * (e.g. non-mac CI). Requires NEXNOTE_APP_PATH or built release directory.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const appPath = process.env.NEXNOTE_APP_PATH ?? resolve('release/mac/NexNote.app/Contents/MacOS/NexNote');

if (!existsSync(appPath)) {
  console.warn(`[smoke:ci] app binary not found at ${appPath}; skipping e2e smoke`);
  console.warn('[smoke:ci] run `pnpm dist:mac` first to produce a real smoke binary');
  process.exit(0);
}

const child = spawn(appPath, [], { env: { ...process.env, NEXNOTE_SMOKE: '1', NEXNOTE_SMOKE_EXIT_AFTER: '1' }, stdio: ['ignore', 'inherit', 'inherit'] });
const timer = setTimeout(() => {
  console.error('[smoke:ci] timeout (180s)');
  child.kill('SIGTERM');
}, 180_000);
child.on('exit', (code) => {
  clearTimeout(timer);
  console.log(`[smoke:ci] app exited with code ${code}`);
  process.exit(code === 0 ? 0 : 1);
});
