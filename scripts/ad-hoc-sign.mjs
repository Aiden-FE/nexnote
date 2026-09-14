/* eslint-disable no-console */
/**
 * electron-builder afterSign hook for certificate-free macOS distribution.
 *
 * Without a Developer ID certificate, seal the complete .app bundle with Apple's
 * Ad hoc identity (`-`) and verify the resulting code signature. Ad hoc signing
 * is not notarization and does not make Gatekeeper trust the application.
 */
import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Locate the .app bundle electron-builder placed in appOutDir. */
function findAppBundle(appOutDir) {
  if (!appOutDir) return undefined;
  for (const name of readdirSync(appOutDir)) {
    if (name.endsWith('.app')) return join(appOutDir, name);
  }
  return undefined;
}

/** Run codesign and retain both output streams for useful diagnostics. */
function runCodesign(args) {
  return new Promise((resolve) => {
    execFile('/usr/bin/codesign', args, (error, stdout, stderr) => {
      resolve({
        code: error ? (error.code ?? 1) : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      });
    });
  });
}

/**
 * @param {import('electron-builder').AfterSignContext} context
 */
export default async function afterSign(context) {
  if (process.platform !== 'darwin') return;

  // When a real certificate is supplied, electron-builder owns signing and this
  // hook must not replace the Developer ID identity with Ad hoc.
  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    console.log(
      '[ad-hoc-sign] Developer ID credentials detected; keeping electron-builder signature.',
    );
    return;
  }

  const appPath = findAppBundle(context.appOutDir);
  if (!appPath) {
    throw new Error(`[ad-hoc-sign] no .app bundle found in appOutDir=${context.appOutDir}`);
  }

  console.log(`[ad-hoc-sign] signing ${appPath} with the Ad hoc identity`);
  const sign = await runCodesign(['--force', '--deep', '--sign', '-', appPath]);
  if (sign.code !== 0) {
    throw new Error(`[ad-hoc-sign] codesign failed (exit ${sign.code}):\n${sign.stderr}`);
  }

  const verify = await runCodesign(['--verify', '--deep', '--strict', appPath]);
  if (verify.code !== 0) {
    throw new Error(
      `[ad-hoc-sign] signature verification failed (exit ${verify.code}):\n${verify.stderr}`,
    );
  }

  // codesign -d writes its details to stderr. Confirm that this was genuinely
  // Ad hoc, rather than silently accepting an unexpected signing identity.
  const details = await runCodesign(['-dv', '--verbose=4', appPath]);
  const dump = `${details.stdout}\n${details.stderr}`;
  if (details.code !== 0 || !/Signature\s*=\s*adhoc/i.test(dump)) {
    throw new Error(`[ad-hoc-sign] signature is not Ad hoc:\n${dump}`);
  }
  console.log('[ad-hoc-sign] Ad hoc signature applied and verified.');
}
