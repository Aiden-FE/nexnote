import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DocxService } from '../src/docx/docx-service';
import { editParagraph, paragraphsOf, serializeEditDocument } from '../src/docx/docx-edit';
import { buildZip, readZipEntries, readZipEntry, rebuildZip } from '../src/docx/zip';
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

import type { EditDocument } from '../src/docx/docx-edit';

/** 段落投影（不含表格块），等价 renderer 侧 paragraphsOf。 */
const paragraphs = (document: EditDocument) => paragraphsOf(document);

const SAMPLE_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p><w:p><w:r><w:t>正文段落</w:t></w:r></w:p></w:body></w:document>';

describe('DOCX native round-trip', () => {
  it('打开→不编辑→保存：document.xml 与其他部件字节全部不变', async () => {
    const { root, fs, service } = await setup();
    await fs.importBinaryFile('a.docx', multiPartDocx(SAMPLE_XML));
    const opened = await service.openEditDocument('a.docx');
    expect(paragraphs(opened.document)).toHaveLength(2);
    expect(paragraphs(opened.document)[0]).toMatchObject({
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
    expect(paragraphs(reopened.document)[1]).toMatchObject({ text: '修改后的段落' });
    expect(paragraphs(reopened.document)[0]).toMatchObject({ text: '标题', heading: 1 });
  });

  it('连续两次保存不同段落：刷新后的模型随响应返回，不丢前次编辑', async () => {
    const { root, fs, service } = await setup();
    const xml = SAMPLE_XML.replace(
      '</w:body>',
      '<w:p><w:r><w:t>第三段</w:t></w:r></w:p><w:p><w:r><w:t>第四段</w:t></w:r></w:p></w:body>',
    );
    await fs.importBinaryFile('a.docx', multiPartDocx(xml));
    // IPC 语义：renderer 每次保存后用响应中的 document 替换本地模型（structured clone 不会回传突变）。
    let model = (await service.openEditDocument('a.docx')).document;
    const openedSha = (await service.openEditDocument('a.docx')).sha256;
    const rendererEdit = (
      document: EditDocument,
      paragraphIndex: number,
      text: string,
    ): EditDocument => ({
      // 模拟 DocxView.updateParagraph：不可变更新，且仅目标段落带 modified。
      ...document,
      blocks: (() => {
        let i = 0;
        return document.blocks.map((block) => {
          if (block.type === 'table') return block;
          const currentIndex = i++;
          return currentIndex === paragraphIndex && block.editable
            ? { ...block, text, runs: [{ text }], modified: true }
            : { ...block, modified: undefined };
        });
      })(),
    });
    model = rendererEdit(model, 1, '第一次保存的段落');
    const first = await service.saveDocx('a.docx', structuredClone(model), openedSha);
    model = structuredClone(first.document);
    expect(paragraphs(model)[1]!.modified).toBeUndefined();
    model = rendererEdit(model, 2, '第二次保存的段落');
    const second = await service.saveDocx('a.docx', structuredClone(model), first.sha256);
    expect(paragraphs(second.document)[1]!.text).toBe('第一次保存的段落');
    expect(paragraphs(second.document)[2]!.text).toBe('第二次保存的段落');
    const savedXml = readZipEntry(
      await readFile(path.join(root, 'a.docx')),
      'word/document.xml',
    ).toString();
    expect(savedXml).toContain('<w:t>第一次保存的段落</w:t>');
    expect(savedXml).toContain('<w:t>第二次保存的段落</w:t>');
    expect(paragraphs((await service.openEditDocument('a.docx')).document)[1]!.text).toBe(
      '第一次保存的段落',
    );
  });

  it('连续两次保存使用刷新后的原始 XML', async () => {
    const { fs, service } = await setup();
    await fs.importBinaryFile('a.docx', multiPartDocx(SAMPLE_XML));
    const opened = await service.openEditDocument('a.docx');
    editParagraph(opened.document, 1, { text: '第一次' });
    const first = await service.saveDocx('a.docx', opened.document, opened.sha256);
    editParagraph(opened.document, 1, { text: '第二次' });
    const second = await service.saveDocx('a.docx', opened.document, first.sha256);
    expect(second.sha256).not.toBe(first.sha256);
    expect(paragraphs((await service.openEditDocument('a.docx')).document)[1]!.text).toBe('第二次');
  });

  it('保留混排 runs 格式与段落属性', async () => {
    const { fs, service } = await setup();
    const xml = SAMPLE_XML.replace(
      '<w:r><w:t>正文段落</w:t></w:r>',
      '<w:pPr><w:spacing w:after="240"/></w:pPr><w:bookmarkStart w:id="1" w:name="x"/><w:r><w:rPr><w:b/></w:rPr><w:t>粗体</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>斜体</w:t></w:r><w:bookmarkEnd w:id="1"/>',
    );
    await fs.importBinaryFile('a.docx', multiPartDocx(xml));
    const opened = await service.openEditDocument('a.docx');
    editParagraph(opened.document, 1, { text: '新文字' });
    const output = serializeEditDocument(opened.document);
    expect(output).toContain('<w:spacing w:after="240"/>');
    expect(output).toContain('<w:b/>');
    expect(output).toContain('<w:i/>');
    expect(output).toContain('bookmarkStart');
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
    expect(paragraphs((await service.openEditDocument('a.docx')).document)[1]!.text).toBe(
      '外部改动',
    );
    expect(hash(onDisk)).not.toBe(opened.sha256);
  });

  it('未支持块（表格/图片）保留原始 XML 且标记不可编辑', async () => {
    const { root, fs, service } = await setup();
    const xml = SAMPLE_XML.replace(
      '</w:body>',
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:drawing/></w:r></w:p></w:body>',
    );
    await fs.importBinaryFile('a.docx', multiPartDocx(xml));
    const opened = await service.openEditDocument('a.docx');
    expect(opened.document.unsupportedCount).toBeGreaterThanOrEqual(1);
    const table = opened.document.blocks.find((block) => block.type === 'table');
    expect(table).toMatchObject({ type: 'table', text: '表格' });
    expect(table?.originalXml).toContain('<w:tbl>');
    const editable = paragraphs(opened.document).filter((p) => p.editable);
    expect(editable.map((p) => p.text)).toContain('标题');
    editParagraph(opened.document, 1, { text: '修改表格旁段落' });
    const saved = await service.saveDocx('a.docx', opened.document, opened.sha256);
    expect(saved.document.blocks.find((block) => block.type === 'table')).toMatchObject({
      type: 'table',
      text: '表格',
    });
    expect(
      readZipEntry(await readFile(path.join(root, 'a.docx')), 'word/document.xml').toString(),
    ).toContain('<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格</w:t>');
  });

  it('重复段落只替换被编辑的实例', async () => {
    const { fs, service } = await setup();
    const duplicate = SAMPLE_XML.replace('标题', '段落一').replace('正文段落', '段落一');
    await fs.importBinaryFile('a.docx', multiPartDocx(duplicate));
    const opened = await service.openEditDocument('a.docx');
    editParagraph(opened.document, 1, { text: '只改第二段' });
    const xml = serializeEditDocument(opened.document);
    // 新策略：在原段落 XML 内按 w:t 节点替换文字，保留原有标签形态。
    expect(xml).toContain('<w:t>只改第二段</w:t>');
    // 两段原 XML 相同：只有第二段被替换，第一段原样保留。
    expect(xml.match(/<w:t>段落一<\/w:t>/g)).toHaveLength(1);
  });

  it('支持 bit 3 data descriptor 并保留未修改条目的 descriptor', () => {
    const original = buildZip([
      { name: 'word/document.xml', data: Buffer.from('<doc/>') },
      { name: 'word/styles.xml', data: Buffer.from('<styles/>') },
    ]);
    const entries = readZipEntries(original);
    const locals = entries.map((entry) => {
      const local = Buffer.from(entry.localBytes);
      local.writeUInt16LE(local.readUInt16LE(6) | 8, 6);
      local.writeUInt32LE(0, 14);
      local.writeUInt32LE(0, 18);
      local.writeUInt32LE(0, 22);
      const payload = local.subarray(30 + local.readUInt16LE(26) + local.readUInt16LE(28));
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(entry.crc, 4);
      descriptor.writeUInt32LE(entry.compressedSize, 8);
      descriptor.writeUInt32LE(entry.uncompressedSize, 12);
      return Buffer.concat([
        local.subarray(0, payload.byteOffset - local.byteOffset),
        payload,
        descriptor,
      ]);
    });
    const body = Buffer.concat(locals);
    const centrals = entries.map((e, i) => {
      const c = Buffer.from(e.centralBytes);
      c.writeUInt32LE(
        locals.slice(0, i).reduce((n, x) => n + x.length, 0),
        42,
      );
      return c;
    });
    const eocd = Buffer.from(original.subarray(original.length - 22));
    eocd.writeUInt32LE(Buffer.concat(centrals).length, 12);
    eocd.writeUInt32LE(body.length, 16);
    const descriptorZip = Buffer.concat([body, Buffer.concat(centrals), eocd]);
    expect(readZipEntry(descriptorZip, 'word/document.xml').toString()).toBe('<doc/>');
    const rebuilt = rebuildZip(descriptorZip, {
      name: 'word/document.xml',
      data: Buffer.from('<new/>'),
    });
    const unchanged = readZipEntries(rebuilt).find((e) => e.name === 'word/styles.xml')!;
    expect(unchanged.localBytes.subarray(-16).readUInt32LE(0)).toBe(0x08074b50);
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
