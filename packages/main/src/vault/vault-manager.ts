import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { homedir, tmpdir } from 'node:os';
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
 * 校验目录是否可作为 vault 根（存在且为目录），并返回检查后的 canonical 安全路径。
 * 调用方必须把后续 Git cwd 与文件写入都绑定到返回值，而不是继续使用原始输入。
 */
export async function validateVaultRoot(root: string): Promise<string> {
  if (!path.isAbsolute(root)) {
    throw new VaultError(`知识库路径必须是绝对路径: ${root}`, 'PATH_NOT_ABSOLUTE');
  }
  // `..` segments are rejected before any normalization: resolving first would make
  // `/safe/link/../vault` lstat the wrong directory while Git still uses the raw one.
  const safe = await safeVaultPath(root);
  let stat;
  try {
    stat = await fsp.stat(safe);
  } catch {
    throw new VaultError(`目录不存在: ${root}`, 'NOT_FOUND');
  }
  if (!stat.isDirectory()) {
    throw new VaultError(`路径不是目录: ${root}`, 'NOT_DIRECTORY');
  }
  return safe;
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
  return mergeVaultPatch(base, { editor: value.editor, git: value.git, binary: value.binary });
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
  const safe = await validateVaultRoot(root);
  const config = await readVaultConfig(safe);
  // 校验通过即视为合法配置（损坏时 readVaultConfig 已回退默认），统一写回以补齐缺失文件。
  await writeVaultConfig(safe, config);
  return vaultInfoFor(safe);
}

/**
 * 在 parentDir 下新建名为 name 的空 vault。
 * 目标已存在且为空目录时原地初始化；非空时报错。
 */
export async function createVault(parentDir: string, name: string): Promise<VaultInfo> {
  const safeParent = await validateVaultRoot(parentDir);
  const sanitized = sanitizeVaultName(name);
  if (!sanitized.ok) {
    throw new VaultError(sanitized.reason, 'INVALID_NAME');
  }
  const root = path.join(safeParent, sanitized.value);
  // 防 symlink substitution：相对 parentDir 解析必须仍是其直接子路径，
  // 且 root 本身绝不能是符号链接（防止被替换为指向外部目录的链接）。
  const rel = path.relative(safeParent, root);
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

/** `..` 或 `.` 段在归一化前拒绝；Windows 同时接受 `/` 与 `\`，所以按任意一种分隔符拆分。 */
export function assertNoDotDotSegments(absolute: string): void {
  const segments = absolute.split(/[\\/]/).filter(Boolean);
  if (segments.includes('..') || segments.includes('.')) {
    throw new VaultError(`知识库路径不能包含 .. 或 . 段: ${absolute}`, 'INVALID_PATH');
  }
}

/**
 * 逐段 lstat（不解析 symlink）校验所有现存组件，返回未被解析的安全规范化路径。
 * 任何组件是链接即拒绝；`..` 段在规范化前被拒绝。
 */
export async function safeVaultPath(absPath: string): Promise<string> {
  if (!path.isAbsolute(absPath)) {
    throw new VaultError(`知识库路径必须是绝对路径: ${absPath}`, 'PATH_NOT_ABSOLUTE');
  }
  assertNoDotDotSegments(absPath);
  const absolute = path.resolve(absPath);
  const trustedRoot = await resolveSafeRoot(absolute);
  const relative = path.relative(trustedRoot, absolute);
  const segments = relative.split(path.sep).filter(Boolean);
  let current = trustedRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await fsp.lstat(current).catch(() => null);
    if (stat?.isSymbolicLink()) {
      throw new VaultError(`路径经过符号链接，拒绝操作: ${current}`, 'SYMLINK_COMPONENT');
    }
  }
  return absolute;
}

/**
 * 返回检查起点：OS 环境前缀（/tmp 与 home 的逐组件安全解析结果）之外都属于应用可控区域，
 * 从环境别名解析到的真实目录开始逐段检查。该返回前缀本身不经过应用 symlink 检查。
 */
export function isWithinRelativePath(
  relative: string,
  pathApi: { isAbsolute: (p: string) => boolean },
): boolean {
  // Cross-drive relative results (e.g. path.win32.relative('C:\\', 'D:\\vault') →
  // 'D:\\vault') are absolute for the target root and must never count as within.
  if (pathApi.isAbsolute(relative)) return false;
  if (relative === '') return true;
  if (relative === '..') return false;
  if (relative.startsWith('../') || relative.startsWith('..\\')) return false;
  return !relative.startsWith('/') && !relative.startsWith('\\');
}

export function isWithinPathRoot(
  trustedRoot: string,
  absolute: string,
  pathApi: Pick<typeof path, 'relative' | 'sep' | 'isAbsolute'> = path,
): boolean {
  return isWithinRelativePath(pathApi.relative(trustedRoot, absolute), pathApi);
}

export function selectSafeRoot(
  absPath: string,
  candidates: string[],
  pathApi: Pick<typeof path, 'relative' | 'sep' | 'isAbsolute' | 'parse'> = path,
): string {
  for (const candidate of candidates) {
    if (isWithinPathRoot(candidate, absPath, pathApi)) return candidate;
  }
  // Cross-drive paths deliberately fall back to the TARGET drive root. Subsequent
  // component checks therefore start at D:\ for D:\Vault, never C:\...\D:\Vault.
  return pathApi.parse(absPath).root;
}

export async function resolveSafeRoot(absPath: string): Promise<string> {
  const candidateRoots = await Promise.all(
    [tmpdir(), homedir()].map(async (root) => {
      const resolved = path.resolve(root);
      try {
        const real = await fsp.realpath(resolved);
        return { resolved, real };
      } catch {
        return { resolved, real: resolved };
      }
    }),
  );
  return selectSafeRoot(
    absPath,
    candidateRoots.flatMap((root) => [root.resolved, root.real]),
  );
}

/**
 * 校验一个已存在路径的每个组件都不是符号链接（lstat），
 * 防止 ``parentDir/..`` 或嵌套 symlink 把写入导向 vault 外。任何组件是链接即拒绝。
 */
export async function assertNoSymlinkComponent(absPath: string): Promise<void> {
  await safeVaultPath(absPath);
}

/** 保存布局（仅更新 layout 字段，保留其余配置）。 */
export async function saveVaultLayout(root: string, layout: VaultLayout): Promise<void> {
  const config = await readVaultConfig(root);
  await writeVaultConfig(root, { ...config, layout });
}
