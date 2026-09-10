import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import {
  DOCUMENT_CAPABILITIES,
  type DocumentMetadata,
  type DocumentPayload,
  type DocumentRef,
  documentRef,
  formatForPath,
  mergeDocumentMetadata,
} from './document-domain';
import { MetadataStore } from './metadata-store';

export class DocumentService {
  private readonly metadata: MetadataStore;

  constructor(private readonly root: string) {
    this.metadata = new MetadataStore(root);
  }

  resolve(documentPath: string): DocumentRef {
    return documentRef(this.root, documentPath);
  }

  async read(documentPath: string): Promise<DocumentPayload> {
    const ref = this.resolve(documentPath);
    const absolute = this.absolute(ref.path);
    const bytes = await fsp.readFile(absolute);
    const sidecar = await this.metadata.read(ref.path);
    return {
      ref,
      text: ref.format === 'docx' ? '' : bytes.toString('utf8'),
      metadata: mergeDocumentMetadata({}, sidecar),
      revision: await this.revision(bytes, absolute),
    };
  }

  async write(
    documentPath: string,
    text: string,
    metadata?: DocumentMetadata,
  ): Promise<DocumentPayload> {
    const ref = this.resolve(documentPath);
    if (!DOCUMENT_CAPABILITIES[ref.format].write) {
      throw new Error(`文档格式不可直接写入: ${ref.format}`);
    }
    const absolute = this.absolute(ref.path);
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    const temp = `${absolute}.tmp-${process.pid}-${Date.now()}`;
    try {
      await fsp.writeFile(temp, text, 'utf8');
      await fsp.rename(temp, absolute);
    } finally {
      await fsp.rm(temp, { force: true }).catch(() => undefined);
    }
    if (metadata) await this.metadata.write(ref.path, metadata);
    return this.read(ref.path);
  }

  async writeMetadata(documentPath: string, metadata: DocumentMetadata): Promise<void> {
    this.resolve(documentPath);
    await this.metadata.write(documentPath, metadata);
  }

  async rename(fromPath: string, toPath: string): Promise<DocumentRef> {
    const from = this.resolve(fromPath);
    const to = this.resolve(toPath);
    await fsp.rename(this.absolute(from.path), this.absolute(to.path));
    await this.metadata.rename(from.path, to.path);
    return to;
  }

  private absolute(documentPath: string): string {
    const absolute = path.resolve(this.root, documentPath);
    const relative = path.relative(this.root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('文档路径越出 vault');
    return absolute;
  }

  private async revision(bytes: Buffer, absolute: string) {
    const stats = await fsp.stat(absolute);
    return {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
}

export { formatForPath };
