import { isAbsolute, normalize } from 'node:path';
import type {
  PluginContribution,
  PluginContributionKind,
  PluginManifest,
  PluginPermission,
} from '@nexnote/shared';
import { isValidSemver, semverGte } from './version-compat';

export const PERMISSIONS: readonly PluginPermission[] = [
  'read',
  'edit',
  'filesystem',
  'network',
  'external-command',
  'desktop-privileged',
];

export const CONTRIBUTION_KINDS: readonly PluginContributionKind[] = [
  'commands',
  'menus',
  'views',
  'blockTypes',
];

export class ManifestError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ManifestError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ManifestError(`manifest.${field} 必须是字符串数组`, 'INVALID_MANIFEST');
  }
  return value;
}

export function validateManifest(raw: unknown): PluginManifest {
  if (!isRecord(raw)) throw new ManifestError('manifest 必须是 JSON 对象', 'INVALID_MANIFEST');
  for (const field of ['id', 'name', 'version', 'minAppVersion', 'main'] as const) {
    if (typeof raw[field] !== 'string' || (raw[field] as string).trim() === '') {
      throw new ManifestError(`manifest.${field} 必须是非空字符串`, 'INVALID_MANIFEST');
    }
  }
  if (!isValidSemver(String(raw.version))) {
    throw new ManifestError('manifest.version 必须是合法 semver', 'INVALID_PLUGIN_VERSION');
  }
  if (!isValidSemver(String(raw.minAppVersion))) {
    throw new ManifestError('manifest.minAppVersion 必须是合法 semver', 'INVALID_MIN_APP_VERSION');
  }
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/i.test(String(raw.id))) {
    throw new ManifestError('插件 ID 必须是反向域名式命名空间', 'INVALID_MANIFEST');
  }
  const main = String(raw.main);
  const normalizedMain = normalize(main).replaceAll('\\', '/');
  if (isAbsolute(main) || normalizedMain === '..' || normalizedMain.startsWith('../')) {
    throw new ManifestError('manifest.main 必须是插件目录内的相对路径', 'INVALID_MANIFEST');
  }
  const declared = stringList(raw.capabilities ?? [], 'capabilities') as PluginPermission[];
  const permissions = stringList(raw.permissions ?? declared, 'permissions') as PluginPermission[];
  for (const permission of [...declared, ...permissions]) {
    if (!PERMISSIONS.includes(permission)) {
      throw new ManifestError(`未知权限: ${permission}`, 'INVALID_MANIFEST');
    }
  }
  const contributions: Partial<Record<PluginContributionKind, PluginContribution[]>> = {};
  if (raw.contributions !== undefined) {
    if (!isRecord(raw.contributions)) {
      throw new ManifestError('manifest.contributions 必须是对象', 'INVALID_MANIFEST');
    }
    for (const kind of CONTRIBUTION_KINDS) {
      const value = raw.contributions[kind];
      if (value === undefined) continue;
      if (
        !Array.isArray(value) ||
        value.some(
          (item) =>
            !isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string',
        )
      ) {
        throw new ManifestError(`manifest.contributions.${kind} 格式无效`, 'INVALID_MANIFEST');
      }
      contributions[kind] = value.map((item) => ({
        id: String(item.id),
        title: String(item.title),
        ...(Array.isArray(item.keywords) &&
        item.keywords.every((k: unknown) => typeof k === 'string')
          ? { keywords: item.keywords as string[] }
          : {}),
      }));
    }
  }
  return {
    id: String(raw.id),
    name: String(raw.name),
    version: String(raw.version),
    minAppVersion: String(raw.minAppVersion),
    main,
    capabilities: declared,
    permissions,
    contributions,
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
  };
}

export function assertHostCompatible(manifest: PluginManifest, hostVersion: string): void {
  if (!isValidSemver(hostVersion)) {
    throw new ManifestError(`宿主版本不是合法 semver: ${hostVersion}`, 'INVALID_HOST_VERSION');
  }
  if (!isValidSemver(manifest.minAppVersion)) {
    throw new ManifestError(
      `manifest.minAppVersion 非法: ${manifest.minAppVersion}`,
      'INVALID_MIN_APP_VERSION',
    );
  }
  if (!semverGte(hostVersion, manifest.minAppVersion)) {
    throw new ManifestError(
      `插件需要 NexNote >= ${manifest.minAppVersion}，当前为 ${hostVersion}`,
      'HOST_VERSION_TOO_OLD',
    );
  }
}
