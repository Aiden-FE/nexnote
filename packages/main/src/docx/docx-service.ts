import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { VaultFsService } from '../fs/fs-service';
import { formatForPath } from '../document/document-domain';
import { MetadataStore } from '../document/metadata-store';
import { projectDocxToMarkdown } from './docx-markdown';
import { markdownToDocx } from './docx-writer';

export interface DocxImportInput {
  /** renderer 已持有字节时走 base64（外部路径一律经主进程 dialogs.pickFile 后转 base64）。 */
  base64?: string;
  /** base64 模式下的文件名（缺省「导入文档.docx」）。 */
  name?: string;
}

/** 单个导入 DOCX 的字节上限（防 renderer 借导入通道搬运超大任意文件）。 */
export const MAX_DOCX_BYTES = 200 * 1024 * 1024;

/**
 * DOCX 领域服务（DEV-098 撤销仓库内编辑后收窄）：
 * - 导入即转换：外部 .docx → `.md` 块文档（Markdown 投影），vault 内不落 .docx 字节；
 * - 导出：Markdown → 新 .docx（导出目标已存在时拒绝，不覆写既有文件）。
 * 仓库内 docx 编辑（readPreview / createEditCopy / openEdit / save）已删除。
 */
export class DocxService {
  constructor(
    private readonly fs: VaultFsService,
    private readonly getRoot: () => string | null,
  ) {}

  private requireRoot(): string {
    const root = this.getRoot();
    if (!root) throw new DocxServiceError('当前未打开知识库', 'NO_VAULT');
    return root;
  }

  /**
   * 导入 .docx（base64）并转换为块文档：fail-closed 校验后经 projectDocxToMarkdown 投影，
   * 产物为 `<stem>.md`（同名去重：`论文.md`、`论文 2.md`…），sidecar 记录
   * {format:'native-block', sourceDocx, sourceSha256} 以便溯源。Word 专属排版不保留。
   */
  async importDocx(input: DocxImportInput, targetDir: string): Promise<{ path: string }> {
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
    const base =
      path.basename(raw).length > 0 ? path.basename(raw).replace(/\.docx$/i, '') : '导入文档';
    // fail-closed 预检：损坏 / 加密文件在此即被拒绝，不产生半截 .md。
    const markdown = projectDocxToMarkdown(bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    let relPath = targetDir ? `${targetDir}/${base}.md` : `${base}.md`;
    let n = 1;
    while (await this.fs.exists(relPath)) {
      n += 1;
      const candidate = `${base} ${n}.md`;
      relPath = targetDir ? `${targetDir}/${candidate}` : candidate;
    }
    const result = await this.fs.createTextFile(relPath, `${markdown}\n`, true);
    if (!result.created) {
      throw new DocxServiceError(`写入块文档失败: ${relPath}`, 'DOCX_IMPORT_WRITE');
    }
    await new MetadataStore(root).write(relPath, {
      format: 'native-block',
      sourceDocx: path.basename(raw).length > 0 ? path.basename(raw) : '导入文档.docx',
      sourceSha256: sha256,
    });
    return { path: relPath };
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
