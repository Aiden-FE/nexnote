/* eslint-disable no-console */
/**
 * Validate electron-builder configs + release workflow metadata without building packages.
 * Used in CI to catch config errors fast. Requires js-yaml (devDependency).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = yaml.load(readFileSync(resolve(root, 'electron-builder.yml'), 'utf8'));
const releaseWorkflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');
const devWorkflow = readFileSync(resolve(root, '.github/workflows/pr-check.yml'), 'utf8');
const nightlyWorkflow = readFileSync(resolve(root, '.github/workflows/nightly.yml'), 'utf8');
const updater = readFileSync(resolve(root, 'packages/main/src/updater.ts'), 'utf8');
const runBuilder = readFileSync(resolve(root, 'scripts/run-builder.mjs'), 'utf8');
const adHocSign = readFileSync(resolve(root, 'scripts/ad-hoc-sign.mjs'), 'utf8');
const smoke = readFileSync(resolve(root, 'scripts/ci-smoke.mjs'), 'utf8');
const appStore = readFileSync(resolve(root, 'packages/main/src/vault/app-store.ts'), 'utf8');
const qaChecklist = readFileSync(resolve(root, 'docs/release/QA-CHECKLIST.md'), 'utf8');
const dependabot = readFileSync(resolve(root, '.github/dependabot.yml'), 'utf8');
const checkVersion = readFileSync(resolve(root, 'scripts/check-version.mjs'), 'utf8');
const packageJson = readFileSync(resolve(root, 'package.json'), 'utf8');
const releaseEvidence = readFileSync(resolve(root, 'scripts/release-evidence.mjs'), 'utf8');

// The git origin is the single source of truth for the publish repository.
let originOwner = '';
let originRepo = '';
try {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
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
check('native macOS/Windows installer icons exist', () => {
  for (const file of ['build/icon.icns', 'build/icon.ico']) {
    try {
      if (readFileSync(resolve(root, file)).length < 32) throw new Error('too small');
    } catch {
      throw new Error(`native icon missing: ${file}`);
    }
  }
  if (cfg.mac?.icon !== 'build/icon.icns' || cfg.win?.icon !== 'build/icon.ico')
    throw new Error('native platform icon config missing');
});
check('macOS 有 dmg + zip 双架构', () => {
  const targets = cfg.mac?.target ?? [];
  const kinds = new Set(targets.map((t) => (typeof t === 'string' ? t : t.target)));
  if (!kinds.has('dmg')) throw new Error('mac dmg missing');
  if (!kinds.has('zip')) throw new Error('mac zip missing (required for auto-update)');
  if (releaseWorkflow.includes('macos-13'))
    throw new Error('retired macos-13 runner must not be used');
  if (!releaseWorkflow.includes('macos-15-intel'))
    throw new Error('supported Intel macOS runner missing');
  if (!releaseWorkflow.includes('target: --mac --arm64'))
    throw new Error('mac arm64 CI target missing');
  if (!releaseWorkflow.includes('target: --mac --x64'))
    throw new Error('mac x64 CI target missing');
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
  if (gh.owner !== 'Aiden-FE' || gh.repo !== 'nexnote')
    throw new Error(`publish repository must be Aiden-FE/nexnote, got ${gh.owner}/${gh.repo}`);
  if (originOwner && (gh.owner !== originOwner || gh.repo !== originRepo))
    throw new Error(`publish ${gh.owner}/${gh.repo} != origin ${originOwner}/${originRepo}`);
  if (!runBuilder.includes(`REPO_OWNER = 'Aiden-FE'`))
    throw new Error('run-builder owner placeholder or mismatch');
  if (!updater.includes(`REPO_OWNER = 'Aiden-FE'`))
    throw new Error('updater owner placeholder or mismatch');
});
check('asar 启用且 unpack 含 dugite', () => {
  if (!cfg.asar) throw new Error('asar disabled');
  const unpack = cfg.asarUnpack ?? [];
  if (!unpack.some((p) => String(p).includes('dugite')))
    throw new Error('dugite not in asarUnpack');
});
check('macOS entitlements 文件已声明', () => {
  if (!cfg.mac?.entitlements) throw new Error('mac entitlements missing');
});
check('macOS release 使用 Ad hoc 签名且不要求 Apple 凭据', () => {
  if (cfg.mac?.hardenedRuntime !== true)
    throw new Error('macOS hardenedRuntime must remain enabled');
  if (
    cfg.afterSign !== 'scripts/ad-hoc-sign.mjs' &&
    cfg.mac?.afterSign !== 'scripts/ad-hoc-sign.mjs'
  )
    throw new Error('macOS Ad hoc afterSign hook missing');
  for (const source of [adHocSign, releaseWorkflow]) {
    if (!/Ad hoc/.test(source)) throw new Error('Ad hoc strategy must be documented');
  }
  for (const command of ['--force', '--deep', '--sign', '-', '--verify']) {
    if (!adHocSign.includes(command))
      throw new Error(`Ad hoc hook missing codesign option: ${command}`);
  }
  if (!adHocSign.includes('Signature') || !adHocSign.includes('adhoc'))
    throw new Error('Ad hoc hook must verify the resulting identity');
  if (!/CSC_IDENTITY_AUTO_DISCOVERY:\s*['"]?false/.test(releaseWorkflow))
    throw new Error('release mac build must disable certificate auto discovery');
  const macStep =
    /- name: Package Ad hoc signed macOS distributables([\s\S]*?)(?=\n\s+- name: Package optionally signed Windows)/.exec(
      releaseWorkflow,
    )?.[1] ?? '';
  if (
    /MACOS_CERTIFICATE|APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|APPLE_TEAM_ID|NEXNOTE_NOTARIZE_MODE/.test(
      macStep,
    )
  )
    throw new Error('release mac build must not require Apple signing or notarization credentials');
  for (const command of ['codesign --verify --deep --strict', 'codesign -dv --verbose=4']) {
    if (!releaseWorkflow.includes(command))
      throw new Error(`missing macOS Ad hoc verification: ${command}`);
  }
  for (const command of ['xcrun stapler validate', 'spctl --assess']) {
    if (releaseWorkflow.includes(command))
      throw new Error(`macOS hard gate must not use ${command}`);
  }
});
check('channel 接线：build env → 打包发布 → updater 烘焙通道', () => {
  if (
    !/NEXNOTE_UPDATE_CHANNEL:\s*\$\{\{\s*needs\.prepare\.outputs\.channel/.test(releaseWorkflow)
  ) {
    throw new Error(
      'release.yml build env must export NEXNOTE_UPDATE_CHANNEL from prepare.outputs.channel',
    );
  }
  if (!/output.*channel/.test(releaseWorkflow)) {
    throw new Error('prepare job must output the resolved channel');
  }
  if (!/readBakedChannel|app-update\.yml/.test(updater))
    throw new Error('updater must read the baked channel from app-update.yml');
  if (
    !/"js-yaml"/.test(packageJson) ||
    /"js-yaml"/.test(packageJson.split('"devDependencies"')[1] ?? '')
  ) {
    throw new Error('js-yaml must be a production dependency for packaged channel parsing');
  }
  if (!/VALID_CHANNELS/.test(updater)) throw new Error('updater has no channel validation');
  if (!/updateChannel/.test(appStore) || !/setUpdateChannel\(channel/.test(appStore))
    throw new Error('selected update channel is not persisted in AppStore');
  const indexTs = readFileSync(resolve(root, 'packages/main/src/index.ts'), 'utf8');
  // DEV-016：持久化通道从 AppStore 迁移到 SettingsService.updates（单一权威）。
  // 任一模式均代表启动时恢复了持久化通道：
  // - 旧模式：appStore.get().updateChannel 直接传给 initAutoUpdater
  // - 新模式：extractUpdateSettings 从 SettingsService.updates 提取 channel
  if (!/appStore\.get\(\)\.updateChannel/.test(indexTs) && !/extractUpdateSettings/.test(indexTs))
    throw new Error('main updater does not restore persisted channel');
});
check('publish 在上传前必须完成 Ad hoc 验证，其他平台签名可选', () => {
  if (!releaseWorkflow.includes('--publish never'))
    throw new Error('build must use --publish never');
  if (releaseWorkflow.includes('--publish always'))
    throw new Error('build must not publish concurrently (publish race)');
  if (
    /runner\.os == 'macOS'/.test(releaseWorkflow) &&
    !/codesign --verify --deep --strict/.test(releaseWorkflow)
  ) {
    throw new Error('macOS must verify signature before upload');
  }
  if (
    /runner\.os == 'Windows'/.test(releaseWorkflow) &&
    !/Get-AuthenticodeSignature/.test(releaseWorkflow)
  ) {
    throw new Error('Windows must verify Authenticode before upload');
  }
  if (/runner\.os == 'Linux'/.test(releaseWorkflow) && !/gpg --verify/.test(releaseWorkflow)) {
    throw new Error('Linux optional signing path must verify signatures when enabled');
  }
  if (!/continuing without detached signatures/.test(releaseWorkflow))
    throw new Error('Linux signing must be explicitly optional without credentials');
  if (!/optional without credentials/.test(releaseWorkflow))
    throw new Error('Windows signing must be explicitly optional without credentials');
});
check('平台密钥最小权限且仅 step 级引用', () => {
  const build = /  build:\n([\s\S]*?)(?=\n  smoke:)/.exec(releaseWorkflow)?.[1] ?? '';
  const jobEnv = /\n    env:\n([\s\S]*?)(?=\n    steps:)/.exec(build)?.[1] ?? '';
  if (/secrets\./.test(jobEnv)) throw new Error('secrets must not appear in build job env');
  const scopes = [
    ['WINDOWS_CERTIFICATE', "if: runner.os == 'Windows'"],
    ['LINUX_GPG_PRIVATE_KEY', "if: runner.os == 'Linux'"],
  ];
  for (const [secret, platformGuard] of scopes) {
    const index = build.indexOf(secret);
    if (index < 0) throw new Error(`missing ${secret}`);
    const stepStart = build.lastIndexOf('- name:', index);
    if (stepStart < 0 || !build.slice(stepStart, index).includes(platformGuard))
      throw new Error(`${secret} is not platform-scoped`);
  }
  if (/MACOS_CERTIFICATE|APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|APPLE_TEAM_ID/.test(build))
    throw new Error('macOS release must not reference Apple credentials');
});
check('单个 publish job，经受保护 QA Environment 与 evidence gate 后才公开', () => {
  const wf = yaml.load(releaseWorkflow);
  const jobs = Object.keys(wf.jobs ?? {});
  if (!jobs.includes('publish')) throw new Error('no publish job');
  if (wf.jobs.publish.strategy) throw new Error('publish must not be a matrix');
  if (wf.jobs.build?.permissions?.contents === 'write')
    throw new Error('build must not have release write permission');
  if (wf.jobs.publish?.permissions?.contents !== 'write')
    throw new Error('publish must hold the only contents: write permission');
  if (JSON.stringify(wf.jobs.preflight?.needs) !== JSON.stringify(['prepare', 'build', 'smoke']))
    throw new Error('preflight must wait for signed build and smoke');
  if (wf.jobs.preflight?.environment)
    throw new Error('preflight must complete before protected Environment approval');
  if (JSON.stringify(wf.jobs.publish?.needs) !== JSON.stringify(['prepare', 'preflight']))
    throw new Error('publish must wait for completed preflight');
  if (wf.jobs.publish?.environment?.name !== 'release-qa')
    throw new Error('publish must require release-qa protected Environment approval');
  if (wf.concurrency)
    throw new Error(
      'GitHub concurrency drops older pending runs; durable publisher lease must be used instead',
    );
  if (!/required reviewers/.test(releaseWorkflow) || !/QA checklist evidence/.test(releaseWorkflow))
    throw new Error('workflow must document required-reviewer QA evidence approval');
  if (
    !/release-qa-evidence\.json/.test(releaseWorkflow) ||
    !/release-evidence\.mjs validate/.test(releaseWorkflow)
  )
    throw new Error('publish must validate a machine-readable run-bound evidence manifest');
  if (
    !/Preflight signed artifact set/.test(releaseWorkflow) ||
    !/softprops\/action-gh-release/.test(releaseWorkflow)
  )
    throw new Error('publish requires preflight then single uploader');
});
check('tag push 自动触发且只能发布 existing immutable tag', () => {
  const wf = yaml.load(releaseWorkflow);
  if (!wf.on?.push?.tags?.includes('v*.*.*') || !wf.on?.workflow_dispatch)
    throw new Error(
      'release must trigger automatically on version-tag push and support controlled dispatch',
    );
  const inputs = wf.on.workflow_dispatch.inputs ?? {};
  for (const name of [
    'release-tag',
    'qa-evidence-url',
    'qa-evidence-sha256',
    'qa-all-required-checks-passed',
  ]) {
    if (inputs[name]?.required !== true)
      throw new Error(`required dispatch input missing: ${name}`);
  }
  if (
    !/\^v\[0-9\]\+/.test(releaseWorkflow) ||
    !/GITHUB_REF.*refs\/tags\/\$RELEASE_TAG/.test(releaseWorkflow)
  )
    throw new Error('dispatch ref must strictly equal a v<semver> tag, never a branch');
  if (!/refs\/tags\/\$RELEASE_TAG\^\{commit\}/.test(releaseWorkflow))
    throw new Error('dispatch tag must resolve to an existing tag commit');
  if (!/test "\$commit" = "\$GITHUB_SHA"/.test(releaseWorkflow))
    throw new Error('resolved tag commit must bind the dispatched target SHA');
  if (
    !/check-version\.mjs --require-tag/.test(releaseWorkflow) ||
    !/--require-tag/.test(checkVersion)
  )
    throw new Error('release path must require explicit tag/version match');
  if (
    /no tag provided[\s\S]*process\.exit\(0\)/.test(checkVersion) &&
    !/if \(required\)/.test(checkVersion)
  )
    throw new Error('required release check may not pass without a tag');
  if (!/tag_name:\s*\$\{\{ needs\.prepare\.outputs\.tag \}\}/.test(releaseWorkflow))
    throw new Error('publisher must target resolved immutable tag');
});
check('publisher 使用不丢队列的 durable remote-ref lease 与幂等 tag release', () => {
  if (!/release-publication-lock/.test(releaseWorkflow))
    throw new Error('fixed publication lease ref missing');
  if (!/--force-with-lease=refs\/heads\/release-publication-lock:/.test(releaseWorkflow))
    throw new Error('atomic acquire/release lease guards missing');
  if (!/for attempt in \$\(seq 1 180\)/.test(releaseWorkflow))
    throw new Error('lease contenders must retry rather than be dropped');
  if (!/run remains failed and rerunnable, never silently dropped/.test(releaseWorkflow))
    throw new Error('lease timeout behavior must be explicit and rerunnable');
  if (!/tag_name:/.test(releaseWorkflow))
    throw new Error('release retries must be idempotent by immutable tag');
  if (!/publication lease \(\[0-9\]\+\)\/\(\[0-9\]\+\)\/\(\[0-9\]\+\)/.test(releaseWorkflow))
    throw new Error(
      'stale lease detection must use anchored numeric regex ^publication lease ([0-9]+)/([0-9]+)/([0-9]+)$',
    );
  for (const guard of [
    '$((now - owner_time))" -ge 2700',
    'api.github.com/repos/$GITHUB_REPOSITORY/actions/runs/$owner_run',
    'status" = completed',
    'sha256sum --check SHA256SUMS',
    'lost publication lease ownership',
  ]) {
    if (!releaseWorkflow.includes(guard))
      throw new Error(`stale lease/prepublish guard missing: ${guard}`);
  }
});
check('preflight 在跑 import js-yaml 的 merge script 前已 setup Node/corepack/pnpm install', () => {
  if (!releaseWorkflow.includes('- uses: actions/setup-node@'))
    throw new Error('preflight must set up Node before merge script');
  if (
    !/corepack enable[\s\S]*?corepack prepare pnpm/.test(
      releaseWorkflow.match(/  preflight:[\s\S]*?\n  publish:/)?.[0] ?? '',
    )
  )
    throw new Error('preflight must enable corepack before merge script');
  if (
    !/preflight:[\s\S]*?pnpm install --frozen-lockfile[\s\S]*?merge-mac-update-manifests/.test(
      releaseWorkflow,
    )
  )
    throw new Error(
      'merge-mac-update-manifests.mjs imports js-yaml; pnpm install must run first in preflight',
    );
});

check('publish 显式 GITHUB_TOKEN 且 actions: read', () => {
  const publish =
    /  publish:\n([\s\S]*?)(?=\n      - name: Release durable publication lease|$)/.exec(
      releaseWorkflow,
    )?.[1] ?? releaseWorkflow;
  if (!/GITHUB_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/.test(publish))
    throw new Error('publish must explicitly export GITHUB_TOKEN for API queries');
  if (!/actions:\s*read/.test(publish))
    throw new Error('publish job must declare actions: read for lease staleness checks');
});

check('preflight flatten 拒绝 duplicate basename 且禁止 mv -n first-wins', () => {
  if (/mv -n/.test(releaseWorkflow))
    throw new Error('mv -n must not be used for silent first-wins flattening');
  if (!/-name '\*-mac\.yml' -delete/.test(releaseWorkflow))
    throw new Error('redundant per-arch mac manifests must be removed after merge');
  if (!/duplicate artifact basenames would collide/.test(releaseWorkflow))
    throw new Error('flatten must fail before moving on duplicate basenames');
  if (!/merge-multiple:\s*false/.test(releaseWorkflow))
    throw new Error('native artifacts must remain isolated until explicit aggregation');
});

check('artifact contract：平台、架构、主更新目标命名稳定', () => {
  const cfgYaml = readFileSync(resolve(root, 'electron-builder.yml'), 'utf8');
  for (const pattern of [
    /artifactName: \$\{productName\}-\$\{version\}-mac-\$\{arch\}\.\$\{ext\}/,
    /artifactName: \$\{productName\}-\$\{version\}-win-x64\.\$\{ext\}/,
    /artifactName: \$\{productName\}-\$\{version\}-linux-x86_64\.\$\{ext\}/,
  ]) {
    if (!pattern.test(cfgYaml)) throw new Error(`missing artifact naming contract: ${pattern}`);
  }
  if (!releaseWorkflow.includes('verify-artifact-contract.mjs'))
    throw new Error('release preflight must execute the reusable artifact contract verifier');
});

check('artifact contract verifier has exact required targets and metadata checks', () => {
  const verifier = readFileSync(resolve(root, 'scripts/verify-artifact-contract.mjs'), 'utf8');
  for (const guard of [
    'macArm64',
    'macX64',
    'windows',
    'linux',
    '-mac-arm64.dmg',
    '-mac-x64.zip',
    '-win-x64.exe',
    '-linux-x86_64.AppImage',
    'sha512',
    'document?.version',
    'optional portable/deb',
    'Differential update metadata is required only',
    'AppImage updates use the AppImage entry',
  ]) {
    if (!verifier.includes(guard)) throw new Error(`artifact contract guard missing: ${guard}`);
  }
});

check('preflight 通过统一 contract 校验 channel manifest、blockmap 和主路径', () => {
  if (!/verify-artifact-contract\.mjs release/.test(releaseWorkflow))
    throw new Error('preflight must invoke the exact artifact contract verifier');
  const verifier = readFileSync(resolve(root, 'scripts/verify-artifact-contract.mjs'), 'utf8');
  for (const metadata of [
    '${prefix}-mac.yml',
    '${prefix}.yml',
    '${prefix}-linux.yml',
    '${artifactName}.blockmap',
  ]) {
    if (!verifier.includes(metadata))
      throw new Error(`artifact contract metadata requirement missing: ${metadata}`);
  }
  if (!/files: release\/\*\*\/\*/.test(releaseWorkflow))
    throw new Error(
      'publish glob must include release/**/* to capture metadata and optional signatures',
    );
  if (
    !/merge-multiple:\s*false/.test(releaseWorkflow) ||
    !/merge-mac-update-manifests\.mjs/.test(releaseWorkflow)
  )
    throw new Error('native mac manifests must remain isolated until explicit merge');
  if (
    !/Restore and verify bundled Git payload/.test(releaseWorkflow) ||
    !/file "\$gitbin"/.test(releaseWorkflow)
  )
    throw new Error('mac dugite binary must be restored and architecture checked');
});
check('smoke 缺产物必须失败、写入临时目录且 QA gate 顺序一致', () => {
  if (/skipping e2e smoke|process\.exit\(0\)/.test(smoke))
    throw new Error('smoke script may not skip missing artifact');
  if (!/process\.exit\(1\)/.test(smoke)) throw new Error('smoke must fail without packaged app');
  if (!/NEXNOTE_SMOKE_OUTPUT_DIR/.test(smoke) || !/mkdtempSync/.test(smoke))
    throw new Error('packaged smoke evidence must use a writable temp directory');
  if (!/事实边界/.test(qaChecklist) || !/未进行.*跨平台物理安装/.test(qaChecklist))
    throw new Error('QA checklist must truthfully record physical-validation boundary');
  if (!/preflight.*dependency job.*全部通过[\s\S]*release-qa.*Environment.*审批/.test(qaChecklist))
    throw new Error('machine and manual QA gates must complete before Environment approval');
  if (!/After public publication \(monitoring, not a publication gate\)/.test(qaChecklist))
    throw new Error('post-publication checks must be separated from publication gates');
  const postPublication = qaChecklist.split('## After public publication')[1] ?? '';
  if (/🔒/.test(postPublication))
    throw new Error('no publication gate may appear after public publication');
});
check('所有 GitHub Actions 使用 immutable SHA 并由 Dependabot 维护', () => {
  const workflowFiles = [
    '.github/workflows/pr-check.yml',
    '.github/workflows/nightly.yml',
    '.github/workflows/release.yml',
  ];
  const useLine = /^\s*-\s+uses:\s+([^\s#]+)(?:\s+#.*)?$/gm;
  for (const file of workflowFiles) {
    const source = readFileSync(resolve(root, file), 'utf8');
    for (const match of source.matchAll(useLine)) {
      const ref = match[1].split('@')[1];
      if (!ref || !/^[0-9a-f]{40}$/.test(ref))
        throw new Error(`${file} has unpinned action: ${match[1]}`);
    }
  }
  if (!/package-ecosystem:\s*github-actions/.test(dependabot))
    throw new Error('Dependabot github-actions update strategy missing');
  if (!/softprops\/action-gh-release@[0-9a-f]{40}/.test(releaseWorkflow))
    throw new Error('release publisher must be pinned by full SHA');
  if (!/Aiden-FE/.test(releaseEvidence) || !/allRequiredChecksPassed/.test(releaseEvidence))
    throw new Error(
      'QA evidence validator must bind canonical repository and all-checks attestation',
    );
  for (const guard of [
    'raw.githubusercontent.com',
    "redirect: 'error'",
    'MAX_EVIDENCE_BYTES',
    'FETCH_TIMEOUT_MS',
    "createHash('sha256')",
    'actualSha256 !== want.evidenceSha256',
  ]) {
    if (!releaseEvidence.includes(guard))
      throw new Error(`QA evidence fetch guard missing: ${guard}`);
  }
});
check('捆绑 dugite Git 随附 GPLv2 许可与源码 offer', () => {
  const cfgYaml = readFileSync(resolve(root, 'electron-builder.yml'), 'utf8');
  if (!/extraResources/.test(cfgYaml) || !/licenses/g.test(cfgYaml))
    throw new Error('bundled GPL notices must ship via extraResources');
  for (const file of [
    'licenses/git/COPYING',
    'licenses/git/NOTICE',
    'licenses/git/SOURCE_OFFER.txt',
  ]) {
    const present = existsSync(resolve(root, file));
    if (!present) throw new Error(`missing bundled ${file}`);
    const text = readFileSync(resolve(root, file), 'utf8');
    if (
      file.endsWith('COPYING') &&
      !/GNU GENERAL PUBLIC LICENSE[\s\S]*Version 2, June 1991/.test(text)
    )
      throw new Error('COPYING must be GPLv2');
    if (file.endsWith('SOURCE_OFFER.txt') && (!/GPLv2/.test(text) || !/section 3/.test(text)))
      throw new Error('SOURCE_OFFER must reference GPLv2 section 3');
    if (file.endsWith('NOTICE') && !/dugite/.test(text))
      throw new Error('NOTICE must identify the bundled dugite Git');
  }
});

check('dugite 为 optionalDependency 且发布门禁校验 bundled Git payload', () => {
  const rootPkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  if (rootPkg.dependencies?.dugite)
    throw new Error('dugite must not be a hard dependency (offline install would fail)');
  if (rootPkg.optionalDependencies?.dugite !== '^3.2.3')
    throw new Error('dugite must be an optionalDependency of the root package');
  const mainPkg = JSON.parse(readFileSync(resolve(root, 'packages/main/package.json'), 'utf8'));
  if (mainPkg.dependencies?.dugite)
    throw new Error('packages/main dugite must not be a hard dependency');
  if (mainPkg.optionalDependencies?.dugite !== '^3.2.3')
    throw new Error('packages/main dugite must be an optionalDependency');
  const workspaceYaml = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8');
  if (!/onlyBuiltDependencies:[\s\S]*?- dugite/.test(workspaceYaml))
    throw new Error('pnpm-workspace must keep dugite build-script allowlist (pnpm 10 compat)');
  if (!/allowBuilds:[\s\S]*?dugite:\s*true/.test(workspaceYaml))
    throw new Error('pnpm-workspace allowBuilds must include dugite');
  if (/ignore-scripts|ignoreScripts/.test(workspaceYaml))
    throw new Error('workspace must not disable install scripts globally');
  const electronVite = readFileSync(resolve(root, 'electron.vite.config.ts'), 'utf8');
  if (!/include:\s*\[[^\]]*['"]dugite['"]/.test(electronVite))
    throw new Error(
      'dugite must stay externalized so its packaged __dirname resolves app.asar.unpacked',
    );
  const gitRuntime = readFileSync(resolve(root, 'packages/main/src/git/git-runtime.ts'), 'utf8');
  if (
    !/if \(options\.allowSystemFallback\)[\s\S]*source: 'system'[\s\S]*source: 'missing'/.test(
      gitRuntime,
    )
  )
    throw new Error('git runtime resolver must fail closed without system fallback');
  const gitService = readFileSync(resolve(root, 'packages/main/src/git/git-service.ts'), 'utf8');
  if (!/GIT_BINARY_MISSING/.test(gitService))
    throw new Error('GitService must surface GIT_BINARY_MISSING instead of silent PATH fallback');
  const verifyScript = readFileSync(resolve(root, 'scripts/verify-bundled-git.mjs'), 'utf8');
  if (!/app\.asar\.unpacked/.test(verifyScript) || !/::error::/.test(verifyScript))
    throw new Error('verify-bundled-git must walk asar.unpacked and emit GitHub annotations');
  for (const workflow of [releaseWorkflow, devWorkflow, nightlyWorkflow]) {
    if (!/verify-bundled-git\.mjs --install-tree/.test(workflow))
      throw new Error('workflows must verify install-tree bundled Git after install');
    if (!/verify-bundled-git\.mjs --app/.test(workflow))
      throw new Error('workflows must verify packaged bundled Git after packaging');
  }
});

check('updater 下载状态只在事件确认后允许安装且去重 available', () => {
  if (!/downloadedVersion !== availableVersion/.test(updater))
    throw new Error('install must require confirmed downloaded version');
  if (!/info\.version === availableVersion\) return/.test(updater))
    throw new Error('duplicate update-available events must be suppressed');
  if (!/downloadInFlight/.test(updater))
    throw new Error('concurrent download requests must be deduplicated');
  if (!/a\.autoDownload = autoDownloadSetting/.test(updater))
    throw new Error('autoDownload must come from settings, not hardcoded');
});

check('renderer 更新设置从主进程单一权威读取，移除 localStorage 双真值', () => {
  const updateSection = readFileSync(
    resolve(root, 'packages/renderer/src/features/settings/update-section.tsx'),
    'utf8',
  );
  if (/localStorage.*update\.(channel|autoDownload)/.test(updateSection))
    throw new Error(
      'renderer must not keep update channel/autoDownload in localStorage (single authority in main AppStore)',
    );
  if (!/app:getUpdateSettings/.test(updateSection))
    throw new Error('renderer must fetch update settings from main AppStore');
  if (!/app:setUpdateSettings/.test(updateSection))
    throw new Error('renderer must write update settings back to main AppStore');
  if (!/updateAutoDownload|updateCheckOnLaunch/.test(appStore))
    throw new Error('AppStore must persist updateAutoDownload and updateCheckOnLaunch');
});
check('PR 检查覆盖 lint/typecheck/test/build', () => {
  if (!/pnpm lint/.test(devWorkflow)) throw new Error('pr-check missing lint');
  if (!/pnpm typecheck/.test(devWorkflow)) throw new Error('pr-check missing typecheck');
  if (!/pnpm test/.test(devWorkflow)) throw new Error('pr-check missing test');
  if (!/pnpm build/.test(devWorkflow)) throw new Error('pr-check missing build');
});

check('PR 检查含 NUL-safe changed-file formatting gate', () => {
  if (!/scripts\/check-changed-format\.sh/.test(devWorkflow))
    throw new Error('pr-check must invoke the changed-file formatting script');
  const formatGate = readFileSync(resolve(root, 'scripts/check-changed-format.sh'), 'utf8');
  if (!/git diff --name-only -z --diff-filter=AM/.test(formatGate))
    throw new Error('format gate must use a NUL-delimited added/modified file diff');
  if (!/prettier --check --ignore-unknown --/.test(formatGate))
    throw new Error('format gate must terminate Prettier options before file paths');
  if (!/files\+=\("\.\/\$file"\)/.test(formatGate))
    throw new Error('format gate must prefix relative file paths with ./');
  if (!/fetch-depth:\s*0/.test(devWorkflow))
    throw new Error('pr-check must fetch full history for diff against base');
});

const failed = checks.filter((c) => !c.ok);
for (const c of checks)
  console.log(`${c.ok ? '✅' : '❌'} ${c.label}${c.ok ? '' : ` — ${c.error}`}`);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} release config checks passed.`);
