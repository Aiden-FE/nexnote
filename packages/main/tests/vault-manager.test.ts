import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createVault,
  ensureVault,
  readVaultConfig,
  sanitizeVaultName,
  saveVaultLayout,
  validateVaultRoot,
  vaultInfoFor,
  writeVaultConfig,
  CONFIG_FILENAME,
  NEXNOTE_DIR,
  VaultError,
} from '../src/vault/vault-manager';
import { defaultVaultConfig, defaultVaultLayout } from '@nexnote/shared';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-vault-test-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('sanitizeVaultName', () => {
  it('接受常规名称（含中文、空格、连字符）', () => {
    for (const name of ['我的知识库', 'my vault', 'notes-2025', 'A.b']) {
      expect(sanitizeVaultName(name)).toEqual({ ok: true, value: name });
    }
  });

  it('拒绝空名 / 点开头 / 非法字符 / 超长', () => {
    expect(sanitizeVaultName('   ').ok).toBe(false);
    expect(sanitizeVaultName('.hidden').ok).toBe(false);
    expect(sanitizeVaultName('..').ok).toBe(false);
    expect(sanitizeVaultName('a/b').ok).toBe(false);
    expect(sanitizeVaultName('a\\b').ok).toBe(false);
    expect(sanitizeVaultName('a'.repeat(65)).ok).toBe(false);
  });

  it('裁剪首尾空白', () => {
    expect(sanitizeVaultName('  vault  ')).toEqual({ ok: true, value: 'vault' });
  });
});

describe('validateVaultRoot', () => {
  it('存在的目录通过', async () => {
    await expect(validateVaultRoot(tmp)).resolves.toBeUndefined();
  });

  it('相对路径 / 不存在 / 文件路径 均报错', async () => {
    await expect(validateVaultRoot('relative/path')).rejects.toMatchObject({ code: 'PATH_NOT_ABSOLUTE' });
    await expect(validateVaultRoot(path.join(tmp, 'missing'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const file = path.join(tmp, 'a-file');
    await writeFile(file, 'x');
    await expect(validateVaultRoot(file)).rejects.toMatchObject({ code: 'NOT_DIRECTORY' });
  });
});

describe('ensureVault（打开文件夹即初始化）', () => {
  it('在普通目录上创建 .nexnote/config.json（幂等）', async () => {
    const info = await ensureVault(tmp);
    expect(info).toEqual(vaultInfoFor(tmp));
    expect(info.name).toBe(path.basename(tmp));
    const st = await stat(path.join(tmp, NEXNOTE_DIR, CONFIG_FILENAME));
    expect(st.isFile()).toBe(true);
    // 再跑一次不报错
    await expect(ensureVault(tmp)).resolves.toBeTruthy();
  });

  it('读取已有配置并保留布局', async () => {
    const config = defaultVaultConfig();
    config.layout.sidebarWidth = 333;
    await writeVaultConfig(tmp, config);
    const read = await readVaultConfig(tmp);
    expect(read.layout.sidebarWidth).toBe(333);
  });

  it('损坏的 config.json 自动重置为默认值', async () => {
    const dir = path.join(tmp, NEXNOTE_DIR);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, CONFIG_FILENAME), '{not valid json', 'utf8');
    const read = await readVaultConfig(tmp);
    expect(read).toEqual(defaultVaultConfig());
  });

  it('saveVaultLayout 只更新 layout 字段', async () => {
    await ensureVault(tmp);
    await saveVaultLayout(tmp, { ...defaultVaultLayout(), sidebarWidth: 400 });
    const read = await readVaultConfig(tmp);
    expect(read.layout.sidebarWidth).toBe(400);
    expect(read.lastSession).toEqual(defaultVaultConfig().lastSession);
  });
});

describe('createVault（新建空 vault）', () => {
  it('创建目录结构并返回信息', async () => {
    const info = await createVault(tmp, 'fresh-vault');
    expect(info.root).toBe(path.join(tmp, 'fresh-vault'));
    const entries = await readdir(path.join(tmp, 'fresh-vault', NEXNOTE_DIR));
    expect(entries).toContain(CONFIG_FILENAME);
  });

  it('目标为已存在的空目录时原地初始化', async () => {
    await mkdir(path.join(tmp, 'empty-dir'));
    const info = await createVault(tmp, 'empty-dir');
    expect(info.root).toBe(path.join(tmp, 'empty-dir'));
  });

  it('目标非空时报 VAULT_EXISTS_NON_EMPTY', async () => {
    await mkdir(path.join(tmp, 'busy'));
    await writeFile(path.join(tmp, 'busy', 'existing.md'), 'hi');
    await expect(createVault(tmp, 'busy')).rejects.toMatchObject({
      code: 'VAULT_EXISTS_NON_EMPTY',
    });
  });

  it('目标存在同名文件时报 VAULT_EXISTS_FILE', async () => {
    await writeFile(path.join(tmp, 'occupied'), 'x');
    await expect(createVault(tmp, 'occupied')).rejects.toMatchObject({ code: 'VAULT_EXISTS_FILE' });
  });

  it('非法名称抛 VaultError', async () => {
    await expect(createVault(tmp, '.bad')).rejects.toBeInstanceOf(VaultError);
    await expect(createVault(tmp, '')).rejects.toMatchObject({ code: 'INVALID_NAME' });
  });

  it('父目录不存在时报错', async () => {
    await expect(createVault(path.join(tmp, 'nope'), 'v')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
