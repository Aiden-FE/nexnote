import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { BinaryKind, BinaryReadResult } from '@nexnote/shared';
import type { VaultFsService } from '../fs/fs-service';
import { formatForPath } from '../document/document-domain';
import { MetadataStore } from '../document/metadata-store';
import { parseXlsxToModel, writeModelToXlsx } from './xlsx-convert';
import { parseXmindToModel, writeModelToXmind } from './xmind-convert';
import { preserveXlsxReadonly, preserveXmindReadonly } from './zip-preserve';
import { XlsxError } from './xlsx-convert';
import { XmindError } from './xmind-convert';

/**
 * 二进制文档领域服务（DEV-074，ADR-0015；DEV-098 撤销 docx 后仅 xlsx / xmind）：
 * xlsx / xmind 的仓库内副本导入（fail-closed）、读取为语义模型、保存回写。
 * - 外部路径不接受 renderer 提供；字节一律经 base64 进入。
 * - 副本可原地覆写（撤销阶段6「原件只读」硬约束），随 Git 版本化。
 */

export const MAX_BINARY_BYTES = 200 * 1024 * 1024;

const EXT_BY_KIND: Record<BinaryKind, string> = {
  xlsx: '.xlsx',
  mindmap: '.xmind',
};

export class BinaryServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'BinaryServiceError';
  }
}

export class BinaryService {
  constructor(
    private readonly fs: VaultFsService,
    private readonly getRoot: () => string | null,
  ) {}

  private requireRoot(): string {
    const root = this.getRoot();
    if (!root) throw new BinaryServiceError('当前未打开知识库', 'NO_VAULT');
    return root;
  }

  private async readBytes(relPath: string, kind: BinaryKind): Promise<Buffer> {
    if (formatForPath(relPath) !== kind) {
      throw new BinaryServiceError(`不是 ${kind} 文档: ${relPath}`, 'BINARY_NOT_MATCH');
    }
    const { abs } = await this.fs.resolve(relPath);
    try {
      return await fsp.readFile(abs);
    } catch (e) {
      throw new BinaryServiceError(
        `读取失败: ${relPath}（${(e as Error).message}）`,
        'READ_FAILED',
      );
    }
  }

  /** 统一导入入口（base64）：fail-closed 校验 → 落盘 vault 副本 → sidecar 元数据。 */
  async importBinary(
    kind: BinaryKind,
    input: { base64?: string; name?: string },
    targetDir: string,
  ): Promise<{ path: string; sha256: string }> {
    const root = this.requireRoot();
    if (!input.base64) {
      throw new BinaryServiceError('必须提供 base64 数据', 'BINARY_IMPORT_SOURCE');
    }
    const encoded = input.base64;
    if (
      encoded.length > Math.ceil((MAX_BINARY_BYTES * 4) / 3) + 4 ||
      encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
    ) {
      throw new BinaryServiceError('base64 无效', 'BINARY_IMPORT_SOURCE');
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(encoded, 'base64');
    } catch {
      throw new BinaryServiceError('base64 无效', 'BINARY_IMPORT_SOURCE');
    }
    if (bytes.length === 0) throw new BinaryServiceError('内容为空', 'BINARY_EMPTY');
    if (bytes.length > MAX_BINARY_BYTES) {
      throw new BinaryServiceError('文件过大', 'BINARY_TOO_LARGE');
    }
    // fail-closed 预检：损坏 / 加密文件在此即被拒绝（与 docx 导入同一策略）。
    await this.probe(kind, bytes);
    const ext = EXT_BY_KIND[kind];
    const raw = (input.name ?? `导入文档${ext}`).trim();
    let name = path.basename(raw).length > 0 ? path.basename(raw) : `导入文档${ext}`;
    if (!name.toLowerCase().endsWith(ext)) name = `${name}${ext}`;
    const relPath = targetDir ? `${targetDir}/${name}` : name;
    const written = await this.fs.importBinaryFile(relPath, bytes, { createParentDirs: true });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await new MetadataStore(root).write(written, { format: kind, sourceSha256: sha256 });
    return { path: written, sha256 };
  }

  /**
   * DEV-084（DEV-098 撤销 docx 后仅 xlsx / xmind）：
   * - xlsx：生成单 sheet 空工作簿（与 cel 表完全对应）。
   * - xmind：生成单根节点思维导图。
   * - 命名沿用 nextUntitledName 模式（page-ops 内部生成 "未命名 N"），目标目录可空。
   */
  async createBinary(
    kind: BinaryKind,
    opts: { title?: string; targetDir?: string } = {},
  ): Promise<{ path: string; sha256: string }> {
    const root = this.requireRoot();
    const title = opts.title ?? '未命名';
    const baseName = sanitizeBaseName(title);
    const ext = EXT_BY_KIND[kind];
    const name = baseName.endsWith(ext) ? baseName : `${baseName}${ext}`;
    const targetDir = opts.targetDir ?? '';
    let relPath = targetDir ? `${targetDir}/${name}` : name;
    let n = 1;
    while (await this.fs.exists(relPath)) {
      n += 1;
      const stem = baseName.endsWith(ext) ? baseName.slice(0, -ext.length) : baseName;
      const candidate = `${stem} ${n}${ext}`;
      relPath = targetDir ? `${targetDir}/${candidate}` : candidate;
    }

    const bytes = await renderEmptyBinary(kind, title);
    const written = await this.fs.importBinaryFile(relPath, bytes, { createParentDirs: true });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await new MetadataStore(root).write(written, { format: kind, sourceSha256: sha256 });
    return { path: written, sha256 };
  }

  /** fail-closed 预检（不抛业务错误语义，抛原始转换错误供上层归类）。 */
  private async probe(kind: BinaryKind, bytes: Buffer): Promise<void> {
    if (kind === 'xlsx') {
      parseXlsxToModel(bytes); // 同步；任何损坏抛 XlsxError
      return;
    }
    await parseXmindToModel(bytes); // 异步
  }

  /** 读取 vault 内副本为语义模型。 */
  async read(kind: BinaryKind, relPath: string): Promise<BinaryReadResult> {
    const bytes = await this.readBytes(relPath, kind);
    if (kind === 'xlsx') {
      const { sheets, readonly } = parseXlsxToModel(bytes);
      return {
        data: { kind, sheets },
        sha256: createHash('sha256').update(bytes).digest('hex'),
        readonly,
      };
    }
    const { model, readonly } = await parseXmindToModel(bytes);
    return {
      data: { kind, model },
      sha256: createHash('sha256').update(bytes).digest('hex'),
      readonly,
    };
  }

  /** 保存语义模型回 vault 副本（原地覆写 + expectedSha256 乐观锁）。 */
  async save(
    kind: BinaryKind,
    relPath: string,
    data: unknown,
    expectedSha256: string,
  ): Promise<{ sha256: string }> {
    const current = await this.readBytes(relPath, kind);
    const actual = createHash('sha256').update(current).digest('hex');
    if (actual !== expectedSha256) {
      throw new BinaryServiceError('副本已被外部修改', 'BINARY_CONFLICT');
    }
    let bytes: Buffer;
    if (kind === 'xlsx') {
      const model = (data as { sheets?: unknown[] }) ?? {};
      const rebuilt = await writeModelToXlsx({ sheets: Array.isArray(model.sheets) ? model.sheets : [] });
      // ADR-0015 Decision 4：模型未涵盖的宏、图表、透视表及其关系/类型声明从原包回填。
      bytes = await preserveXlsxReadonly(current, rebuilt);
    } else {
      const model = (data as { model?: Parameters<typeof writeModelToXmind>[0] })?.model;
      if (!model) throw new BinaryServiceError('xmind 数据缺失', 'BINARY_INVALID_DATA');
      const rebuilt = await writeModelToXmind(model, path.basename(relPath, EXT_BY_KIND[kind]));
      // ADR-0015 Decision 4：恢复模型未涵盖的主题资源、外框/关联线等原始 archive entries。
      bytes = await preserveXmindReadonly(current, rebuilt);
    }
    const { abs } = await this.fs.resolve(relPath);
    await atomicWrite(abs, bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return { sha256 };
  }
}

/** tmp + rename 的原子写盘（两个 save 路径共用，避免半成品文件被读到）。 */
async function atomicWrite(abs: string, bytes: Buffer): Promise<void> {
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await fsp.writeFile(tmp, bytes);
    await fsp.rename(tmp, abs);
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
  }
}

/** 简单文件名清洗（去除路径分隔符与控制字符；不与 fs-service.sanitizeEntryName 重复避免循环依赖）。 */
function sanitizeBaseName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '未命名';
  // eslint-disable-next-line no-control-regex -- 主动清理控制字符
  return trimmed.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 80);
}

/** DEV-084：生成空白 xlsx / xmind 字节。 */
async function renderEmptyBinary(kind: BinaryKind, title: string): Promise<Buffer> {
  if (kind === 'xlsx') {
    return writeModelToXlsx({
      sheets: [{ name: 'Sheet1', celldata: [], config: {} }],
    });
  }
  // xmind
  return writeModelToXmind({ data: { text: title }, children: [] }, title);
}

export { XlsxError, XmindError };
