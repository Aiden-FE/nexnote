import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { DocumentMetadata } from './document-domain';
import { metadataPathFor } from './document-domain';

export class MetadataStore {
  constructor(private readonly root: string) {}

  private pathFor(documentPath: string): string {
    return metadataPathFor(this.root, documentPath);
  }

  async read(documentPath: string): Promise<DocumentMetadata | null> {
    try {
      const raw = await fsp.readFile(this.pathFor(documentPath), 'utf8');
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      return value as DocumentMetadata;
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return null;
      throw new Error(`读取文档 metadata 失败: ${documentPath}`);
    }
  }

  async write(documentPath: string, metadata: DocumentMetadata): Promise<void> {
    const target = this.pathFor(documentPath);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.tmp-${process.pid}-${createHash('sha256')
      .update(`${Date.now()}-${Math.random()}`)
      .digest('hex')
      .slice(0, 16)}`;
    try {
      await fsp.writeFile(temp, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
      await fsp.rename(temp, target);
    } finally {
      await fsp.rm(temp, { force: true }).catch(() => undefined);
    }
  }

  async remove(documentPath: string): Promise<void> {
    await fsp.rm(this.pathFor(documentPath), { force: true });
  }

  async rename(fromPath: string, toPath: string): Promise<void> {
    const from = this.pathFor(fromPath);
    const to = this.pathFor(toPath);
    try {
      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.rename(from, to);
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
    }
  }
}
