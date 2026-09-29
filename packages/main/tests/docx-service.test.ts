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

/** DEV-098：docx 仅作为外部交换格式——导入即转 .md 块文档，导出产新 .docx。 */
describe('DocxService（DEV-098 撤销仓库内编辑）', () => {
  it('导入即转换为同名 .md 块文档，sidecar 记 sourceDocx；vault 内不落 .docx 字节', async () => {
    const { root, fs, service } = await setup();
    const externalRoot = await mkdtemp(path.join(tmpdir(), 'nexnote-docx-external-'));
    roots.push(externalRoot);
    const source = path.join(externalRoot, 'outside.docx');
    const original = markdownToDocx('# 原件\n\n正文');
    await writeFile(source, original);
    const sourceHash = createHash('sha256').update(original).digest('hex');

    const imported = await service.importDocx(
      { base64: (await readFile(source)).toString('base64'), name: '论文.docx' },
      '',
    );
    expect(imported.path).toBe('论文.md');
    const markdown = await fs.readTextFile(imported.path);
    expect(markdown).toContain('# 原件');
    expect(await fs.exists('论文.docx')).toBe(false);
    expect(await new MetadataStore(root).read(imported.path)).toEqual({
      format: 'native-block',
      sourceDocx: '论文.docx',
      sourceSha256: sourceHash,
    });
  });

  it('同名 .md 已存在时自动去重（论文 2.md），不覆盖既有文件', async () => {
    const { fs, service } = await setup();
    await fs.createTextFile('论文.md', '已有内容', true);
    const original = markdownToDocx('# 新导入');
    const second = await service.importDocx(
      { base64: original.toString('base64'), name: '论文.docx' },
      '',
    );
    expect(second.path).toBe('论文 2.md');
    expect(await fs.readTextFile('论文.md')).toBe('已有内容');
  });

  it('targetDir 下的导入落在指定目录', async () => {
    const { service } = await setup();
    const original = markdownToDocx('# 目录内');
    const imported = await service.importDocx(
      { base64: original.toString('base64'), name: '论文.docx' },
      'Personal',
    );
    expect(imported.path).toBe('Personal/论文.md');
  });

  it('导出 .md 为新 .docx（默认同目录去抖，不覆盖既有文件）', async () => {
    const { root, fs, service } = await setup();
    await fs.createTextFile('笔记.md', '# 修改后\n\n- 新项目', true);
    const exported = await service.exportDocx('笔记.md');
    expect(exported.path).toMatch(/笔记\.docx$/);
    expect(await fs.exists(exported.path)).toBe(true);
    expect(await new MetadataStore(root).read(exported.path)).toMatchObject({
      format: 'docx',
      exportedFrom: '笔记.md',
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
    await expect(service.exportDocx('../outside.md')).rejects.toMatchObject({
      code: 'OUTSIDE_VAULT',
    });
  });
});
