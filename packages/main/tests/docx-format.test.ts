import { describe, expect, it } from 'vitest';
import { crc32, buildZip, readZipEntry, ZipError } from '../src/docx/zip';
import { documentXmlToMarkdown, DocxError, projectDocxToMarkdown } from '../src/docx/docx-markdown';
import { markdownToDocx } from '../src/docx/docx-writer';

/** 同步捕获错误码（无抛出/无码时返回占位符，便于断言失败信息直观）。 */
function errorCode(fn: () => unknown): string {
  try {
    fn();
    return '(no throw)';
  } catch (e) {
    return (e as { code?: string }).code ?? '(no code)';
  }
}

describe('DOCX ZIP 与 Markdown 投影', () => {
  it('CRC32 使用标准校验值', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('写出的最小 DOCX 是合法 zip 且投影可往返', () => {
    const markdown = '# 标题\n\n正文 **粗体** 与 *斜体*\n\n- 项目';
    const bytes = markdownToDocx(markdown);
    expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
    const projected = projectDocxToMarkdown(bytes);
    expect(projected).toContain('# 标题');
    expect(projected).toContain('**粗体**');
    expect(projected).toContain('*斜体*');
    expect(projected).toContain('- 项目');
  });

  it('解析标题、列表、行内样式、表格与 XML 实体', () => {
    const xml = `<w:document xmlns:w="x"><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>标题 &amp; 一</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>项目</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>二</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>`;
    const markdown = documentXmlToMarkdown(xml);
    expect(markdown).toContain('## 标题 & 一');
    expect(markdown).toContain(`- **项目***二*`);
    expect(markdown).toContain('A | B');
  });

  it('坏 zip、坏 XML、CRC 损坏均 fail closed 且带稳定错误码', () => {
    expect(errorCode(() => projectDocxToMarkdown(Buffer.from('not a zip')))).toBe(
      'DOCX_INVALID_ZIP',
    );
    expect(errorCode(() => documentXmlToMarkdown('<w:document><w:body>'))).toBe('DOCX_INVALID_XML');
    expect(errorCode(() => documentXmlToMarkdown('<w:document><w:p></w:body></w:document>'))).toBe(
      'DOCX_INVALID_XML',
    );
    expect(errorCode(() => documentXmlToMarkdown('<w:other/>'))).toBe('DOCX_INVALID_XML');
    expect(errorCode(() => documentXmlToMarkdown('<w:document/><w:other/>'))).toBe(
      'DOCX_INVALID_XML',
    );
    const bytes = markdownToDocx('hello');
    const marker = Buffer.from('word/document.xml');
    const nameAt = bytes.indexOf(marker);
    expect(nameAt).toBeGreaterThan(0);
    // 破坏本地文件头后的首个数据字节 → 结构/CRC 校验失败。
    bytes[nameAt + marker.length + 1] = bytes[nameAt + marker.length + 1]! ^ 0xff;
    expect(errorCode(() => projectDocxToMarkdown(bytes))).toMatch(/^DOCX_/);
    expect(() => projectDocxToMarkdown(bytes)).toThrow(ZipError);
    expect(() => documentXmlToMarkdown('')).toThrow(DocxError);
  });

  it('缺少 document.xml 明确报 DOCX_ENTRY_NOT_FOUND', () => {
    const zip = buildZip([{ name: 'other.xml', data: Buffer.from('x') }]);
    expect(errorCode(() => readZipEntry(zip, 'word/document.xml'))).toBe('DOCX_ENTRY_NOT_FOUND');
  });

  it('解压炸弹被 maxOutputLength 上限拒绝', () => {
    const bomb = Buffer.alloc(64 * 1024 * 1024 + 1, 0x61); // 超过默认 maxBytes 的输出
    const zip = buildZip([{ name: 'word/document.xml', data: bomb }]);
    expect(errorCode(() => readZipEntry(zip, 'word/document.xml'))).toMatch(/DOCX_|解压失败/);
  });
});
