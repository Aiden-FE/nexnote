import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

export function nativeBindingCachePath(root, { platform, arch, modules }) {
  return join(
    root,
    'node_modules',
    '.cache',
    'nexnote-native-bindings',
    'better-sqlite3',
    `${platform}-${arch}-abi${modules}`,
    'better_sqlite3.node',
  );
}

async function exists(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function copyBinding(from, to) {
  await mkdir(dirname(to), { recursive: true });
  const temporary = `${to}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await copyFile(from, temporary);
    await rename(temporary, to);
  } finally {
    await rm(temporary, { force: true });
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      stdio: options.stdio ?? 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? `exit ${code}`})`));
    });
  });
}

async function resolveModuleRoot(root, packageName) {
  try {
    const rootRequire = createRequire(join(root, 'package.json'));
    return await realpath(dirname(rootRequire.resolve(`${packageName}/package.json`)));
  } catch {
    // 沙箱/测试环境可能没有可解析的依赖图；退回标准 node_modules 布局。
    return realpath(join(root, 'node_modules', packageName));
  }
}

function readElectronVersion(root) {
  const rootRequire = createRequire(join(root, 'package.json'));
  return JSON.parse(readFileSync(rootRequire.resolve('electron/package.json'), 'utf8')).version;
}

function electronBinary(root) {
  const rootRequire = createRequire(join(root, 'package.json'));
  const binary = rootRequire('electron');
  if (typeof binary !== 'string')
    throw new Error('Unable to resolve the Electron binary outside Electron.');
  return binary;
}

async function validateBinding(binding, runtime, root) {
  const binary = runtime === 'electron' ? electronBinary(root) : process.execPath;
  const env = runtime === 'electron' ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env;
  await new Promise((resolve, reject) => {
    const child = spawn(binary, ['-e', 'require(process.argv[1])', binding], {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else {
        const detail = stderr.trim().split('\n').slice(-4).join('\n').slice(0, 500);
        reject(
          new Error(`${runtime} binding validation failed: ${detail || signal || `exit ${code}`}`),
        );
      }
    });
  });
}

/**
 * pnpm 进程入口：脚本经 predev/pretest 生命周期运行时 npm_execpath 指向 pnpm 的
 * JS 入口，用 node 直接执行避免 Windows 上 spawn('pnpm.cmd') 无 shell 的 EINVAL。
 */
function pnpmInvocation() {
  const entry = process.env.npm_execpath;
  if (entry && existsSync(entry)) return { command: process.execPath, args: [entry], shell: false };
  return { command: 'pnpm', args: [], shell: process.platform === 'win32' };
}

async function runPnpm(args, options = {}) {
  const invocation = pnpmInvocation();
  await run(invocation.command, [...invocation.args, ...args], {
    ...options,
    shell: invocation.shell,
  });
}

async function electronAbi(root) {
  const binary = electronBinary(root);
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['-p', 'process.versions.modules'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let error = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      error += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      const abi = output.trim();
      if (code === 0 && abi) resolve(abi);
      else
        reject(new Error(`Unable to read Electron module ABI: ${error.trim() || `exit ${code}`}`));
    });
  });
}

async function rebuildNode(root) {
  await runPnpm(['rebuild', 'better-sqlite3'], { cwd: root });
}

async function rebuildElectron(root, moduleRoot, version, platform, arch) {
  const stagingRoot = await mkdtemp(join(tmpdir(), 'nexnote-electron-stage-'));
  const stagingModuleRoot = join(stagingRoot, 'node_modules', 'better-sqlite3');
  const binding = join(stagingModuleRoot, 'build', 'Release', 'better_sqlite3.node');
  // cleanup 失败不应掩盖真正的 rebuild/发布错误。
  const cleanup = async () => {
    await rm(stagingRoot, { force: true, recursive: true }).catch(() => undefined);
  };
  try {
    await mkdir(join(stagingRoot, 'node_modules'), { recursive: true });
    await writeFile(
      join(stagingRoot, 'package.json'),
      '{"name":"nexnote-native-stage","private":true,"version":"0.0.0","dependencies":{"better-sqlite3":"*"}}\n',
    );
    // Electron rebuild 只接触 staging 副本，活动 Node binding 始终保持 ABI 可加载。
    await cp(moduleRoot, stagingModuleRoot, { recursive: true, dereference: true });
    await rm(join(stagingModuleRoot, 'build'), { force: true, recursive: true });
    await rm(join(stagingModuleRoot, '.forge-meta'), { force: true, recursive: true });

    const prebuildInstall = createRequire(join(moduleRoot, 'package.json')).resolve(
      'prebuild-install/bin.js',
    );
    try {
      await run(process.execPath, [prebuildInstall, '-r', 'electron', '-t', version], {
        cwd: stagingModuleRoot,
        stdio: 'ignore',
      });
    } catch {
      // Electron ABI can arrive after better-sqlite3's prebuilt release cadence; compile locally as the official fallback.
      await runPnpm(
        [
          'exec',
          'electron-rebuild',
          '--force',
          '--only',
          'better-sqlite3',
          '--version',
          version,
          '--platform',
          platform,
          '--arch',
          arch,
          '--module-dir',
          stagingRoot,
        ],
        { cwd: root },
      );
    }
    if (!(await exists(binding))) throw new Error('Electron rebuild produced no native binding.');
    return { binding, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function removeForgeMeta(moduleRoot) {
  await rm(join(moduleRoot, '.forge-meta'), { force: true, recursive: true });
}

const LOCK_POLL_MS = 200;
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * 跨进程互斥：并行的 pretest/predev/presmoke 会同时 prepare 同一份 binding 缓存，
 * 无锁并发时失败路径的 rm 可能删掉另一进程刚发布成功的缓存。
 * 锁文件内容为不可复用的 owner token（pid + uuid）；陈旧锁只有在持锁 PID 确认
 * 不存在时才回收，释放时校验 token，避免旧进程删掉新持有者的锁。
 */
async function withPrepareLock(root, options, run) {
  const lockDir = join(root, 'node_modules', '.cache', 'nexnote-native-bindings');
  await mkdir(lockDir, { recursive: true });
  const lockPath = join(lockDir, '.prepare.lock');
  const pollMs = options.lockPollMs ?? LOCK_POLL_MS;
  const timeoutMs = options.lockTimeoutMs ?? LOCK_TIMEOUT_MS;
  const token = `${process.pid}-${randomUUID()}`;
  const startedAt = Date.now();
  const readToken = async () => {
    try {
      return (await readFile(lockPath, 'utf8')).trim();
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  };
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(`${token}\n`);
      await handle.close();
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const held = await readToken();
    if (held) {
      const holderPid = Number.parseInt(held.split('-', 1)[0] ?? '', 10);
      if (Number.isInteger(holderPid) && !processExists(holderPid)) {
        // 持锁进程已死亡：仅当 token 未变时回收，防止竞态中误删新锁。
        if ((await readToken()) === held) {
          await rm(lockPath, { force: true }).catch(() => undefined);
        }
        continue;
      }
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out acquiring native binding prepare lock: ${lockPath}`);
    }
    await sleep(pollMs);
  }
  try {
    return await run();
  } finally {
    if ((await readToken()) === token) {
      await rm(lockPath, { force: true }).catch(() => undefined);
    }
  }
}

/**
 * Keeps a verified Node binding at better-sqlite3's default path and a separately
 * verified Electron binding in the ABI-keyed cache consumed through nativeBinding.
 */
export async function prepareNativeBindings(options) {
  const root = options.root;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const moduleRoot = options.moduleRoot ?? (await resolveModuleRoot(root, 'better-sqlite3'));
  const activeBinding = join(moduleRoot, 'build', 'Release', 'better_sqlite3.node');
  const nodeAbi = options.nodeAbi ?? process.versions.modules;
  const resolvedElectronAbi = options.electronAbi ?? (await electronAbi(root));
  const version = options.electronVersion ?? readElectronVersion(root);
  const nodeCacheBinding = nativeBindingCachePath(root, { platform, arch, modules: nodeAbi });
  const cacheBinding = nativeBindingCachePath(root, {
    platform,
    arch,
    modules: resolvedElectronAbi,
  });
  const validate =
    options.validate ?? ((binding, runtime) => validateBinding(binding, runtime, root));
  const rebuildForElectron =
    options.rebuildElectron ?? (() => rebuildElectron(root, moduleRoot, version, platform, arch));
  const rebuildForNode = options.rebuildNode ?? (() => rebuildNode(root));

  return withPrepareLock(root, options, async () => {
    const ensureNode = async () => {
      if (await exists(activeBinding)) {
        try {
          await validate(activeBinding, 'node');
          await copyBinding(activeBinding, nodeCacheBinding);
          await removeForgeMeta(moduleRoot);
          return;
        } catch {
          // An Electron rebuild may have overwritten the shared default binding.
        }
      }
      if (await exists(nodeCacheBinding)) {
        try {
          await copyBinding(nodeCacheBinding, activeBinding);
          await validate(activeBinding, 'node');
          await removeForgeMeta(moduleRoot);
          return;
        } catch {
          await rm(nodeCacheBinding, { force: true });
        }
      }
      await rebuildForNode();
      await validate(activeBinding, 'node');
      await copyBinding(activeBinding, nodeCacheBinding);
      await removeForgeMeta(moduleRoot);
    };

    await ensureNode();
    if (options.mode === 'node') return { cacheBinding: nodeCacheBinding };

    if (await exists(cacheBinding)) {
      try {
        await validate(cacheBinding, 'electron');
        return { cacheBinding };
      } catch {
        await rm(cacheBinding, { force: true });
      }
    }

    let staged;
    try {
      staged = await rebuildForElectron();
      await validate(staged.binding, 'electron');
      await copyBinding(staged.binding, cacheBinding);
      await validate(cacheBinding, 'electron');
    } catch (error) {
      await rm(cacheBinding, { force: true });
      throw new Error(
        `Electron binding validation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (staged) await staged.cleanup();
    }

    await removeForgeMeta(moduleRoot);
    return { cacheBinding };
  });
}

async function main() {
  const mode = process.argv.includes('--node')
    ? 'node'
    : process.argv.includes('--electron')
      ? 'electron'
      : null;
  if (!mode) throw new Error('Usage: node scripts/prepare-native-bindings.mjs --node|--electron');
  const root = process.cwd();
  const result = await prepareNativeBindings({ root, mode });
  console.log(`better-sqlite3 ${mode} binding ready: ${result.cacheBinding}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
