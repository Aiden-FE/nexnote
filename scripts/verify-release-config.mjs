/* eslint-disable no-console */
/**
 * Validate electron-builder configs + release workflow metadata without building packages.
 * Used in CI to catch config errors fast. Requires js-yaml (devDependency).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = yaml.load(readFileSync(resolve(root, 'electron-builder.yml'), 'utf8'));
const releaseWorkflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');
const devWorkflow = readFileSync(resolve(root, '.github/workflows/pr-check.yml'), 'utf8');
const updater = readFileSync(resolve(root, 'packages/main/src/updater.ts'), 'utf8');
const runBuilder = readFileSync(resolve(root, 'scripts/run-builder.mjs'), 'utf8');
const notarize = readFileSync(resolve(root, 'scripts/notarize.cjs'), 'utf8');
const smoke = readFileSync(resolve(root, 'scripts/ci-smoke.mjs'), 'utf8');
const appStore = readFileSync(resolve(root, 'packages/main/src/vault/app-store.ts'), 'utf8');
const qaChecklist = readFileSync(resolve(root, 'docs/release/QA-CHECKLIST.md'), 'utf8');
const dependabot = readFileSync(resolve(root, '.github/dependabot.yml'), 'utf8');
const checkVersion = readFileSync(resolve(root, 'scripts/check-version.mjs'), 'utf8');
const releaseEvidence = readFileSync(resolve(root, 'scripts/release-evidence.mjs'), 'utf8');

// The git origin is the single source of truth for the publish repository.
let originOwner = '';
let originRepo = '';
try {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim();
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
  if (m) {
    originOwner = m[1];
    originRepo = m[2];
  }
} catch {
  /* origin may be unavailable outside a git checkout */
}

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
check('publish 仓库与 git origin 一致且非占位符', () => {
  const providers = cfg.publish ?? [];
  const gh = providers.find((p) => p.provider === 'github');
  if (!gh) throw new Error('no github publish');
  if (gh.owner !== 'Aiden-FE' || gh.repo !== 'nexnote') throw new Error(`publish repository must be Aiden-FE/nexnote, got ${gh.owner}/${gh.repo}`);
  if (originOwner && (gh.owner !== originOwner || gh.repo !== originRepo)) throw new Error(`publish ${gh.owner}/${gh.repo} != origin ${originOwner}/${originRepo}`);
  if (!runBuilder.includes(`REPO_OWNER = 'Aiden-FE'`)) throw new Error('run-builder owner placeholder or mismatch');
  if (!updater.includes(`REPO_OWNER = 'Aiden-FE'`)) throw new Error('updater owner placeholder or mismatch');
});
check('asar 启用且 unpack 含 dugite', () => {
  if (!cfg.asar) throw new Error('asar disabled');
  const unpack = cfg.asarUnpack ?? [];
  if (!unpack.some((p) => String(p).includes('dugite'))) throw new Error('dugite not in asarUnpack');
});
check('macOS entitlements 文件已声明', () => {
  if (!cfg.mac?.entitlements) throw new Error('mac entitlements missing');
});
check('macOS 签名与公证是强制 gate', () => {
  if (cfg.mac?.hardenedRuntime !== true) throw new Error('hardenedRuntime required for notarization');
  if (!cfg.afterSign && !cfg.mac?.afterSign) throw new Error('afterSign hook missing');
  if (/skipping notarization|credentials absent; skipping/i.test(notarize)) throw new Error('notarization must not be skippable');
  if (!/throw new Error/.test(notarize)) throw new Error('missing notarization credentials must fail');
  for (const command of ['codesign --verify --deep --strict', 'xcrun stapler validate', 'spctl --assess']) {
    if (!releaseWorkflow.includes(command)) throw new Error(`missing macOS verification: ${command}`);
  }
});
check('channel 接线：build env → 打包发布 → updater 烘焙通道', () => {
  if (!/NEXNOTE_UPDATE_CHANNEL:\s*\$\{\{\s*needs\.prepare\.outputs\.channel/.test(releaseWorkflow)) {
    throw new Error('release.yml build env must export NEXNOTE_UPDATE_CHANNEL from prepare.outputs.channel');
  }
  if (!/output.*channel/.test(releaseWorkflow)) {
    throw new Error('prepare job must output the resolved channel');
  }
  if (!/readBakedChannel|app-update\.yml/.test(updater)) throw new Error('updater must read the baked channel from app-update.yml');
  if (!/VALID_CHANNELS/.test(updater)) throw new Error('updater has no channel validation');
  if (!/updateChannel/.test(appStore) || !/setUpdateChannel\(channel/.test(appStore)) throw new Error('selected update channel is not persisted in AppStore');
  if (!/appStore\.get\(\)\.updateChannel/.test(readFileSync(resolve(root, 'packages/main/src/index.ts'), 'utf8'))) throw new Error('main updater does not restore persisted channel');
});
check('publish 在上传前必须是 hard gate（签名缺失则失败）', () => {
  if (!releaseWorkflow.includes('--publish never')) throw new Error('build must use --publish never');
  if (releaseWorkflow.includes('--publish always')) throw new Error('build must not publish concurrently (publish race)');
  if (/runner\.os == 'macOS'/.test(releaseWorkflow) && !/codesign --verify --deep --strict/.test(releaseWorkflow)) {
    throw new Error('macOS must verify signature before upload');
  }
  if (/runner\.os == 'Windows'/.test(releaseWorkflow) && !/Get-AuthenticodeSignature/.test(releaseWorkflow)) {
    throw new Error('Windows must verify Authenticode before upload');
  }
  if (/runner\.os == 'Linux'/.test(releaseWorkflow) && !/gpg --verify/.test(releaseWorkflow)) {
    throw new Error('Linux must verify .asc signature before upload');
  }
});
check('平台密钥最小权限且仅 step 级引用', () => {
  const build = /  build:\n([\s\S]*?)(?=\n  smoke:)/.exec(releaseWorkflow)?.[1] ?? '';
  const jobEnv = /\n    env:\n([\s\S]*?)(?=\n    steps:)/.exec(build)?.[1] ?? '';
  if (/secrets\./.test(jobEnv)) throw new Error('secrets must not appear in build job env');
  const scopes = [
    ['MACOS_CERTIFICATE', "if: runner.os == 'macOS'"],
    ['WINDOWS_CERTIFICATE', "if: runner.os == 'Windows'"],
    ['LINUX_GPG_PRIVATE_KEY', "if: runner.os == 'Linux'"],
  ];
  for (const [secret, platformGuard] of scopes) {
    const index = build.indexOf(secret);
    if (index < 0) throw new Error(`missing ${secret}`);
    const stepStart = build.lastIndexOf('- name:', index);
    if (stepStart < 0 || !build.slice(stepStart, index).includes(platformGuard)) throw new Error(`${secret} is not platform-scoped`);
  }
});
check('单个 publish job，经受保护 QA Environment 与 evidence gate 后才公开', () => {
  const wf = yaml.load(releaseWorkflow);
  const jobs = Object.keys(wf.jobs ?? {});
  if (!jobs.includes('publish')) throw new Error('no publish job');
  if (wf.jobs.publish.strategy) throw new Error('publish must not be a matrix');
  if (wf.jobs.build?.permissions?.contents === 'write') throw new Error('build must not have release write permission');
  if (wf.jobs.publish?.permissions?.contents !== 'write') throw new Error('publish must hold the only contents: write permission');
  if (JSON.stringify(wf.jobs.publish?.needs) !== JSON.stringify(['prepare', 'smoke'])) throw new Error('publish must wait for prepare and smoke');
  if (wf.jobs.publish?.environment?.name !== 'release-qa') throw new Error('publish must require release-qa protected Environment approval');
  if (wf.concurrency) throw new Error('GitHub concurrency drops older pending runs; durable publisher lease must be used instead');
  if (!/required reviewers/.test(releaseWorkflow) || !/QA checklist evidence/.test(releaseWorkflow)) throw new Error('workflow must document required-reviewer QA evidence approval');
  if (!/release-qa-evidence\.json/.test(releaseWorkflow) || !/release-evidence\.mjs validate/.test(releaseWorkflow)) throw new Error('publish must validate a machine-readable run-bound evidence manifest');
  if (!/Preflight signed artifact set/.test(releaseWorkflow) || !/softprops\/action-gh-release/.test(releaseWorkflow)) throw new Error('publish requires preflight then single uploader');
});
check('workflow_dispatch 只能发布 existing immutable tag 且版本必须匹配', () => {
  const wf = yaml.load(releaseWorkflow);
  if (!wf.on?.workflow_dispatch || Object.keys(wf.on).some((event) => event !== 'workflow_dispatch')) throw new Error('public release must be dispatch-only');
  const inputs = wf.on.workflow_dispatch.inputs ?? {};
  for (const name of ['release-tag', 'qa-evidence-url', 'qa-evidence-sha256', 'qa-all-required-checks-passed']) {
    if (inputs[name]?.required !== true) throw new Error(`required dispatch input missing: ${name}`);
  }
  if (!/refs\/tags\/\$RELEASE_TAG\^\{commit\}/.test(releaseWorkflow)) throw new Error('dispatch tag must resolve to an existing tag commit');
  if (!/check-version\.mjs --require-tag/.test(releaseWorkflow) || !/--require-tag/.test(checkVersion)) throw new Error('release path must require explicit tag/version match');
  if (/no tag provided[\s\S]*process\.exit\(0\)/.test(checkVersion) && !/if \(required\)/.test(checkVersion)) throw new Error('required release check may not pass without a tag');
  if (!/tag_name:\s*\$\{\{ needs\.prepare\.outputs\.tag \}\}/.test(releaseWorkflow)) throw new Error('publisher must target resolved immutable tag');
});
check('publisher 使用不丢队列的 durable remote-ref lease 与幂等 tag release', () => {
  if (!/release-publication-lock/.test(releaseWorkflow)) throw new Error('fixed publication lease ref missing');
  if (!/--force-with-lease=refs\/heads\/release-publication-lock:/.test(releaseWorkflow)) throw new Error('atomic acquire/release lease guards missing');
  if (!/for attempt in \$\(seq 1 180\)/.test(releaseWorkflow)) throw new Error('lease contenders must retry rather than be dropped');
  if (!/run remains failed and rerunnable, never silently dropped/.test(releaseWorkflow)) throw new Error('lease timeout behavior must be explicit and rerunnable');
  if (!/tag_name:/.test(releaseWorkflow)) throw new Error('release retries must be idempotent by immutable tag');
});
check('Linux GPG 在上传前签名，所有 .asc 均作为 Release asset', () => {
  if (!/Linux GPG private key is required/.test(releaseWorkflow)) throw new Error('Linux key may not be optional');
  if (!/gpg --batch --yes --armor --detach-sign/.test(releaseWorkflow) || !/gpg --verify/.test(releaseWorkflow)) throw new Error('linux artifacts must be signed and verified');
  if (!/release\/\*\.AppImage release\/\*\.deb/.test(releaseWorkflow)) throw new Error('AppImage and deb must be signed');
  if (!/files: release\/\*\*\/\*/.test(releaseWorkflow)) throw new Error('publish glob must include release/**/* to capture .asc');
});
check('smoke 缺产物必须失败且 QA 文档 gate 顺序一致', () => {
  if (/skipping e2e smoke|process\.exit\(0\)/.test(smoke)) throw new Error('smoke script may not skip missing artifact');
  if (!/process\.exit\(1\)/.test(smoke)) throw new Error('smoke must fail without packaged app');
  if (!/事实边界/.test(qaChecklist) || !/未进行.*跨平台物理安装/.test(qaChecklist)) throw new Error('QA checklist must truthfully record physical-validation boundary');
  if (!/release-qa.*Environment.*审批前必须全部完成/.test(qaChecklist)) throw new Error('manual QA must be explicitly required before Environment approval');
  if (!/After public publication \(monitoring, not a publication gate\)/.test(qaChecklist)) throw new Error('post-publication checks must be separated from publication gates');
  const postPublication = qaChecklist.split('## After public publication')[1] ?? '';
  if (/🔒/.test(postPublication)) throw new Error('no publication gate may appear after public publication');
});
check('所有 GitHub Actions 使用 immutable SHA 并由 Dependabot 维护', () => {
  const workflowFiles = ['.github/workflows/pr-check.yml', '.github/workflows/nightly.yml', '.github/workflows/release.yml'];
  const useLine = /^\s*-\s+uses:\s+([^\s#]+)(?:\s+#.*)?$/gm;
  for (const file of workflowFiles) {
    const source = readFileSync(resolve(root, file), 'utf8');
    for (const match of source.matchAll(useLine)) {
      const ref = match[1].split('@')[1];
      if (!ref || !/^[0-9a-f]{40}$/.test(ref)) throw new Error(`${file} has unpinned action: ${match[1]}`);
    }
  }
  if (!/package-ecosystem:\s*github-actions/.test(dependabot)) throw new Error('Dependabot github-actions update strategy missing');
  if (!/softprops\/action-gh-release@[0-9a-f]{40}/.test(releaseWorkflow)) throw new Error('release publisher must be pinned by full SHA');
  if (!/Aiden-FE\\\/nexnote/.test(releaseEvidence) || !/allRequiredChecksPassed/.test(releaseEvidence)) throw new Error('QA evidence validator must bind canonical repository and all-checks attestation');
});
check('PR 检查覆盖 lint/typecheck/test/build', () => {
  if (!/pnpm lint/.test(devWorkflow)) throw new Error('pr-check missing lint');
  if (!/pnpm typecheck/.test(devWorkflow)) throw new Error('pr-check missing typecheck');
  if (!/pnpm test/.test(devWorkflow)) throw new Error('pr-check missing test');
  if (!/pnpm build/.test(devWorkflow)) throw new Error('pr-check missing build');
});

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? '✅' : '❌'} ${c.label}${c.ok ? '' : ` — ${c.error}`}`);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} release config checks passed.`);
