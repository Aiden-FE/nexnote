import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { VaultFsService } from '../fs/fs-service';
import { formatForPath } from '../document/document-domain';
import { MetadataStore } from '../document/metadata-store';
import { projectDocxToMarkdown } from './docx-markdown';
import { markdownToDocx } from './docx-writer';
import { rebuildZip } from './zip';
import {
  serializeEditDocument,
  openEditDocument,
  editDocumentFromXml,
  type EditDocument,
} from './docx-edit';

export interface DocxImportInput {
  /** renderer 已持有字节时走 base64（外部路径一律经主进程 dialogs.pickFile 后转 base64）。 */
  base64?: string;
  /** base64 模式下的文件名（缺省「导入文档.docx」）。 */
  name?: string;
}

/** 单个导入 DOCX 的字节上限（防 renderer 借导入通道搬运超大任意文件）。 */
export const MAX_DOCX_BYTES = 200 * 1024 * 1024;

export interface DocxPreview {
  markdown: string;
  sha256: string;
}

export interface DocxEditCopy {
  path: string;
  created: boolean;
}

export interface OpenEditDocument {
  document: EditDocument;
  sha256: string;
}

/**
 * DOCX 领域服务（阶段6）：原件只读 + native-block 副本编辑 + 导出新 DOCX。
 * 硬约束：绝不写原 .docx（外部兼容性），导出绝不覆盖已有文件。
 */
export class DocxService {
  constructor(
    private readonly fs: VaultFsService,
    private readonly getRoot: () => string | null,
  ) {}

  private requireRoot(): string {
    const root = this.getRoot();
    if (!root) throw new DocxServiceError('当前未打开 vault', 'NO_VAULT');
    return root;
  }

  /** 读 vault 内 .docx 字节（沙箱校验由 fs.resolve 保证）。 */
  private async readDocxBytes(relPath: string): Promise<Buffer> {
    if (formatForPath(relPath) !== 'docx') {
      throw new DocxServiceError(`不是 DOCX 文档: ${relPath}`, 'DOCX_NOT_DOCX');
    }
    const { abs } = await this.fs.resolve(relPath);
    try {
      return await fsp.readFile(abs);
    } catch (e) {
      throw new DocxServiceError(
        `读取 DOCX 失败: ${relPath}（${(e as Error).message}）`,
        'READ_FAILED',
      );
    }
  }

  /** 导入 .docx（base64）：先验证可解析，再经 fs 导入策略落盘 + 写 sidecar。 */
  async importDocx(
    input: DocxImportInput,
    targetDir: string,
  ): Promise<{ path: string; sha256: string }> {
    const root = this.requireRoot();
    if (!input.base64) {
      throw new DocxServiceError('必须提供 DOCX base64 数据', 'DOCX_IMPORT_SOURCE');
    }
    const encoded = input.base64;
    if (
      encoded.length > Math.ceil((MAX_DOCX_BYTES * 4) / 3) + 4 ||
      encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
    ) {
      throw new DocxServiceError('DOCX base64 无效', 'DOCX_IMPORT_SOURCE');
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(encoded, 'base64');
    } catch {
      throw new DocxServiceError('DOCX base64 无效', 'DOCX_IMPORT_SOURCE');
    }
    if (bytes.length === 0) throw new DocxServiceError('DOCX 内容为空', 'DOCX_INVALID_ZIP');
    if (bytes.length > MAX_DOCX_BYTES) {
      throw new DocxServiceError('DOCX 文件过大', 'DOCX_TOO_LARGE');
    }
    const raw = (input.name ?? '导入文档.docx').trim();
    let name = path.basename(raw).length > 0 ? path.basename(raw) : '导入文档.docx';
    if (!name.toLowerCase().endsWith('.docx')) name = `${name}.docx`;
    /*
     * base64 由 IPC validator 做语法校验；这里再次校验是为了保证直接调用领域服务时
     * 也不会静默接受 Node Buffer.from 会忽略的非法字符。
     */
    projectDocxToMarkdown(bytes);
    const relPath = targetDir ? `${targetDir}/${name}` : name;
    const written = await this.fs.importBinaryFile(relPath, bytes, { createParentDirs: true });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await new MetadataStore(root).write(written, { format: 'docx', sourceSha256: sha256 });
    return { path: written, sha256 };
  }

  /** 只读预览：返回 Markdown 投影与原件字节 sha256。 */
  async readPreview(relPath: string): Promise<DocxPreview> {
    const bytes = await this.readDocxBytes(relPath);
    return {
      markdown: projectDocxToMarkdown(bytes),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  /** 打开原生可编辑模型，并携带打开时的字节哈希作为乐观锁版本。 */
  async openEditDocument(relPath: string): Promise<OpenEditDocument> {
    const bytes = await this.readDocxBytes(relPath);
    return {
      document: openEditDocument(bytes),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  /** 仅替换 word/document.xml；expectedSha256 不匹配时绝不覆盖原件。 */
  async saveDocx(
    relPath: string,
    document: EditDocument,
    expectedSha256: string,
  ): Promise<{ sha256: string; document: EditDocument }> {
    const current = await this.readDocxBytes(relPath);
    const actual = createHash('sha256').update(current).digest('hex');
    if (actual !== expectedSha256)
      throw new DocxServiceError('DOCX 原件已被外部修改', 'DOCX_CONFLICT');
    const xml = serializeEditDocument(document);
    let bytes = current;
    if (xml !== document.originalXml) {
      bytes = rebuildZip(current, {
        name: 'word/document.xml',
        data: Buffer.from(xml, 'utf8'),
      });
      const { abs } = await this.fs.resolve(relPath);
      const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
      try {
        await fsp.writeFile(tmp, bytes);
        await fsp.rename(tmp, abs);
      } finally {
        await fsp.rm(tmp, { force: true }).catch(() => undefined);
      }
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    // Refresh both direct callers and the IPC response to the exact post-save XML.
    // IPC structured cloning means mutating only this process's input is insufficient.
    const refreshed = editDocumentFromXml(xml);
    Object.assign(document, refreshed);
    return { sha256, document: refreshed };
  }

  /**
   * 在原文档同目录创建 `<stem> (副本).md`（幂等：副本已存在时返回既有路径）。
   * 副本 sidecar 记录 {format:'native-block', sourceDocx, sourceSha256}；原 .docx 不动。
   */
  async createEditCopy(relPath: string): Promise<DocxEditCopy> {
    const root = this.requireRoot();
    const preview = await this.readPreview(relPath);
    const dir = path.posix.dirname(relPath);
    const stem = path.posix.basename(relPath, path.posix.extname(relPath));
    const copyRel = dir === '.' ? `${stem} (副本).md` : `${dir}/${stem} (副本).md`;
    const existing = await this.fs.exists(copyRel);
    if (!existing) {
      const result = await this.fs.createTextFile(copyRel, `${preview.markdown}\n`, true);
      if (result.created) {
        await new MetadataStore(root).write(copyRel, {
          format: 'native-block',
          sourceDocx: relPath,
          sourceSha256: preview.sha256,
        });
        return { path: copyRel, created: true };
      }
    }
    return { path: copyRel, created: false };
  }

  /**
   * 导出 .md 为新 .docx：默认写同目录 `<stem>.docx`（重名自动去抖），或显式 targetPath
   * （已存在则拒绝）。绝不覆盖任何已有文件，也绝不写回源 .md。
   */
  async exportDocx(relPath: string, targetPath?: string): Promise<{ path: string }> {
    const root = this.requireRoot();
    const format = formatForPath(relPath);
    if (format !== 'markdown') {
      throw new DocxServiceError(`导出源必须是 Markdown: ${relPath}`, 'DOCX_EXPORT_SOURCE');
    }
    const markdown = await this.fs.readTextFile(relPath);
    const bytes = markdownToDocx(markdown);
    const dir = path.posix.dirname(relPath);
    const stem = path.posix.basename(relPath, path.posix.extname(relPath));
    if (targetPath !== undefined) {
      if (formatForPath(targetPath) !== 'docx') {
        throw new DocxServiceError('导出目标必须是 .docx', 'DOCX_EXPORT_TARGET');
      }
      if (targetPath !== relPath && (await this.fs.exists(targetPath))) {
        throw new DocxServiceError(`目标已存在: ${targetPath}`, 'TARGET_EXISTS');
      }
      const written = await this.fs.importBinaryFile(targetPath, bytes, { createParentDirs: true });
      return { path: written };
    }
    const defaultTarget = dir === '.' ? `${stem}.docx` : `${dir}/${stem}.docx`;
    // fs.importBinaryFile 的去抖策略保证绝不覆盖（`name.docx`、`name 2.docx`…）。
    const written = await this.fs.importBinaryFile(defaultTarget, bytes, {
      createParentDirs: true,
    });
    await new MetadataStore(root).write(written, {
      format: 'docx',
      exportedFrom: relPath,
    });
    return { path: written };
  }
}

export class DocxServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'DocxServiceError';
  }
}
