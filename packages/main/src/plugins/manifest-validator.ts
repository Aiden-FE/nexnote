import { isAbsolute, normalize } from 'node:path';
import type {
  PluginContribution,
  PluginContributionKind,
  PluginManifest,
  PluginPermission,
  PluginSkillContribution,
} from '@nexnote/shared';
import { isValidSemver, semverGte } from './version-compat';
import { tCurrent } from '@nexnote/shared';

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
    throw new ManifestError(
      tCurrent('plugin.manifest.INVALID_STRING_LIST', { field }),
      'INVALID_MANIFEST',
    );
  }
  return value;
}

export function validateManifest(raw: unknown): PluginManifest {
  if (!isRecord(raw))
    throw new ManifestError(tCurrent('plugin.manifest.NOT_OBJECT'), 'INVALID_MANIFEST');
  for (const field of ['id', 'name', 'version', 'minAppVersion', 'main'] as const) {
    if (typeof raw[field] !== 'string' || (raw[field] as string).trim() === '') {
      throw new ManifestError(
        tCurrent('plugin.manifest.EMPTY_REQUIRED_FIELD', { field }),
        'INVALID_MANIFEST',
      );
    }
  }
  if (!isValidSemver(String(raw.version))) {
    throw new ManifestError(tCurrent('plugin.manifest.INVALID_VERSION'), 'INVALID_PLUGIN_VERSION');
  }
  if (!isValidSemver(String(raw.minAppVersion))) {
    throw new ManifestError(
      tCurrent('plugin.manifest.INVALID_MIN_APP_VERSION'),
      'INVALID_MIN_APP_VERSION',
    );
  }
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/i.test(String(raw.id))) {
    throw new ManifestError(tCurrent('plugin.manifest.INVALID_ID'), 'INVALID_MANIFEST');
  }
  const main = String(raw.main);
  const normalizedMain = normalize(main).replaceAll('\\', '/');
  if (isAbsolute(main) || normalizedMain === '..' || normalizedMain.startsWith('../')) {
    throw new ManifestError(
      tCurrent('plugin.manifest.MAIN_NOT_RELATIVE'),
      'INVALID_MANIFEST',
    );
  }
  const declared = stringList(raw.capabilities ?? [], 'capabilities') as PluginPermission[];
  const permissions = stringList(raw.permissions ?? declared, 'permissions') as PluginPermission[];
  for (const permission of [...declared, ...permissions]) {
    if (!PERMISSIONS.includes(permission)) {
      throw new ManifestError(
        tCurrent('plugin.manifest.UNKNOWN_PERMISSION', { permission }),
        'INVALID_MANIFEST',
      );
    }
  }
  const contributions: Partial<Record<PluginContributionKind, PluginContribution[]>> = {};
  if (raw.contributions !== undefined) {
    if (!isRecord(raw.contributions)) {
      throw new ManifestError(
        tCurrent('plugin.manifest.CONTRIBUTIONS_NOT_OBJECT'),
        'INVALID_MANIFEST',
      );
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
        throw new ManifestError(
          tCurrent('plugin.manifest.INVALID_CONTRIBUTIONS', { kind }),
          'INVALID_MANIFEST',
        );
      }
      contributions[kind] = value.map((item) => ({
        id: String(item.id),
        title: String(item.title),
        ...(Array.isArray(item.keywords) &&
        item.keywords.every((k: unknown) => typeof k === 'string')
          ? { keywords: item.keywords as string[] }
          : {}),
        ...(kind === 'views' &&
        (item.placement === 'sidebar' || item.placement === 'main' || item.placement === 'settings')
          ? { placement: item.placement }
          : {}),
        ...(kind === 'menus' &&
        (item.anchor === 'editor/context' || item.anchor === 'block/handle' || item.anchor === 'app')
          ? { anchor: item.anchor }
          : {}),
        ...(kind === 'menus' && isRecord(item.when)
          ? { when: item.when as PluginContribution['when'] }
          : {}),
        ...(kind === 'blockTypes' && typeof item.blockType === 'string'
          ? { blockType: String(item.blockType) }
          : {}),
      }));
    }
  }
  let skills: PluginManifest['skills'];
  if (raw.skills !== undefined) {
    if (
      !Array.isArray(raw.skills) ||
      raw.skills.some((skill) => !isRecord(skill) || typeof skill.id !== 'string')
    ) {
      throw new ManifestError(tCurrent('plugin.manifest.INVALID_SKILLS'), 'INVALID_MANIFEST');
    }
    skills = raw.skills.map((skill) => ({
      id: String(skill.id),
      ...(typeof skill.name === 'string' ? { name: skill.name } : {}),
      ...(typeof skill.description === 'string' ? { description: skill.description } : {}),
      ...(isRecord(skill.params) ? { params: skill.params as PluginSkillContribution['params'] } : {}),
    }));
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
    ...(skills ? { skills } : {}),
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
  };
}

export function assertHostCompatible(manifest: PluginManifest, hostVersion: string): void {
  if (!isValidSemver(hostVersion)) {
    throw new ManifestError(
      tCurrent('plugin.manifest.INVALID_HOST_VERSION', { version: hostVersion }),
      'INVALID_HOST_VERSION',
    );
  }
  if (!isValidSemver(manifest.minAppVersion)) {
    throw new ManifestError(
      tCurrent('plugin.manifest.INVALID_MIN_APP_VERSION', {
        version: manifest.minAppVersion,
      }),
      'INVALID_MIN_APP_VERSION',
    );
  }
  if (!semverGte(hostVersion, manifest.minAppVersion)) {
    throw new ManifestError(
      tCurrent('plugin.manifest.HOST_VERSION_TOO_OLD', {
        required: manifest.minAppVersion,
        current: hostVersion,
      }),
      'HOST_VERSION_TOO_OLD',
    );
  }
}
