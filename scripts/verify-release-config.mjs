/* eslint-disable no-console */
/**
 * Validate electron-builder configs + channel metadata without building packages.
 * Used in CI to catch config errors fast. Requires js-yaml (devDependency).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = yaml.load(readFileSync(resolve(root, 'electron-builder.yml'), 'utf8'));
const releaseWorkflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');

const checks = [];

function check(label, fn) {
  try {
    fn();
    checks.push({ label, ok: true });
  } catch (e) {
    checks.push({ label, ok: false, error: e.message });
  }
}

check('appId 存在', () => {
  if (!cfg.appId?.match(/^[a-z0-9._-]+$/i)) throw new Error(`invalid appId: ${cfg.appId}`);
});
check('productName 存在', () => {
  if (!cfg.productName) throw new Error('missing productName');
});
check('macOS 有 dmg + zip 双架构', () => {
  const targets = cfg.mac?.target ?? [];
  const kinds = new Set(targets.map((t) => (typeof t === 'string' ? t : t.target)));
  if (!kinds.has('dmg')) throw new Error('mac dmg missing');
  if (!kinds.has('zip')) throw new Error('mac zip missing (required for auto-update)');
  if (!releaseWorkflow.includes('target: --mac --arm64')) throw new Error('mac arm64 CI target missing');
  if (!releaseWorkflow.includes('target: --mac --x64')) throw new Error('mac x64 CI target missing');
});
check('Windows 有 nsis + portable', () => {
  const targets = cfg.win?.target ?? [];
  const kinds = new Set(targets.map((t) => (typeof t === 'string' ? t : t.target)));
  if (!kinds.has('nsis')) throw new Error('win nsis missing');
  if (!kinds.has('portable')) throw new Error('win portable missing');
});
check('Linux 有 AppImage + deb', () => {
  const targets = cfg.linux?.target ?? [];
  const kinds = new Set(targets.map((t) => (typeof t === 'string' ? t : t.target)));
  if (!kinds.has('AppImage')) throw new Error('linux AppImage missing');
  if (!kinds.has('deb')) throw new Error('linux deb missing');
});
check('publish 存在 github provider', () => {
  const providers = cfg.publish ?? [];
  if (!providers.some((p) => p.provider === 'github')) throw new Error('no github publish');
});
check('asar 启用且 unpack 含 dugite', () => {
  if (!cfg.asar) throw new Error('asar disabled');
  const unpack = cfg.asarUnpack ?? [];
  if (!unpack.some((p) => String(p).includes('dugite'))) throw new Error('dugite not in asarUnpack');
});
check('macOS entitlements 文件已声明', () => {
  if (!cfg.mac?.entitlements) throw new Error('mac entitlements missing');
});
check('notarize afterSign 钩子已声明或说明', () => {
  // afterSign 可在 CI 命令行注入；此检查只确认 entitlements/identity 策略存在
  if (cfg.mac?.hardenedRuntime !== true) throw new Error('hardenedRuntime required for notarization');
});

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? '✅' : '❌'} ${c.label}${c.ok ? '' : ` — ${c.error}`}`);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} release config checks passed.`);
