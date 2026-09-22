import { inflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { FortuneFile } from '@corbe30/fortune-excel/dist/ToFortuneSheet/FortuneFile';
import { readZipEntries, ZipError } from '../docx/zip';

/**
 * xlsx ↔ fortune-sheet 数据转换（DEV-074，ADR-0015 R3）：
 * - 读：fortune-excel 的 FortuneFile（zip → XML → fortune 工作簿 JSON）在 Node 侧运行，
 *   兼作导入 fail-closed 校验（zip 结构 / workbook XML 任一损坏即抛错）。
 * - 写：exceljs 重建 .xlsx（多 sheet、公式、合并单元格、基础样式往返保留）。
 * - 只读保留区：图表 / 透视表在读取时识别并上报只读标注；宏（vbaProject）由调用方
 *   在保存时决定是否整包保留原字节。
 */

export class XlsxError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'XlsxError';
  }
}

export interface XlsxModel {
  /** fortune-sheet 工作簿数据（JSON 可序列化，renderer 的 @fortune-sheet/react 直接可用）。 */
  sheets: unknown[];
}

/** fortune-excel 的 FortuneFile 期望 { 文件名: 文本内容 } 的 plain map。 */
function collectZipFileMap(bytes: Buffer): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of readZipEntries(bytes)) {
    if (entry.name.endsWith('/')) continue;
    const nameLen = entry.localBytes.readUInt16LE(26);
    const extraLen = entry.localBytes.readUInt16LE(28);
    const start = 30 + nameLen + extraLen;
    const payload = entry.localBytes.subarray(start, start + entry.compressedSize);
    const data =
      entry.method === 8
        ? inflateRawSync(payload, { maxOutputLength: 64 * 1024 * 1024 })
        : payload;
    map[entry.name] = data.toString('utf8');
  }
  return map;
}

/** xlsx 导入 fail-closed 校验 + fortune 工作簿解析。任何损坏抛 XlsxError。 */
export function parseXlsxToModel(bytes: Buffer): XlsxModel & { readonly: string[] } {
  // zip 结构先做零依赖校验（与 docx 导入同口径），再交给 fortune-excel 深解析。
  try {
    readZipEntries(bytes);
  } catch (e) {
    if (e instanceof ZipError) {
      throw new XlsxError(`非法 xlsx 包：${e.message}`, 'XLSX_INVALID_ZIP');
    }
    throw e;
  }
  let model: { sheets?: unknown[] };
  try {
    const file = new FortuneFile(collectZipFileMap(bytes), 'workbook.xlsx');
    file.Parse();
    model = file.serialize() as unknown as { sheets?: unknown[] };
  } catch (e) {
    throw new XlsxError(`xlsx 解析失败：${(e as Error).message}`, 'XLSX_PARSE_FAILED');
  }
  if (!model || !Array.isArray(model.sheets) || model.sheets.length === 0) {
    throw new XlsxError('xlsx 缺少工作表', 'XLSX_NO_SHEETS');
  }
  const readonly: string[] = [];
  // 宏：xl/vbaProject.bin 存在即标记（只读保留区，保存时原字节不参与重建）。
  for (const entry of readZipEntries(bytes)) {
    if (/^xl\/vbaProject\.bin$/i.test(entry.name)) {
      readonly.push('宏（只读）');
      break;
    }
  }
  for (const sheet of model.sheets as Record<string, unknown>[]) {
    if (Array.isArray(sheet.chart) && sheet.chart.length > 0) readonly.push('图表（只读）');
    if (sheet.isPivotTable === true) readonly.push('透视表（只读）');
  }
  return { sheets: model.sheets, readonly: [...new Set(readonly)] };
}

/**
 * 把 fortune 工作簿 JSON 重建为 .xlsx 字节。
 * 保留：多 sheet、公式、合并单元格、基础样式（字体加粗/斜体/颜色/字号、对齐、填充）。
 * 只读保留区（宏/图表/透视表）不参与重建；含未支持内容的原包由调用方决定整包保留。
 */
export async function writeModelToXlsx(model: XlsxModel): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const rawSheet of Array.isArray(model.sheets) ? model.sheets : []) {
    const sheet = rawSheet as Record<string, unknown>;
    const name =
      typeof sheet.name === 'string' && sheet.name.trim() ? sheet.name.trim() : 'Sheet';
    const worksheet = workbook.addWorksheet(name.slice(0, 31));
    const celldata = Array.isArray(sheet.celldata) ? sheet.celldata : [];
    for (const cell of celldata as Record<string, unknown>[]) {
      const r = Number(cell.r);
      const c = Number(cell.c);
      if (!Number.isFinite(r) || !Number.isFinite(c) || r < 0 || c < 0) continue;
      const v = (cell.v ?? {}) as Record<string, unknown>;
      const target = worksheet.getRow(r + 1).getCell(c + 1);
      if (typeof v.f === 'string' && v.f) {
        target.value = { formula: v.f.replace(/^=/, '') };
      } else if (v.v !== undefined && v.v !== null) {
        target.value = v.v as ExcelJS.CellValue;
      }
      applyBasicStyle(target, v);
    }
    const config = (sheet.config ?? {}) as Record<string, unknown>;
    const merge = (config.merge ?? {}) as Record<string, { r?: number; c?: number; rs?: number; cs?: number }>;
    for (const m of Object.values(merge)) {
      const r = Number(m?.r);
      const c = Number(m?.c);
      const rs = Number(m?.rs) || 1;
      const cs = Number(m?.cs) || 1;
      if (Number.isFinite(r) && Number.isFinite(c) && (rs > 1 || cs > 1)) {
        try {
          worksheet.mergeCells(r + 1, c + 1, r + rs, c + cs);
        } catch {
          // 非法合并区间跳过，不阻断保存。
        }
      }
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

/** fortune 单元格基础样式 → exceljs（字体加粗/斜体/颜色/字号、对齐、填充色）。 */
function applyBasicStyle(target: ExcelJS.Cell, v: Record<string, unknown>): void {
  const font: Record<string, unknown> = {};
  if (typeof v.ff === 'string' && v.ff) font.name = v.ff;
  if (typeof v.fs === 'number' && v.fs > 0) font.size = v.fs;
  if (v.bl === 1) font.bold = true;
  if (v.it === 1) font.italic = true;
  if (typeof v.fc === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.fc)) {
    font.color = { argb: `FF${v.fc.slice(1).toUpperCase()}` };
  }
  if (Object.keys(font).length > 0) target.font = font as Partial<ExcelJS.Font>;
  const alignment: Record<string, unknown> = {};
  // fortune ht：0 居中 1 左 2 右；vt：0 居中 1 上 2 下
  if (v.ht === 0) alignment.horizontal = 'center';
  else if (v.ht === 2) alignment.horizontal = 'right';
  if (v.vt === 0) alignment.vertical = 'middle';
  else if (v.vt === 2) alignment.vertical = 'top';
  if (Object.keys(alignment).length > 0) target.alignment = alignment as Partial<ExcelJS.Alignment>;
  if (typeof v.bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.bg)) {
    target.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${v.bg.slice(1).toUpperCase()}` },
    };
  }
}
