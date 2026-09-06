import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { PluginInstallTicket, PluginManifest, PluginPermission } from '@nexnote/shared';
import { validateManifest } from './manifest-validator';
import { extractZipTo, readZipEntries, ZipError, type SafeExtractOptions } from './zip-extract';

export const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MANIFEST_LIMIT = 1_048_576;

const ZIP_LIMITS: SafeExtractOptions = {
  maxEntries: 2000,
  maxEntryBytes: 4 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
};

export class IntakeError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'IntakeError';
  }
}

export interface StageResult {
  ticket: string;
  artifactHash: string;
  stagingPath: string;
  source: 'directory' | 'zip';
  manifest: PluginManifest;
  /** 入口的相对路径（staging 内）。 */
  mainRel: string;
  requestedPermissions: PluginPermission[];
}

function stageDir(root: string, ticket: string): string {
  return join(root, ticket);
}

function hashOf(manifest: Buffer, entry: Buffer): string {
  return createHash('sha256')
    .update(manifest)
    .update(Buffer.from([0]))
    .update(entry)
    .digest('hex');
}

function readManifestFile(abs: string): { manifest: PluginManifest; raw: Buffer } {
  if (!existsSync(abs)) throw new IntakeError('manifest.json 缺失', 'MANIFEST_MISSING');
  const raw = readFileSync(abs);
  if (raw.byteLength > MANIFEST_LIMIT) throw new IntakeError('manifest 超过 1 MiB 限制', 'MANIFEST_TOO_LARGE');
  return { manifest: validateManifest(JSON.parse(raw.toString('utf8'))), raw };
}

/** 复制入口文件到 staging（只读）。仅快照 manifest 与入口，运行时只需要入口源码。 */
function snapshotEntry(srcEntry: string, destEntry: string): Buffer {
  if (!existsSync(srcEntry)) throw new IntakeError(`插件入口缺失: ${srcEntry}`, 'ENTRY_NOT_FOUND');
  const buf = readFileSync(srcEntry);
  if (buf.byteLength > MAX_ARTIFACT_BYTES) throw new IntakeError('入口超过资源限制', 'PLUGIN_RESOURCE_LIMIT');
  mkdirSync(dirname(destEntry), { recursive: true });
  writeFileSync(destEntry, buf, { mode: 0o400 });
  return buf;
}

/**
 * 将源安装包（目录或 zip）不可变快照到 pluginsRoot/<ticket>/，返回安装票据载荷。
 * 后续 confirmInstall 只引用该 stagingPath，阻断 TOCTOU。
 */
export function stageArtifact(
  source: 'directory' | 'zip',
  sourcePath: string,
  pluginsRoot: string,
): StageResult {
  if (!isAbsolute(sourcePath)) {
    throw new IntakeError('安装路径必须是绝对路径', 'INVALID_SOURCE_PATH');
  }
  const ticket = randomBytes(16).toString('hex');
  const staging = stageDir(pluginsRoot, ticket);
  if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  let manifest: PluginManifest;
  let manifestRaw: Buffer;
  let entryBuf: Buffer;

  try {
    if (source === 'directory') {
      const mf = readManifestFile(resolve(sourcePath, 'manifest.json'));
      manifest = mf.manifest;
      manifestRaw = mf.raw;
      const mainRel = manifest.main.replaceAll('\\', '/');
      entryBuf = snapshotEntry(resolve(sourcePath, mainRel), join(staging, mainRel));
      writeFileSync(join(staging, 'manifest.json'), manifestRaw, { mode: 0o400 });
    } else {
      const zipBuf = readFileSync(sourcePath);
      if (zipBuf.byteLength > MAX_ARTIFACT_BYTES) {
        throw new IntakeError('zip 资源超限', 'ARTIFACT_TOO_LARGE');
      }
      // 先预扫描校验，再解压（wrapper 目录归一化在 readZipEntries 内完成）。
      readZipEntries(zipBuf, ZIP_LIMITS);
      extractZipTo(zipBuf, staging, ZIP_LIMITS);
      const mf = readManifestFile(join(staging, 'manifest.json'));
      manifest = mf.manifest;
      manifestRaw = mf.raw;
      const mainRel = manifest.main.replaceAll('\\', '/');
      // 解压已将 manifest 与入口以只读写入 staging；直接读取入口用于哈希，避免回写只读文件。
      entryBuf = readFileSync(join(staging, mainRel));
    }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (error instanceof IntakeError || error instanceof ZipError) throw error;
    throw new IntakeError((error as Error).message, 'STAGE_FAILED');
  }

  return {
    ticket,
    artifactHash: hashOf(manifestRaw, entryBuf),
    stagingPath: staging,
    source,
    manifest,
    mainRel: manifest.main.replaceAll('\\', '/'),
    requestedPermissions: manifest.permissions,
  };
}

/** confirm 时复算 hash，确保 staging 在 preview 之后未被篡改。 */
export function assertStageUnchanged(stage: Pick<StageResult, 'stagingPath' | 'mainRel' | 'artifactHash'>): Buffer {
  const manifestRaw = readFileSync(join(stage.stagingPath, 'manifest.json'));
  const entry = readFileSync(join(stage.stagingPath, stage.mainRel));
  const hash = hashOf(manifestRaw, entry);
  if (hash !== stage.artifactHash) {
    throw new IntakeError('安装内容在校验后发生变化', 'ARTIFACT_CHANGED');
  }
  return entry;
}

export function toInstallTicket(stage: StageResult, existing?: PluginManifest): PluginInstallTicket {
  // 升级：仅新增权限需要再次确认；全新安装：列出全部声明权限。
  const previous = new Set(existing?.permissions ?? []);
  const requestedPermissions = existing
    ? stage.manifest.permissions.filter((p) => !previous.has(p))
    : stage.manifest.permissions;
  return {
    ticket: stage.ticket,
    artifactHash: stage.artifactHash,
    source: stage.source,
    manifest: stage.manifest,
    requestedPermissions,
  };
}
