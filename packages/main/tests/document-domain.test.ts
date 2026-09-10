import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentService } from '../src/document/document-service';
import { MetadataStore } from '../src/document/metadata-store';
import { documentRef, formatForPath, metadataPathFor } from '../src/document/document-domain';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function root() {
  const value = await mkdtemp(path.join(tmpdir(), 'nexnote-document-'));
  roots.push(value);
  return value;
}

describe('document domain', () => {
  it('detects supported formats and keeps metadata in a sidecar', async () => {
    const vault = await root();
    expect(formatForPath('Notes/readme.md')).toBe('markdown');
    expect(formatForPath('Notes/readme.markdown')).toBe('markdown');
    expect(formatForPath('Files/report.docx')).toBe('docx');
    expect(formatForPath('Files/report.pdf')).toBeNull();
    const ref = documentRef(vault, 'Notes/readme.md');
    expect(ref.metadataPath).toBe(metadataPathFor(vault, 'Notes/readme.md'));

    const service = new DocumentService(vault);
    const payload = await service.write(ref.path, '# Hello\n', { id: 'stable-1', confidence: 0.8 });
    expect(payload.text).toBe('# Hello\n');
    expect(payload.metadata).toEqual({ id: 'stable-1', confidence: 0.8 });
    expect(await readFile(path.join(vault, 'Notes/readme.md'), 'utf8')).toBe('# Hello\n');
    expect(await readFile(ref.metadataPath, 'utf8')).toContain('stable-1');
  });

  it('renames the document and its sidecar together', async () => {
    const vault = await root();
    const service = new DocumentService(vault);
    await service.write('old.md', 'body', { id: 'stable-2' });
    await service.rename('old.md', 'new.md');
    expect(await readFile(path.join(vault, 'new.md'), 'utf8')).toBe('body');
    await expect(service.read('new.md')).resolves.toMatchObject({ metadata: { id: 'stable-2' } });
    await expect(stat(metadataPathFor(vault, 'old.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects direct writes to docx while allowing sidecar metadata', async () => {
    const vault = await root();
    const service = new DocumentService(vault);
    await expect(service.write('report.docx', 'not docx')).rejects.toThrow('不可直接写入');
    const metadata = new MetadataStore(vault);
    await metadata.write('report.docx', { id: 'docx-1' });
    await expect(metadata.read('report.docx')).resolves.toEqual({ id: 'docx-1' });
  });

  it('cascades sidecar rename and cleanup for directory moves and deletes', async () => {
    const vault = await root();
    const metadata = new MetadataStore(vault);
    await metadata.write('docs/a.md', { id: 'a' });
    await metadata.write('docs/sub/b.md', { id: 'b' });
    await metadata.write('outside.md', { id: 'outside' });

    await metadata.renameUnder('docs', 'archive');
    await expect(metadata.read('docs/a.md')).resolves.toBeNull();
    await expect(metadata.read('archive/a.md')).resolves.toEqual({ id: 'a' });
    await expect(metadata.read('archive/sub/b.md')).resolves.toEqual({ id: 'b' });
    await expect(metadata.read('outside.md')).resolves.toEqual({ id: 'outside' });

    await metadata.removeUnder('archive');
    await expect(metadata.read('archive/a.md')).resolves.toBeNull();
    await expect(metadata.read('archive/sub/b.md')).resolves.toBeNull();
    await expect(metadata.read('outside.md')).resolves.toEqual({ id: 'outside' });
  });
});
