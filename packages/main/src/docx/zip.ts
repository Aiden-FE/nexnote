import { deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * DOCX 专用最小 ZIP 读写器（零第三方依赖）：
 * - 读：定位 EOCD → 遍历中央目录 → 按精确名取单条目（stored/deflate），校验 CRC32。
 * - 写：local header + 中央目录 + EOCD，全部条目 deflate + 正确 CRC32。
 * 与 plugins/zip-extract.ts 的差异：后者服务于插件解包（wrapper 目录剥离、全量落盘），
 * 这里只做 docx 包内 word/document.xml 的单条目读取与整包构造，任何损坏 fail closed。
 */

export class ZipError extends Error {
  constructor(
    message: string,
    readonly code: string = 'DOCX_INVALID_ZIP',
  ) {
    super(message);
    this.name = 'ZipError';
  }
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** 标准 CRC-32（IEEE 802.3）查表实现。 */
const CRC_TABLE = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let j = 0; j < 8; j += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface CentralEntry {
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  name: string;
  localOffset: number;
}

function findEocd(buf: Buffer): number {
  // EOCD 位于文件末尾（注释最长 65535 字节）。
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new ZipError('非法 zip：找不到中央目录结尾');
}

function readCentralEntries(buf: Buffer): CentralEntry[] {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipError('不支持 ZIP64 包');
  }
  if (cdOffset + cdSize > buf.length) throw new ZipError('非法 zip：中央目录越界');
  const entries: CentralEntry[] = [];
  let offset = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CENTRAL_SIG) {
      throw new ZipError('非法 zip：中央目录损坏');
    }
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const recordEnd = offset + 46 + nameLen + extraLen + commentLen;
    if (recordEnd > buf.length) throw new ZipError('非法 zip：中央目录越界');
    entries.push({
      method: buf.readUInt16LE(offset + 10),
      crc: buf.readUInt32LE(offset + 16),
      compressedSize: buf.readUInt32LE(offset + 20),
      uncompressedSize: buf.readUInt32LE(offset + 24),
      name: buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8'),
      localOffset: buf.readUInt32LE(offset + 42),
    });
    offset = recordEnd;
  }
  return entries;
}

/**
 * 从 zip 字节中按精确名读取单条目（如 'word/document.xml'）。
 * 任何结构损坏、不支持的压缩方式、CRC 不匹配都抛 ZipError（fail closed，不崩溃）。
 */
export function readZipEntry(buf: Buffer, wanted: string, maxBytes = 64 * 1024 * 1024): Buffer {
  const entry = readCentralEntries(buf).find((e) => e.name === wanted);
  if (!entry) throw new ZipError(`zip 中缺少 ${wanted}`, 'DOCX_ENTRY_NOT_FOUND');
  if (entry.uncompressedSize > maxBytes) throw new ZipError('zip 条目过大', 'DOCX_ENTRY_TOO_LARGE');
  const { localOffset } = entry;
  if (
    localOffset < 0 ||
    localOffset + 30 > buf.length ||
    buf.readUInt32LE(localOffset) !== LOCAL_SIG
  ) {
    throw new ZipError('非法 zip：本地文件头损坏');
  }
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataStart > buf.length || dataEnd > buf.length) throw new ZipError('非法 zip：条目数据越界');
  const raw = buf.subarray(dataStart, dataEnd);
  let data: Buffer;
  if (entry.method === 0) data = raw;
  else if (entry.method === 8) {
    try {
      data = inflateRawSync(raw);
    } catch (e) {
      throw new ZipError(`zip 解压失败: ${(e as Error).message}`);
    }
  } else {
    throw new ZipError(`不支持的压缩方式: ${entry.method}`, 'DOCX_UNSUPPORTED_COMPRESSION');
  }
  if (data.length > maxBytes || data.length !== entry.uncompressedSize) {
    throw new ZipError('zip 条目大小校验失败');
  }
  if (crc32(data) !== entry.crc) throw new ZipError('zip 条目 CRC 校验失败');
  return data;
}

export interface ZipFileInput {
  name: string;
  data: Buffer;
}

/** 构造最小合法 zip（全部条目 deflate + UTF-8 名 + 正确 CRC32 + 中央目录）。 */
export function buildZip(files: ZipFileInput[]): Buffer {
  if (files.length === 0 || files.length > 0xffff) {
    throw new ZipError('zip 文件列表无效', 'DOCX_ZIP_WRITE_FAILED');
  }
  const dosTime = 0;
  // 固定 DOS 日期 2020-01-01（内容哈希稳定，避免写入当前时间导致产物不确定）。
  const dosDate = ((2020 - 1980) << 9) | (1 << 5) | 1;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const compressed = deflateRawSync(file.data);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 文件名
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    locals.push(Buffer.concat([local, name, compressed]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += local.length + name.length + compressed.length;
  }
  const body = Buffer.concat(locals);
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, centralDir, eocd]);
}
