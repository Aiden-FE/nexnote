import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

export interface NativeBindingRuntime {
  isElectron: boolean;
  isPackaged: boolean;
  appPath: string;
  platform: NodeJS.Platform;
  arch: string;
  modules: string;
}

/** Development cache location for an Electron-ABI better_sqlite3.node, keyed by platform/arch/ABI. */
export function electronBindingCachePath(
  root: string,
  runtime: Pick<NativeBindingRuntime, 'platform' | 'arch' | 'modules'>,
): string {
  return path.join(
    root,
    'node_modules',
    '.cache',
    'nexnote-native-bindings',
    'better-sqlite3',
    `${runtime.platform}-${runtime.arch}-abi${runtime.modules}`,
    'better_sqlite3.node',
  );
}

/**
 * better-sqlite3 Database options for the current process:
 * - Node（vitest / 脚本）：默认 binding，保持 prebuild 的 Node ABI 可用。
 * - Electron dev：显式指向按 platform/arch/ABI 缓存的 nativeBinding（pnpm predev 准备），缺失即 fail closed。
 * - Electron packaged：交给 electron-builder 打包的 unpacked 原生模块（打包不读 dev cache）。
 */
export function betterSqlite3Options(runtime: NativeBindingRuntime): { nativeBinding?: string } {
  if (!runtime.isElectron || runtime.isPackaged) return {};

  const nativeBinding = electronBindingCachePath(runtime.appPath, runtime);
  if (!existsSync(nativeBinding)) {
    throw new Error(
      `Electron better-sqlite3 binding is missing for ${runtime.platform}/${runtime.arch}/ABI ${runtime.modules}: ${nativeBinding}. Run pnpm predev.`,
    );
  }
  return { nativeBinding };
}

/** Detect the current runtime; electron is required lazily so Node (vitest) never loads it. */
export function currentBetterSqlite3Options(): { nativeBinding?: string } {
  const isElectron = typeof process.versions.electron === 'string';
  let isPackaged = false;
  let appPath = process.cwd();
  if (isElectron) {
    const electron = createRequire(import.meta.url)('electron') as {
      app: { isPackaged: boolean; getAppPath(): string };
    };
    isPackaged = electron.app.isPackaged;
    appPath = electron.app.getAppPath();
  }
  return betterSqlite3Options({
    isElectron,
    isPackaged,
    appPath,
    platform: process.platform,
    arch: process.arch,
    modules: process.versions.modules,
  });
}
