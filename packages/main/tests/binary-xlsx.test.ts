import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { parseXlsxToModel, writeModelToXlsx, XlsxError } from '../src/binary/xlsx-convert';
import { preserveXlsxReadonly } from '../src/binary/zip-preserve';

/** 构造一个含多 sheet、公式、合并单元格、基础样式的 xlsx 字节。 */
async function buildSampleXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet1 = workbook.addWorksheet('数据表');
  sheet1.getCell('A1').value = '标题';
  sheet1.getCell('A1').font = { bold: true };
  sheet1.getCell('A2').value = { formula: 'B2*2' };
  sheet1.getCell('B2').value = 21;
  sheet1.getCell('C3').value = '居中';
  sheet1.getCell('C3').alignment = { horizontal: 'center' };
  sheet1.mergeCells('A4:B4');
  sheet1.getCell('A4').value = 'merged';
  const sheet2 = workbook.addWorksheet('第二表');
  sheet2.getCell('A1').value = 'sheet2';
  return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
}

describe('xlsx-convert（DEV-074，ADR-0015 R3）', () => {
  it('多 sheet / 公式 / 合并单元格 / 加粗样式往返保留', async () => {
    const bytes = await buildSampleXlsx();
    const parsed = parseXlsxToModel(bytes);
    expect(parsed.sheets.length).toBe(2);
    const sheet1 = parsed.sheets[0] as Record<string, unknown>;
    const celldata = (sheet1.celldata as Record<string, unknown>[]) ?? [];
    // 公式保留（fortune 以 = 前缀表示）。
    expect(celldata.some((c) => typeof (c.v as Record<string, unknown>).f === 'string')).toBe(true);
    // 加粗样式保留。
    expect(celldata.some((c) => (c.v as Record<string, unknown>).bl === 1)).toBe(true);
    // 合并单元格保留。
    const config = (sheet1.config as Record<string, unknown>) ?? {};
    const merge = (config.merge as Record<string, unknown>) ?? {};
    expect(Object.keys(merge).length).toBeGreaterThan(0);

    // 写回 → 再解析：结构稳定。
    const rebuilt = await writeModelToXlsx({ sheets: parsed.sheets });
    const reparsed = parseXlsxToModel(rebuilt);
    expect(reparsed.sheets.length).toBe(2);
    const rtCelldata = ((reparsed.sheets[0] as Record<string, unknown>).celldata ?? []) as Record<
      string,
      unknown
    >[];
    expect(rtCelldata.some((c) => typeof (c.v as Record<string, unknown>).f === 'string')).toBe(
      true,
    );
    expect(rtCelldata.some((c) => (c.v as Record<string, unknown>).v === '标题')).toBe(true);
  });

  it('货币数字格式、数值类型、公式缓存与对齐往返保留（2026-10 验收）', async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('AI Coding 支出');
    ws.getCell('A1').value = '套餐名';
    ws.getCell('B1').value = '套餐费用';
    ws.getCell('A2').value = 'MiniMax Max';
    ws.getCell('B2').value = 119;
    ws.getCell('B2').numFmt = '"¥"#,##0.00';
    ws.getCell('B2').alignment = { horizontal: 'right', vertical: 'bottom' };
    ws.getCell('A3').value = 'Kimi Andante';
    ws.getCell('B3').value = 49;
    ws.getCell('B3').numFmt = '"¥"#,##0.00';
    ws.getCell('B3').alignment = { horizontal: 'right', vertical: 'bottom' };
    ws.getCell('A4').value = 'CommandCode Gota';
    ws.getCell('B4').value = 67;
    ws.getCell('B4').numFmt = '"¥"#,##0.00';
    ws.getCell('B4').alignment = { horizontal: 'right', vertical: 'bottom' };
    ws.getCell('A5').value = '总计';
    ws.getCell('B5').value = { formula: 'SUM(B2:B4)', result: 235 };
    const bytes = Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);

    const rebuilt = await writeModelToXlsx({ sheets: parseXlsxToModel(bytes).sheets });
    const out = new ExcelJS.Workbook();
    await out.xlsx.load(rebuilt as unknown as ArrayBuffer);
    const ows = out.getWorksheet('AI Coding 支出')!;

    // 数值类型：不得写成 t="s" 文本数字（绿色小三角「以文本形式存储的数字」根因）
    expect(ows.getCell('B2').value).toBe(119);
    expect(ows.getCell('B3').value).toBe(49);
    expect(ows.getCell('B4').value).toBe(67);
    // 货币数字格式往返保留（旧实现 numFmtId 恒为 0/General）
    expect(ows.getCell('B2').numFmt).toBe('"¥"#,##0.00');
    // 右对齐 + 底端对齐保留；旧实现把 fortune vt=2 错映为 top
    expect(ows.getCell('B2').alignment).toMatchObject({ horizontal: 'right', vertical: 'bottom' });
    // 公式保留且带缓存结果（旧实现无 <v>，Excel/WPS 打开显示空白）
    expect(ows.getCell('B5').value).toEqual({ formula: 'SUM(B2:B4)', result: 235 });
    // 真文本单元格不被误转成数字
    expect(ows.getCell('A2').value).toBe('MiniMax Max');
    expect(ows.getCell('A5').value).toBe('总计');
  });

  it('无缓存结果的公式写出 fullCalcOnLoad，打开后自动重算', async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('s');
    ws.getCell('A1').value = 1;
    ws.getCell('A2').value = 2;
    ws.getCell('A3').value = { formula: 'A1+A2' }; // exceljs 无 result
    const bytes = Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);

    const rebuilt = await writeModelToXlsx({ sheets: parseXlsxToModel(bytes).sheets });
    const zip = await JSZip.loadAsync(rebuilt);
    const wbXml = await zip.file('xl/workbook.xml')!.async('string');
    expect(wbXml).toContain('fullCalcOnLoad="1"');
  });

  it('损坏 / 非 zip 字节 fail-closed 拒绝', () => {
    expect(() => parseXlsxToModel(Buffer.from('not a zip at all'))).toThrow(XlsxError);
    expect(() => parseXlsxToModel(Buffer.alloc(0))).toThrow(XlsxError);
  });

  it('保留只读部件，但不复活被模型删除的 worksheet', async () => {
    const original = await buildSampleXlsx();
    const parsed = parseXlsxToModel(original);
    const sheets = parsed.sheets.slice(0, 1);
    const rebuilt = await writeModelToXlsx({ sheets });
    const preserved = await preserveXlsxReadonly(original, rebuilt);
    const out = await JSZip.loadAsync(preserved);
    expect(out.file('xl/worksheets/sheet1.xml')).not.toBeNull();
    expect(out.file('xl/worksheets/sheet2.xml')).toBeNull();
  });

  it('保留端 Relationship Id 与重建端冲突时，丢弃重建端冲突项，原包关系原样保留', async () => {
    const original = await buildSampleXlsx();
    const zip = await JSZip.loadAsync(original);
    // 1) 注入 chart 保留部件与内容类型
    zip.file('xl/charts/chart1.xml', '<c:chart xmlns:c="urn:schemas-microsoft-com"/>');
    const ct = await zip.file('[Content_Types].xml')!.async('string');
    zip.file(
      '[Content_Types].xml',
      ct.replace(
        '</Types>',
        '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>',
      ),
    );
    // 2) 给 chart 在 workbook.xml.rels 里分配一个 Id（与重建端 styles/sharedStrings 通常使用的 rId1 撞车）
    const wbRels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
    // 先移除现有 rId1，再插入 chart 用的 rId1（模拟 OpenXML 极端情况）
    const stripped = wbRels.replace(
      /<Relationship\b[^>]*Id="rId1"[^>]*(?:\/>|><\/Relationship>)/,
      '',
    );
    zip.file(
      'xl/_rels/workbook.xml.rels',
      stripped.replace(
        '</Relationships>',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart1.xml"/></Relationships>',
      ),
    );
    const originalBytes = await zip.generateAsync({ type: 'nodebuffer' });

    const parsed = parseXlsxToModel(originalBytes);
    const rebuilt = await writeModelToXlsx({ sheets: parsed.sheets });
    const preserved = await preserveXlsxReadonly(originalBytes, rebuilt);

    const out = await JSZip.loadAsync(preserved);
    const outRels = await out.file('xl/_rels/workbook.xml.rels')!.async('string');
    // 原包 chart 关系仍指向 Target=charts/chart1.xml；Id 仍然是 rId1
    expect(outRels).toContain('Target="charts/chart1.xml"');
    // 重建端同 Id 的 styles/sharedStrings 等关系被丢弃（避免指向原 chart）
    const idCount = (outRels.match(/Id="rId1"/g) ?? []).length;
    expect(idCount).toBe(1);
    // chart 字节与内容类型还在
    expect(out.file('xl/charts/chart1.xml')).not.toBeNull();
    const outTypes = await out.file('[Content_Types].xml')!.async('string');
    expect(outTypes).toContain('PartName="/xl/charts/chart1.xml"');
  });

  it('DEV-074 保留：模型未涵盖的宏/图表字节与类型/关系声明回填到重建包', async () => {
    const original = await buildSampleXlsx();
    const zip = await JSZip.loadAsync(original);
    // 模拟只读保留区：vbaProject（宏）+ 图表 + 对应的内容类型/关系。
    zip.file('xl/vbaProject.bin', Buffer.from('FAKE_VBA_BYTES'));
    zip.file('xl/charts/chart1.xml', '<c:chart xmlns:c="urn:schemas-microsoft-com"/>');
    const contentTypes = await zip.file('[Content_Types].xml')!.async('string');
    zip.file(
      '[Content_Types].xml',
      contentTypes
        .replace(
          '</Types>',
          '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>',
        )
        .replace(
          '</Types>',
          '<Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>',
        ),
    );
    const wbRels = zip.file('xl/_rels/workbook.xml.rels')!;
    zip.file(
      'xl/_rels/workbook.xml.rels',
      (await wbRels.async('string')).replace(
        '</Relationships>',
        '<Relationship Id="rIdVba" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>',
      ),
    );
    const originalBytes = await zip.generateAsync({ type: 'nodebuffer' });

    // 保存链路：模型重建（丢弃只读区）→ preserveXlsxReadonly 回填。
    const parsed = parseXlsxToModel(originalBytes);
    const rebuilt = await writeModelToXlsx({ sheets: parsed.sheets });
    const preserved = await preserveXlsxReadonly(originalBytes, rebuilt);

    const out = await JSZip.loadAsync(preserved);
    expect(out.file('xl/vbaProject.bin')).not.toBeNull();
    expect(Buffer.from(await out.file('xl/vbaProject.bin')!.async('nodebuffer'))).toEqual(
      Buffer.from('FAKE_VBA_BYTES'),
    );
    expect(out.file('xl/charts/chart1.xml')).not.toBeNull();
    const outTypes = await out.file('[Content_Types].xml')!.async('string');
    expect(outTypes).toContain('PartName="/xl/charts/chart1.xml"');
    expect(outTypes).toContain('PartName="/xl/vbaProject.bin"');
    const outRels = await out.file('xl/_rels/workbook.xml.rels')!.async('string');
    expect(outRels).toContain('Target="vbaProject.bin"');
    // 新编辑仍然生效（保留不覆盖模型输出）。
    const reparsed = parseXlsxToModel(preserved);
    expect(reparsed.sheets.length).toBe(parsed.sheets.length);
  });
});
