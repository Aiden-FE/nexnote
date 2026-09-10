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

  /** 列出 sidecar 目录中解码后以 dirPrefix 开头的文档路径 → sidecar 绝对路径。 */
  private async entriesUnder(
    dirPrefix: string,
  ): Promise<Array<{ documentPath: string; file: string }>> {
    const dir = path.join(this.root, '.nexnote', 'metadata');
    let names: string[];
    try {
      names = await fsp.readdir(dir);
    } catch {
      return [];
    }
    const result: Array<{ documentPath: string; file: string }> = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const decoded = Buffer.from(name.slice(0, -'.json'.length), 'base64url').toString('utf8');
      if (decoded.startsWith(`${dirPrefix}/`))
        result.push({ documentPath: decoded, file: path.join(dir, name) });
    }
    return result;
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

  /** 目录重命名/移动：把 fromDir 下所有文档 sidecar 级联迁移到 toDir。 */
  async renameUnder(fromDir: string, toDir: string): Promise<void> {
    for (const entry of await this.entriesUnder(fromDir)) {
      const next = `${toDir}${entry.documentPath.slice(fromDir.length)}`;
      await fsp.mkdir(path.dirname(this.pathFor(next)), { recursive: true });
      await fsp.rename(entry.file, this.pathFor(next)).catch(() => undefined);
    }
  }

  /** 目录删除：清理 dir 下所有文档 sidecar。 */
  async removeUnder(dir: string): Promise<void> {
    for (const entry of await this.entriesUnder(dir)) {
      await fsp.rm(entry.file, { force: true }).catch(() => undefined);
    }
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
