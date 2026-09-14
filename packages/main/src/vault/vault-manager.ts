import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import {
  defaultVaultConfig,
  defaultVaultSettings,
  mergeVaultPatch,
  type VaultConfig,
  type VaultInfo,
  type VaultLayout,
  type VaultSettings,
  type VaultSettingsPatch,
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

/**
 * 校验对话会话存储目录（vault 相对路径）：仅允许单层/多层普通目录名，
 * 拒绝绝对路径、.. 逃逸、前导点目录与非法文件名字符；非法时返回 null（回退默认）。
 */
export function sanitizeChatFolder(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '');
  if (value.length === 0) return null;
  const parts = value.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  for (const part of parts) {
    if (part === '.' || part === '..' || part.startsWith('.')) return null;
    // eslint-disable-next-line no-control-regex
    if (/[\\/:*?"<>|\u0000-\u001f]/.test(part)) return null;
  }
  return parts.join('/');
}

/** 校验目录是否可作为 vault 根（存在且为目录）。 */
export async function validateVaultRoot(root: string): Promise<void> {
  if (!path.isAbsolute(root)) {
    throw new VaultError(`知识库路径必须是绝对路径: ${root}`, 'PATH_NOT_ABSOLUTE');
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
      chatFolder: sanitizeChatFolder(parsed?.chatFolder) ?? fallback.chatFolder,
      settings: mergeVaultSettings(parsed?.settings),
      layout: { ...fallback.layout, ...(parsed?.layout ?? {}) },
      // DEV-021：files 占位页已删除，旧配置残留的 files tab 恢复时静默丢弃
      lastSession: {
        tabs: (parsed?.lastSession?.tabs ?? []).filter((tab) => tab.kind !== 'files'),
      },
    };
  } catch {
    return defaultVaultConfig();
  }
}

/** 读取 vault 独立设置（编辑器 + Git 行为）；损坏/缺失时逐字段回退默认。 */
export function mergeVaultSettings(raw: unknown): VaultSettings {
  const base = defaultVaultSettings();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return base;
  const value = raw as VaultSettings;
  return mergeVaultPatch(base, { editor: value.editor, git: value.git });
}

/** 持久化 vault 设置补丁：只改 settings 字段，保留其余配置。 */
export async function saveVaultSettings(
  root: string,
  patch: VaultSettingsPatch,
): Promise<VaultSettings> {
  const config = await readVaultConfig(root);
  const merged = mergeVaultPatch(config.settings, patch);
  await writeVaultConfig(root, { ...config, settings: merged });
  return merged;
}

/** 读取当前 vault 设置；无 vault 时返回默认（非 vault-scoped 写入应在 handler 处拒绝）。 */
export async function readVaultSettings(root: string): Promise<VaultSettings> {
  const config = await readVaultConfig(root);
  return config.settings;
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
  // 防 symlink substitution：相对 parentDir 解析必须仍是其直接子路径，
  // 且 root 本身绝不能是符号链接（防止被替换为指向外部目录的链接）。
  const rel = path.relative(parentDir, root);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new VaultError(`知识库名称必须为 ${parentDir} 的直接子目录`, 'INVALID_NAME');
  }
  let exists = false;
  try {
    await fsp.access(root);
    exists = true;
  } catch {
    /* 不存在 → 走新建分支 */
  }
  if (exists) {
    // lstat 而非 stat：拒绝通过符号链接指向外部目录的写入目标，防止被替换为外部空目录后写入。
    const stat = await fsp.lstat(root).catch(() => null);
    if (!stat) throw new VaultError(`无法访问: ${root}`, 'VAULT_EXISTS_FILE');
    if (stat.isSymbolicLink()) {
      throw new VaultError(`目标位置是符号链接，拒绝创建知识库: ${root}`, 'VAULT_TARGET_SYMLINK');
    }
    if (!stat.isDirectory()) {
      throw new VaultError(`目标位置存在同名文件: ${root}`, 'VAULT_EXISTS_FILE');
    }
    const entries = await fsp.readdir(root);
    if (entries.length > 0) {
      throw new VaultError(`目录已存在且非空: ${root}`, 'VAULT_EXISTS_NON_EMPTY');
    }
    // 空目录已存在 → 直接原地初始化，不重复 mkdir
    return ensureVault(root);
  }
  await fsp.mkdir(root, { recursive: false });
  return ensureVault(root);
}

/**
 * 校验一个已存在路径的每个组件都不是符号链接（lstat），
 * 防止 ``parentDir/..`` 或嵌套 symlink 把写入导向 vault 外。任何组件是链接即拒绝。
 */
export async function assertNoSymlinkComponent(absPath: string): Promise<void> {
  const segments = absPath.split(path.sep).filter((segment) => segment.length > 0);
  let current = path.parse(absPath).root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await fsp.lstat(current).catch(() => null);
    if (stat?.isSymbolicLink()) {
      throw new VaultError(`路径经过符号链接，拒绝操作: ${current}`, 'SYMLINK_COMPONENT');
    }
  }
}

/** 保存布局（仅更新 layout 字段，保留其余配置）。 */
export async function saveVaultLayout(root: string, layout: VaultLayout): Promise<void> {
  const config = await readVaultConfig(root);
  await writeVaultConfig(root, { ...config, layout });
}
