import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import {
  defaultVaultConfig,
  type VaultConfig,
  type VaultInfo,
  type VaultLayout,
} from '@nexnote/shared';

export class VaultError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'VaultError';
  }
}

export const NEXNOTE_DIR = '.nexnote';
export const CONFIG_FILENAME = 'config.json';

/** 校验用户新建 vault 时输入的名称。 */
export function sanitizeVaultName(
  raw: string,
): { ok: true; value: string } | { ok: false; reason: string } {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, reason: '名称不能为空' };
  if (value.length > 64) return { ok: false, reason: '名称过长（≤64 字符）' };
  if (value === '.' || value === '..') return { ok: false, reason: '非法名称' };
  if (value.startsWith('.')) return { ok: false, reason: '名称不能以 . 开头' };
  // 文件名中的控制字符一律拒绝（eslint no-control-regex 对此合法用途放行）
  // eslint-disable-next-line no-control-regex
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(value)) {
    return { ok: false, reason: '名称包含非法字符 / \\ : * ? " < > |' };
  }
  return { ok: true, value };
}

/** 校验目录是否可作为 vault 根（存在且为目录）。 */
export async function validateVaultRoot(root: string): Promise<void> {
  if (!path.isAbsolute(root)) {
    throw new VaultError(`vault 路径必须是绝对路径: ${root}`, 'PATH_NOT_ABSOLUTE');
  }
  let stat;
  try {
    stat = await fsp.stat(root);
  } catch {
    throw new VaultError(`目录不存在: ${root}`, 'NOT_FOUND');
  }
  if (!stat.isDirectory()) {
    throw new VaultError(`路径不是目录: ${root}`, 'NOT_DIRECTORY');
  }
}

export function vaultInfoFor(root: string): VaultInfo {
  return {
    root,
    name: path.basename(root),
    configPath: path.join(root, NEXNOTE_DIR, CONFIG_FILENAME),
  };
}

/** 读取 vault 配置；损坏时自动重置为默认值（配置是可重建的派生数据）。 */
export async function readVaultConfig(root: string): Promise<VaultConfig> {
  const configPath = path.join(root, NEXNOTE_DIR, CONFIG_FILENAME);
  try {
    const raw = await fsp.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<VaultConfig>;
    const fallback = defaultVaultConfig();
    return {
      version: 1,
      features: {
        confidenceFrontmatter: parsed?.features?.confidenceFrontmatter === true,
      },
      layout: { ...fallback.layout, ...(parsed?.layout ?? {}) },
      lastSession: { ...fallback.lastSession, ...(parsed?.lastSession ?? {}) },
    };
  } catch {
    return defaultVaultConfig();
  }
}

/** 原子写 vault 配置（tmp + rename）。 */
export async function writeVaultConfig(root: string, config: VaultConfig): Promise<void> {
  const configDir = path.join(root, NEXNOTE_DIR);
  await fsp.mkdir(configDir, { recursive: true });
  const configPath = path.join(configDir, CONFIG_FILENAME);
  const tmpPath = `${configPath}.tmp`;
  await fsp.writeFile(tmpPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await fsp.rename(tmpPath, configPath);
}

/**
 * 把目录初始化为 vault（幂等）：确保 .nexnote/ 与 config.json 存在。
 * 「打开本地文件夹」也走这里——缺 .nexnote 时自动补齐。
 */
export async function ensureVault(root: string): Promise<VaultInfo> {
  await validateVaultRoot(root);
  const config = await readVaultConfig(root);
  // 校验通过即视为合法配置（损坏时 readVaultConfig 已回退默认），统一写回以补齐缺失文件。
  await writeVaultConfig(root, config);
  return vaultInfoFor(root);
}

/**
 * 在 parentDir 下新建名为 name 的空 vault。
 * 目标已存在且为空目录时原地初始化；非空时报错。
 */
export async function createVault(parentDir: string, name: string): Promise<VaultInfo> {
  await validateVaultRoot(parentDir);
  const sanitized = sanitizeVaultName(name);
  if (!sanitized.ok) {
    throw new VaultError(sanitized.reason, 'INVALID_NAME');
  }
  const root = path.join(parentDir, sanitized.value);
  let exists = false;
  try {
    await fsp.access(root);
    exists = true;
  } catch {
    /* 不存在 → 走新建分支 */
  }
  if (exists) {
    const stat = await fsp.stat(root);
    if (!stat.isDirectory()) {
      throw new VaultError(`目标位置存在同名文件: ${root}`, 'VAULT_EXISTS_FILE');
    }
    const entries = await fsp.readdir(root);
    if (entries.length > 0) {
      throw new VaultError(`目录已存在且非空: ${root}`, 'VAULT_EXISTS_NON_EMPTY');
    }
  }
  await fsp.mkdir(root, { recursive: true });
  return ensureVault(root);
}

/** 保存布局（仅更新 layout 字段，保留其余配置）。 */
export async function saveVaultLayout(root: string, layout: VaultLayout): Promise<void> {
  const config = await readVaultConfig(root);
  await writeVaultConfig(root, { ...config, layout });
}
