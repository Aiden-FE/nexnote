import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { betterSqlite3Options, electronBindingCachePath } from '../src/indexer/native-binding';
import {
  nativeBindingCachePath,
  prepareNativeBindings,
} from '../../../scripts/prepare-native-bindings.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'nexnote-native-binding-'));
  temporaryDirectories.push(root);
  return root;
}

describe('better-sqlite3 native binding isolation', () => {
  it('uses the ABI-keyed development cache only in unpackaged Electron', async () => {
    const root = await temporaryRoot();
    const runtime = { platform: 'darwin' as const, arch: 'arm64', modules: '143' };
    const binding = electronBindingCachePath(root, runtime);
    expect(nativeBindingCachePath(root, runtime)).toBe(binding);
    await mkdir(path.dirname(binding), { recursive: true });
    await writeFile(binding, 'electron-binding');

    expect(binding).toBe(
      path.join(
        root,
        'node_modules',
        '.cache',
        'nexnote-native-bindings',
        'better-sqlite3',
        'darwin-arm64-abi143',
        'better_sqlite3.node',
      ),
    );
    expect(
      betterSqlite3Options({
        isElectron: true,
        isPackaged: false,
        appPath: root,
        platform: 'darwin',
        arch: 'arm64',
        modules: '143',
      }),
    ).toEqual({ nativeBinding: binding });
    expect(
      betterSqlite3Options({
        isElectron: true,
        isPackaged: true,
        appPath: root,
        platform: 'darwin',
        arch: 'arm64',
        modules: '143',
      }),
    ).toEqual({});
    expect(
      betterSqlite3Options({
        isElectron: false,
        isPackaged: false,
        appPath: root,
        platform: 'darwin',
        arch: 'arm64',
        modules: '147',
      }),
    ).toEqual({});
  });

  it('keeps Node intact, caches staged Electron, and clears .forge-meta', async () => {
    const root = await temporaryRoot();
    const moduleRoot = path.join(root, 'node_modules', 'better-sqlite3');
    const activeBinding = path.join(moduleRoot, 'build', 'Release', 'better_sqlite3.node');
    const forgeMeta = path.join(moduleRoot, '.forge-meta');
    await mkdir(path.dirname(activeBinding), { recursive: true });
    await writeFile(activeBinding, 'node-binding');
    await writeFile(forgeMeta, 'misleading rebuild state');
    const validate = vi.fn(async (binding: string, runtime: 'node' | 'electron') => {
      const bytes = await readFile(binding, 'utf8');
      if (bytes !== `${runtime}-binding`) throw new Error(`${runtime} ABI mismatch`);
    });

    const result = await prepareNativeBindings({
      root,
      mode: 'electron',
      platform: 'darwin',
      arch: 'arm64',
      electronVersion: '44.2.0',
      electronAbi: '143',
      validate,
      rebuildElectron: async () => {
        const binding = path.join(root, 'stage', 'better_sqlite3.node');
        await mkdir(path.dirname(binding), { recursive: true });
        await writeFile(binding, 'electron-binding');
        return {
          binding,
          cleanup: async () => rm(path.dirname(binding), { recursive: true, force: true }),
        };
      },
    });

    expect(await readFile(activeBinding, 'utf8')).toBe('node-binding');
    expect(await readFile(result.cacheBinding, 'utf8')).toBe('electron-binding');
    await expect(
      readFile(path.join(root, 'stage', 'better_sqlite3.node'), 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(forgeMeta, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(validate).toHaveBeenCalledWith(expect.stringMatching(/better_sqlite3\.node$/), 'node');
    expect(validate).toHaveBeenCalledWith(result.cacheBinding, 'electron');
  });

  it('rebuilds Node when both the active binding and cached Node binding are invalid', async () => {
    const root = await temporaryRoot();
    const moduleRoot = path.join(root, 'node_modules', 'better-sqlite3');
    const activeBinding = path.join(moduleRoot, 'build', 'Release', 'better_sqlite3.node');
    const nodeCacheBinding = nativeBindingCachePath(root, {
      platform: 'darwin',
      arch: 'arm64',
      modules: '147',
    });
    await mkdir(path.dirname(activeBinding), { recursive: true });
    await mkdir(path.dirname(nodeCacheBinding), { recursive: true });
    await writeFile(activeBinding, 'electron-binding');
    await writeFile(nodeCacheBinding, 'corrupt-binding');
    const validate = async (binding: string, runtime: 'node' | 'electron') => {
      const bytes = await readFile(binding, 'utf8');
      if (bytes !== `${runtime}-binding`) throw new Error(`${runtime} ABI mismatch`);
    };
    const rebuildNode = vi.fn(async () => writeFile(activeBinding, 'node-binding'));

    await prepareNativeBindings({
      root,
      moduleRoot,
      mode: 'node',
      platform: 'darwin',
      arch: 'arm64',
      electronVersion: '44.2.0',
      electronAbi: '149',
      nodeAbi: '147',
      validate,
      rebuildNode,
    });

    expect(rebuildNode).toHaveBeenCalledOnce();
    expect(await readFile(activeBinding, 'utf8')).toBe('node-binding');
    expect(await readFile(nodeCacheBinding, 'utf8')).toBe('node-binding');
  });

  it('fails closed and keeps Node intact when staged Electron is invalid', async () => {
    const root = await temporaryRoot();
    const moduleRoot = path.join(root, 'node_modules', 'better-sqlite3');
    const activeBinding = path.join(moduleRoot, 'build', 'Release', 'better_sqlite3.node');
    await mkdir(path.dirname(activeBinding), { recursive: true });
    await writeFile(activeBinding, 'node-binding');

    await expect(
      prepareNativeBindings({
        root,
        moduleRoot,
        mode: 'electron',
        platform: 'linux',
        arch: 'x64',
        electronVersion: '44.2.0',
        electronAbi: '143',
        validate: async (binding: string, runtime: 'node' | 'electron') => {
          const bytes = await readFile(binding, 'utf8');
          if (bytes !== `${runtime}-binding`) throw new Error(`${runtime} ABI mismatch`);
        },
        rebuildElectron: async () => {
          const binding = path.join(root, 'stage', 'better_sqlite3.node');
          await mkdir(path.dirname(binding), { recursive: true });
          await writeFile(binding, 'wrong-binding');
          return {
            binding,
            cleanup: async () => rm(path.dirname(binding), { recursive: true, force: true }),
          };
        },
      }),
    ).rejects.toThrow('Electron binding validation failed');

    expect(await readFile(activeBinding, 'utf8')).toBe('node-binding');
    await expect(
      readFile(path.join(root, 'stage', 'better_sqlite3.node'), 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      readFile(
        path.join(
          root,
          'node_modules',
          '.cache',
          'nexnote-native-bindings',
          'better-sqlite3',
          'linux-x64-abi143',
          'better_sqlite3.node',
        ),
        'utf8',
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
