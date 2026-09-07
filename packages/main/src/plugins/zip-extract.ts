import { inflateRawSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

/**
 * 最小 ZIP 读取器（DEV-013），零第三方依赖：
 * - 解析 EOCD + 中央目录，支持 method 0（stored）/ 8（deflate）。
 * - 防 ZIP Slip（路径逃逸）、单包/单条目大小与条目数限制。
 * - 统一「外层包裹目录」：若全部条目共享同一个顶层目录则剥离（wrapper-dir）。
 */

export interface ZipEntry {
  /** 已归一化（POSIX 分隔、去掉 wrapper 目录）的包内相对路径；目录以 / 结尾。 */
  name: string;
  dir: boolean;
  data: Buffer;
}

export class ZipError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ZipError';
  }
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function findEOCD(buf: Buffer): number {
  // EOCD 位于文件末尾（注释最长 65535）。
  const max = Math.min(buf.length, 65557);
  for (let i = buf.length - 22; i >= buf.length - max && i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new ZipError('非法 zip：找不到中央目录结尾', 'INVALID_ZIP');
}

interface CentralRecord {
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  name: string;
  localOffset: number;
  externalAttr: number;
}

function readCentralDirectory(buf: Buffer): CentralRecord[] {
  const eocd = findEOCD(buf);
  const total = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const records: CentralRecord[] = [];
  for (let i = 0; i < total; i += 1) {
    if (buf.readUInt32LE(offset) !== CENTRAL_SIG) {
      throw new ZipError('非法 zip：中央目录损坏', 'INVALID_ZIP');
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const externalAttr = buf.readUInt32LE(offset + 38);
    const name = buf.slice(offset + 46, offset + 46 + nameLen).toString('utf8');
    records.push({ method, compressedSize, uncompressedSize, name, localOffset, externalAttr });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return records;
}

function readLocalData(buf: Buffer, rec: CentralRecord): Buffer {
  const off = rec.localOffset;
  if (buf.readUInt32LE(off) !== LOCAL_SIG) {
    throw new ZipError('非法 zip：本地文件头损坏', 'INVALID_ZIP');
  }
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  const raw = buf.slice(dataStart, dataStart + rec.compressedSize);
  if (rec.method === 0) return raw;
  if (rec.method === 8) return inflateRawSync(raw);
  throw new ZipError(`不支持的压缩方式: ${rec.method}`, 'ZIP_UNSUPPORTED_METHOD');
}

/** 去掉单一包裹目录：所有非根条目共享同一个顶层目录时剥离。 */
function stripWrapperDir(names: string[]): string[] {
  const tops = new Set<string>();
  for (const n of names) {
    const clean = n.replace(/^\.?\//, '');
    const slash = clean.indexOf('/');
    if (slash >= 0) tops.add(clean.slice(0, slash));
  }
  if (tops.size !== 1) return names.map((n) => n.replace(/^\.?\//, ''));
  const wrapper = [...tops][0]!;
  return names.map((n) => n.replace(/^\.?\//, '').replace(new RegExp(`^${wrapper.replace(/[.*+?^${'$'}()|[\]\\]/g, '\\$&')}\\/?`), ''));
}

export interface SafeExtractOptions {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

/** 读取并校验 zip 条目（含 wrapper 目录归一化）；不写盘。 */
export function readZipEntries(buffer: Buffer, options: SafeExtractOptions): ZipEntry[] {
  if (buffer.byteLength > options.maxTotalBytes) {
    throw new ZipError('zip 资源超限', 'ZIP_BOMB');
  }
  const central = readCentralDirectory(buffer);
  if (central.length === 0) throw new ZipError('zip 为空', 'INVALID_ZIP');
  if (central.length > options.maxEntries) throw new ZipError('zip 条目过多', 'ZIP_ENTRY_LIMIT');

  const rawNames = central.map((r) => r.name.replaceAll('\\', '/'));
  const normalized = stripWrapperDir(rawNames);

  const entries: ZipEntry[] = [];
  let total = 0;
  central.forEach((rec, i) => {
    const name = normalized[i]!;
    const dirName = rawNames[i]!.endsWith('/') || name.endsWith('/');
    if (name === '' || name === '.') return;
    if (name.split('/').includes('..') || name.startsWith('/')) {
      throw new ZipError('zip 路径越界', 'ZIP_PATH_TRAVERSAL');
    }
    const isDir = dirName || (rec.externalAttr >>> 16 & 0x10) !== 0;
    if (isDir) {
      entries.push({ name, dir: true, data: Buffer.alloc(0) });
      return;
    }
    if (rec.uncompressedSize > options.maxEntryBytes) {
      throw new ZipError('zip 单条目过大', 'ZIP_ENTRY_TOO_LARGE');
    }
    const data = readLocalData(buffer, rec);
    if (data.byteLength > options.maxEntryBytes) {
      throw new ZipError('zip 单条目过大', 'ZIP_ENTRY_TOO_LARGE');
    }
    total += data.byteLength;
    if (total > options.maxTotalBytes) throw new ZipError('zip 解压总量超限', 'ZIP_BOMB');
    entries.push({ name, dir: false, data });
  });
  return entries;
}

/** 安全解压到目标目录（返回写入的文件相对路径）。 */
export function extractZipTo(buffer: Buffer, target: string, options: SafeExtractOptions): string[] {
  const entries = readZipEntries(buffer, options);
  const written: string[] = [];
  for (const entry of entries) {
    const dest = join(target, entry.name);
    const rel = normalize(dest);
    if (!rel.startsWith(normalize(target))) {
      throw new ZipError('zip 路径越界', 'ZIP_PATH_TRAVERSAL');
    }
    if (entry.dir) {
      mkdirSync(dest, { recursive: true });
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, entry.data, { mode: 0o400 });
    written.push(entry.name);
  }
  return written;
}

/** 在 zip 条目中定位唯一的 manifest.json（wrapper 已剥离）。 */
export function findManifestEntry(entries: ZipEntry[]): ZipEntry | null {
  const matches = entries.filter((e) => !e.dir && /(^|\/)manifest\.json$/.test(e.name));
  if (matches.length > 1) throw new ZipError('zip 中存在多个 manifest.json', 'DUPLICATE_MANIFEST');
  return matches[0] ?? null;
}
