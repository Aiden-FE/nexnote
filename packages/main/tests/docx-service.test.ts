import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DocxService } from '../src/docx/docx-service';
import { markdownToDocx } from '../src/docx/docx-writer';
import { MetadataStore } from '../src/document/metadata-store';
import { VaultFsService } from '../src/fs/fs-service';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'nexnote-docx-'));
  roots.push(root);
  const fs = new VaultFsService(() => root);
  return { root, fs, service: new DocxService(fs, () => root) };
}

describe('DocxService', () => {
  it('导入→编辑副本→导出，原件字节 sha256 保持不变', async () => {
    const { root, fs, service } = await setup();
    const externalRoot = await mkdtemp(path.join(tmpdir(), 'nexnote-docx-external-'));
    roots.push(externalRoot);
    const source = path.join(externalRoot, 'outside.docx');
    const original = markdownToDocx('# 原件\n\n正文');
    await writeFile(source, original);
    const imported = await service.importDocx(
      { base64: (await readFile(source)).toString('base64'), name: 'source.docx' },
      '',
    );
    const originalHash = createHash('sha256')
      .update(await readFile(path.join(root, imported.path)))
      .digest('hex');
    expect(imported.sha256).toBe(originalHash);
    expect(await new MetadataStore(root).read(imported.path)).toEqual({
      format: 'docx',
      sourceSha256: originalHash,
    });

    const copy = await service.createEditCopy(imported.path);
    expect(copy).toMatchObject({ path: 'source (副本).md', created: true });
    await fs.writeTextFile(copy.path, '# 修改后\n\n- 新项目');
    const exported = await service.exportDocx(copy.path);
    expect(exported.path).toMatch(/\.docx$/);
    expect(exported.path).not.toBe(imported.path);
    expect(
      createHash('sha256')
        .update(await readFile(path.join(root, imported.path)))
        .digest('hex'),
    ).toBe(originalHash);
    expect((await service.readPreview(exported.path)).markdown).toContain('# 修改后');
    expect(await new MetadataStore(root).read(copy.path)).toMatchObject({
      format: 'native-block',
      sourceDocx: imported.path,
      sourceSha256: originalHash,
    });
  });

  it('坏 zip、坏 XML、坏 base64 明确报错，越权路径被拒绝', async () => {
    const { root, service } = await setup();
    const badZip = path.join(root, 'bad.docx');
    await writeFile(badZip, Buffer.from('not a zip'));
    await expect(
      service.importDocx(
        { base64: (await readFile(badZip)).toString('base64'), name: 'bad.docx' },
        '',
      ),
    ).rejects.toMatchObject({
      code: 'DOCX_INVALID_ZIP',
    });
    const badXml = path.join(root, 'bad-xml.docx');
    await writeFile(badXml, markdownToDocx('ok').subarray(0, -5));
    await expect(
      service.importDocx(
        { base64: (await readFile(badXml)).toString('base64'), name: 'bad-xml.docx' },
        '',
      ),
    ).rejects.toBeInstanceOf(Error);
    await expect(service.importDocx({ base64: 'not!!base64' }, '')).rejects.toMatchObject({
      code: 'DOCX_IMPORT_SOURCE',
    });
    await expect(service.importDocx({}, '')).rejects.toMatchObject({ code: 'DOCX_IMPORT_SOURCE' });
    await expect(service.readPreview('../outside.docx')).rejects.toMatchObject({
      code: 'OUTSIDE_VAULT',
    });
    await expect(service.exportDocx('../outside.md')).rejects.toMatchObject({
      code: 'OUTSIDE_VAULT',
    });
  });
});
