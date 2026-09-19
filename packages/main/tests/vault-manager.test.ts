import { mkdtemp, mkdir, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertNoDotDotSegments,
  createVault,
  ensureVault,
  isWithinPathRoot,
  mergeVaultSettings,
  readVaultConfig,
  sanitizeVaultName,
  saveVaultLayout,
  selectSafeRoot,
  saveVaultSettings,
  validateVaultRoot,
  vaultInfoFor,
  writeVaultConfig,
  CONFIG_FILENAME,
  NEXNOTE_DIR,
  VaultError,
} from '../src/vault/vault-manager';
import { defaultVaultConfig, defaultVaultLayout, defaultVaultSettings } from '@nexnote/shared';

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
    await expect(validateVaultRoot(tmp)).resolves.toBe(path.resolve(tmp));
  });

  it('相对路径 / 不存在 / 文件路径 均报错', async () => {
    await expect(validateVaultRoot('relative/path')).rejects.toMatchObject({
      code: 'PATH_NOT_ABSOLUTE',
    });
    await expect(validateVaultRoot(path.join(tmp, 'missing'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const file = path.join(tmp, 'a-file');
    await writeFile(file, 'x');
    await expect(validateVaultRoot(file)).rejects.toMatchObject({ code: 'NOT_DIRECTORY' });
  });

  it('POSIX 外置卷与 Windows 其他盘符使用真实 path relative 语义', () => {
    expect(isWithinPathRoot('/Volumes/Notes', '/Volumes/Notes/vault', path.posix)).toBe(true);
    expect(isWithinPathRoot('/Volumes/Notes', '/Volumes/Notes', path.posix)).toBe(true);
    expect(isWithinPathRoot('/Volumes/Notes', '/Other/Vault', path.posix)).toBe(false);

    expect(path.win32.relative('C:\\Users\\me', 'D:\\Vault')).toBe('D:\\Vault');
    expect(isWithinPathRoot('C:\\Users\\me', 'D:\\Vault', path.win32)).toBe(false);
    expect(selectSafeRoot('D:\\Vault', ['C:\\Users\\me'], path.win32)).toBe('D:\\');
    expect(isWithinPathRoot('D:\\Data', 'D:\\Data\\Vault', path.win32)).toBe(true);
    expect(isWithinPathRoot('D:\\Data', 'D:\\Other', path.win32)).toBe(false);
  });

  it('Windows 混合分隔符的 .. 与 . 段同样被拒绝', () => {
    expect(() => assertNoDotDotSegments('C:/Users/me/link/../vault')).toThrow(VaultError);
    expect(() => assertNoDotDotSegments('C:\\Users\\me\\link\\..\\vault')).toThrow(VaultError);
    expect(() => assertNoDotDotSegments('C:/Users/me/./vault')).toThrow(VaultError);
    expect(() => assertNoDotDotSegments('C:\\Users\\me\\vault')).not.toThrow();
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

  it('旧配置 lastSession 残留的 files tab 恢复时被静默丢弃（DEV-021）', async () => {
    const config = defaultVaultConfig();
    config.lastSession = {
      tabs: [
        { kind: 'files', title: 'Vault 文件' },
        { kind: 'page', title: '首页' },
      ],
    };
    await writeVaultConfig(tmp, config);
    const read = await readVaultConfig(tmp);
    expect(read.lastSession.tabs).toEqual([{ kind: 'page', title: '首页' }]);
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
    await expect(createVault(path.join(tmp, 'nope'), 'v')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('vault 祖先目录存在符号链接时拒绝写入', async () => {
    const parent = path.join(tmp, 'parents');
    await mkdir(parent);
    const outside = path.join(tmp, 'outside-dir');
    await mkdir(outside);
    const linkedParent = path.join(parent, 'linked');
    await symlink(outside, linkedParent);
    // 真实目标存在但是经过 symlink 解析的目录，禁止一切 vault 写入
    const stash = path.join(linkedParent, 'stash');
    await expect(createVault(linkedParent, 'stash')).rejects.toMatchObject({
      code: 'SYMLINK_COMPONENT',
    });
    await expect(validateVaultRoot(stash)).rejects.toMatchObject({
      code: 'SYMLINK_COMPONENT',
    });
    await expect(readdir(outside)).resolves.toEqual([]);
  });

  it('目标存在符号链接时拒绝（VAULT_TARGET_SYMLINK）', async () => {
    // 在外部建一个真实目录，然后把 vault 目标位置指向它的符号链接
    const outside = path.join(tmp, 'outside-target');
    await mkdir(outside);
    await symlink(outside, path.join(tmp, 'linked-vault'));
    await expect(createVault(tmp, 'linked-vault')).rejects.toMatchObject({
      code: 'VAULT_TARGET_SYMLINK',
    });
  });
});

describe('vault 设置持久化（DEV-016）', () => {
  it('mergeVaultSettings 对缺失字段逐字段回退默认', () => {
    const merged = mergeVaultSettings({ editor: { autoSaveMs: 1200 } });
    expect(merged.editor.autoSaveMs).toBe(1200);
    expect(merged.editor.bindFileNameToTitle).toBe(
      defaultVaultSettings().editor.bindFileNameToTitle,
    );
    expect(merged.git.autoCommitIntervalMs).toBe(defaultVaultSettings().git.autoCommitIntervalMs);
  });

  it('mergeVaultSettings 对裸/非法输入返回默认', () => {
    expect(mergeVaultSettings(null)).toEqual(defaultVaultSettings());
    expect(mergeVaultSettings('oops')).toEqual(defaultVaultSettings());
    expect(mergeVaultSettings({ git: { defaultBranch: 'main branch!' } }).git.defaultBranch).toBe(
      defaultVaultSettings().git.defaultBranch,
    );
  });

  it('saveVaultSettings 持久化并 clamp 边界值', async () => {
    const root = path.join(tmp, 'setvault');
    await createVault(tmp, 'setvault');
    // autoSaveMs 超上限 → clamp 到 10000
    const saved = await saveVaultSettings(root, { editor: { autoSaveMs: 99_999 } });
    expect(saved.editor.autoSaveMs).toBe(10_000);
    // git interval 超上限 → clamp
    const saved2 = await saveVaultSettings(root, {
      git: { autoCommitIntervalMs: 0 },
    });
    expect(saved2.git.autoCommitIntervalMs).toBe(2_000);
    // 重新读取持久化结果
    const reread = await readVaultConfig(root);
    expect(reread.settings.editor.autoSaveMs).toBe(10_000);
  });

  it('读取损坏的 vault 设置时回退默认', async () => {
    const root = path.join(tmp, 'corrupt-set');
    await createVault(tmp, 'corrupt-set');
    const configPath = path.join(root, NEXNOTE_DIR, CONFIG_FILENAME);
    const cfg = JSON.parse(await (await import('node:fs/promises')).readFile(configPath, 'utf8'));
    cfg.settings = null;
    await (
      await import('node:fs/promises')
    ).writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
    const reread = await readVaultConfig(root);
    expect(reread.settings).toEqual(defaultVaultSettings());
  });
});
