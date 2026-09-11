import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DocxService } from '../src/docx/docx-service';
import { editParagraph, serializeEditDocument } from '../src/docx/docx-edit';
import { buildZip } from '../src/docx/zip';
import { DocumentService } from '../src/document/document-service';
import { VaultFsService } from '../src/fs/fs-service';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'nexnote-docx-edit-'));
  roots.push(root);
  const fs = new VaultFsService(() => root);
  return { root, fs, service: new DocxService(fs, () => root) };
}

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** 构造含 styles/media/headers 等多部件的 DOCX（部件顺序刻意不同于只写 document 的包）。 */
function multiPartDocx(documentXml: string): Buffer {
  return buildZip([
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types/>', 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
    {
      name: 'word/styles.xml',
      data: Buffer.from('<?xml version="1.0"?><styles>keep</styles>', 'utf8'),
    },
    { name: 'word/media/image1.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
    { name: 'word/header1.xml', data: Buffer.from('<?xml version="1.0"?><hdr/>', 'utf8') },
  ]);
}

const SAMPLE_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p><w:p><w:r><w:t>正文段落</w:t></w:r></w:p></w:body></w:document>';

describe('DOCX native round-trip', () => {
  it('打开→不编辑→保存：document.xml 与其他部件字节全部不变', async () => {
    const { root, fs, service } = await setup();
    await fs.importBinaryFile('a.docx', multiPartDocx(SAMPLE_XML));
    const opened = await service.openEditDocument('a.docx');
    expect(opened.document.paragraphs).toHaveLength(2);
    expect(opened.document.paragraphs[0]).toMatchObject({
      heading: 1,
      text: '标题',
      editable: true,
    });
    expect(opened.document.unsupportedCount).toBe(0);
    // 未编辑直接序列化 → XML 原样
    expect(serializeEditDocument(opened.document)).toBe(opened.document.originalXml);
    const saved = await service.saveDocx('a.docx', opened.document, opened.sha256);
    expect(saved.sha256).toBe(opened.sha256);
    expect(hash(await readFile(path.join(root, 'a.docx')))).toBe(opened.sha256);
  });

  it('修改段落后保存：document.xml 更新，styles/media/headers 字节不变', async () => {
    const { root, fs, service } = await setup();
    const original = multiPartDocx(SAMPLE_XML);
    await fs.importBinaryFile('a.docx', original);
    const before = await readFile(path.join(root, 'a.docx'));
    const opened = await service.openEditDocument('a.docx');
    editParagraph(opened.document, 1, { text: '修改后的段落' });
    const saved = await service.saveDocx('a.docx', opened.document, opened.sha256);
    const after = await readFile(path.join(root, 'a.docx'));
    expect(hash(after)).toBe(saved.sha256);
    expect(after.equals(before)).toBe(false);
    // 逐部件对比：除 document.xml 外全部原样
    const { readZipEntries } = await import('../src/docx/zip');
    const beforeEntries = new Map(readZipEntries(before).map((e) => [e.name, e.localBytes]));
    for (const entry of readZipEntries(after)) {
      if (entry.name === 'word/document.xml') {
        expect(entry.localBytes.equals(beforeEntries.get(entry.name)!)).toBe(false);
      } else {
        expect(entry.localBytes.equals(beforeEntries.get(entry.name)!)).toBe(true);
      }
    }
    const reopened = await service.openEditDocument('a.docx');
    expect(reopened.document.paragraphs[1]).toMatchObject({ text: '修改后的段落' });
    expect(reopened.document.paragraphs[0]).toMatchObject({ text: '标题', heading: 1 });
  });

  it('外部修改后保存：返回 DOCX_CONFLICT 且不覆盖原件', async () => {
    const { root, fs, service } = await setup();
    await fs.importBinaryFile('a.docx', multiPartDocx(SAMPLE_XML));
    const opened = await service.openEditDocument('a.docx');
    editParagraph(opened.document, 0, { text: '新标题' });
    // 外部改动（模拟另一个编辑器保存）
    await fs.importBinaryFile('a.docx', multiPartDocx(SAMPLE_XML.replace('正文段落', '外部改动')), {
      overwrite: true,
    });
    await expect(service.saveDocx('a.docx', opened.document, opened.sha256)).rejects.toMatchObject({
      code: 'DOCX_CONFLICT',
    });
    const onDisk = await readFile(path.join(root, 'a.docx'));
    expect((await service.openEditDocument('a.docx')).document.paragraphs[1]!.text).toBe(
      '外部改动',
    );
    expect(hash(onDisk)).not.toBe(opened.sha256);
  });

  it('未支持块（表格/图片）保留原始 XML 且标记不可编辑', async () => {
    const { fs, service } = await setup();
    const xml = SAMPLE_XML.replace(
      '</w:body>',
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:drawing/></w:r></w:p></w:body>',
    );
    await fs.importBinaryFile('a.docx', multiPartDocx(xml));
    const opened = await service.openEditDocument('a.docx');
    expect(opened.document.unsupportedCount).toBeGreaterThanOrEqual(1);
    // 含表格的 body 顶层段落结构：普通段落 2 + 表格(不在段落模型) + drawing 段落 1
    const editable = opened.document.paragraphs.filter((p) => p.editable);
    expect(editable.map((p) => p.text)).toContain('标题');
    const saved = await service.saveDocx('a.docx', opened.document, opened.sha256);
    expect(saved.sha256).toBe(opened.sha256); // 未修改 → 字节不变，表格原样保留
  });

  it('重复段落只替换被编辑的实例', async () => {
    const { fs, service } = await setup();
    const duplicate = SAMPLE_XML.replace('标题', '段落一').replace('正文段落', '段落一');
    await fs.importBinaryFile('a.docx', multiPartDocx(duplicate));
    const opened = await service.openEditDocument('a.docx');
    editParagraph(opened.document, 1, { text: '只改第二段' });
    const xml = serializeEditDocument(opened.document);
    expect(xml).toContain('<w:t xml:space="preserve">只改第二段</w:t>');
    // 两段原 XML 相同：只有第二段被替换，第一段原样保留。
    expect(xml.match(/<w:t>段落一<\/w:t>/g)).toHaveLength(1);
  });

  it('坏 ZIP 或缺少 document.xml 时 fail closed', async () => {
    const { fs, service } = await setup();
    await fs.importBinaryFile('broken.docx', Buffer.from('not a zip'));
    await expect(service.openEditDocument('broken.docx')).rejects.toMatchObject({
      code: 'DOCX_INVALID_ZIP',
    });
    await fs.importBinaryFile(
      'missing.docx',
      buildZip([{ name: 'word/styles.xml', data: Buffer.from('<styles/>') }]),
    );
    await expect(service.openEditDocument('missing.docx')).rejects.toMatchObject({
      code: 'DOCX_ENTRY_NOT_FOUND',
    });
  });

  it('DocumentService.write 文本通道仍拒绝 DOCX，能力矩阵 write=false edit=true', async () => {
    const { root, fs } = await setup();
    await fs.importBinaryFile('a.docx', multiPartDocx(SAMPLE_XML));
    const documents = new DocumentService(root);
    await expect(documents.write('a.docx', 'text')).rejects.toThrow('文档格式不可直接写入');
    const { DOCUMENT_CAPABILITIES } = await import('../src/document/document-domain');
    expect(DOCUMENT_CAPABILITIES.docx).toMatchObject({ write: false, edit: true });
  });
});
