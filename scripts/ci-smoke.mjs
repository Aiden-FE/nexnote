/* eslint-env node */
/**
 * Smoke test runner for CI: launches the built app in smoke mode and collects
 * evidence. Exits non-zero if smoke controller reports failures.
 *
 * Requires a real packaged binary. Missing artifacts are a hard failure so the
 * publication workflow can never report a skipped smoke test as passing.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
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
rmSync(outputDir, { recursive: true, force: true });
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
// The full integration scenario can exceed three minutes on a cold packaged run.
// Keep the default for CI; permit an explicit local timeout for comprehensive smoke evidence.
const expectedSha = process.env.NEXNOTE_SMOKE_CANDIDATE_SHA;
const expectedVersion = process.env.NEXNOTE_SMOKE_EXPECTED_VERSION;
const expectedElectron = process.env.NEXNOTE_SMOKE_EXPECTED_ELECTRON_VERSION;
const expectedPlatform = process.env.NEXNOTE_SMOKE_EXPECTED_PLATFORM;
const expectedAbi = process.env.NEXNOTE_SMOKE_EXPECTED_ABI;
if (!expectedSha || !/^[0-9a-f]{40}$/.test(expectedSha)) {
  console.error('[smoke:ci] NEXNOTE_SMOKE_CANDIDATE_SHA must be a full 40-character commit SHA');
  process.exit(1);
}
for (const [name, value] of [
  ['NEXNOTE_SMOKE_EXPECTED_VERSION', expectedVersion],
  ['NEXNOTE_SMOKE_EXPECTED_ELECTRON_VERSION', expectedElectron],
  ['NEXNOTE_SMOKE_EXPECTED_PLATFORM', expectedPlatform],
  ['NEXNOTE_SMOKE_EXPECTED_ABI', expectedAbi],
]) {
  if (!value) {
    console.error(`[smoke:ci] ${name} is required`);
    process.exit(1);
  }
}
const startedAtMs = Date.now();
const timeoutMs = Number(process.env.NEXNOTE_SMOKE_TIMEOUT_MS ?? 180_000);
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  console.error(`[smoke:ci] timeout (${timeoutMs}ms)`);
  child.kill('SIGTERM');
}, timeoutMs);
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  console.log(`[smoke:ci] app exited with code ${code}${signal ? ` signal=${signal}` : ''}`);
  if (timedOut || code !== 0) process.exit(1);
  const reportPath = join(outputDir, 'results.json');
  if (!existsSync(reportPath)) {
    console.error('[smoke:ci] smoke exited without results.json');
    process.exit(1);
  }
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const checks = Array.isArray(report.checks) ? report.checks : [];
    const bound = report.candidateSha === expectedSha;
    const reportStat = statSync(reportPath);
    const freshReport = reportStat.mtimeMs >= startedAtMs;
    const metadata =
      report.platform === expectedPlatform &&
      report.electronVersion === expectedElectron &&
      report.appVersion === expectedVersion &&
      report.electronAbi === expectedAbi;
    if (
      !freshReport ||
      !checks.length ||
      !checks.every((check) => check?.passed === true) ||
      !bound ||
      !metadata
    ) {
      console.error('[smoke:ci] invalid, failed, or unbound smoke report');
      process.exit(1);
    }
  } catch (error) {
    console.error(
      `[smoke:ci] cannot validate results.json: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
  process.exit(0);
});
