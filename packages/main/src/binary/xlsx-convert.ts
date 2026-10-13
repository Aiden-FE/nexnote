import { inflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { FortuneFile } from '@corbe30/fortune-excel/dist/ToFortuneSheet/FortuneFile';
import { readZipEntries, ZipError } from '../docx/zip';
import { tCurrent, type BinaryReadonlyTag } from '@nexnote/shared';

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

/** 稀疏单元格：fortune-sheet / fortune-excel 的 celldata 元素。 */
interface SheetCell {
  r: number;
  c: number;
  v: unknown;
}

/**
 * 读取 sheet 的单元格，兼容两种形态：
 * - **磁盘模型**（`binary:read` 返回值）：稀疏 `celldata` 数组；
 * - **编辑器运行态**（`@fortune-sheet/react` 的 `onChange` 载荷）：库在载入时把
 *   `celldata` 展开成 `data[r][c]` 二维矩阵并 **delete celldata**
 *   （见 core `initSheetData`），所以写盘侧必须同时接受 `data`。
 *   历史缺陷：只读 `celldata` 会让每次保存都把工作簿写空（表名保留、单元格全丢）。
 */
export function readSheetCells(sheet: Record<string, unknown>): SheetCell[] {
  const celldata = sheet.celldata;
  if (Array.isArray(celldata)) return celldata as SheetCell[];
  const data = sheet.data;
  if (!Array.isArray(data)) return [];
  const cells: SheetCell[] = [];
  data.forEach((row, r) => {
    if (!Array.isArray(row)) return;
    row.forEach((value, c) => {
      if (value === null || value === undefined) return;
      cells.push({ r, c, v: value });
    });
  });
  return cells;
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
      entry.method === 8 ? inflateRawSync(payload, { maxOutputLength: 64 * 1024 * 1024 }) : payload;
    map[entry.name] = data.toString('utf8');
  }
  return map;
}

/** xlsx 导入 fail-closed 校验 + fortune 工作簿解析。任何损坏抛 XlsxError。 */
export function parseXlsxToModel(bytes: Buffer): XlsxModel & { readonly: BinaryReadonlyTag[] } {
  // zip 结构先做零依赖校验（与 docx 导入同口径），再交给 fortune-excel 深解析。
  try {
    readZipEntries(bytes);
  } catch (e) {
    if (e instanceof ZipError) {
      throw new XlsxError(
        tCurrent('binary.error.XLSX_INVALID_ZIP', { message: e.message }),
        'XLSX_INVALID_ZIP',
      );
    }
    throw e;
  }
  let model: { sheets?: unknown[] };
  try {
    const file = new FortuneFile(collectZipFileMap(bytes), 'workbook.xlsx');
    file.Parse();
    model = file.serialize() as unknown as { sheets?: unknown[] };
  } catch (e) {
    throw new XlsxError(
      tCurrent('binary.error.XLSX_PARSE_FAILED', { message: (e as Error).message }),
      'XLSX_PARSE_FAILED',
    );
  }
  if (!model || !Array.isArray(model.sheets) || model.sheets.length === 0) {
    throw new XlsxError(tCurrent('binary.error.XLSX_NO_SHEETS'), 'XLSX_NO_SHEETS');
  }
  const readonly: BinaryReadonlyTag[] = [];
  // 宏：xl/vbaProject.bin 存在即标记（只读保留区，保存时原字节不参与重建）。
  for (const entry of readZipEntries(bytes)) {
    if (/^xl\/vbaProject\.bin$/i.test(entry.name)) {
      readonly.push('MACRO');
      break;
    }
  }
  for (const sheet of model.sheets as Record<string, unknown>[]) {
    if (Array.isArray(sheet.chart) && sheet.chart.length > 0) readonly.push('CHART');
    if (sheet.isPivotTable === true) readonly.push('PIVOT_TABLE');
  }
  return { sheets: model.sheets, readonly: [...new Set(readonly)] };
}

/**
 * 把 fortune 工作簿 JSON 重建为 .xlsx。
 * 保留：多 sheet、公式（含缓存结果）、合并单元格、数字格式（货币/日期等）、
 * 基础样式（字体加粗/斜体/颜色/字号、对齐、填充）。
 * 只读保留区（宏/图表/透视表）不参与重建；含未支持内容的原包由调用方决定整包保留。
 */
export async function writeModelToXlsx(model: XlsxModel): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  // 公式缺缓存结果时要求 Excel/WPS 打开后全量重算，否则公式单元格显示空白
  // （exceljs 不做公式求值；无 <v> 缓存且不重算就是用户报告的「公式还在、显示空白」）。
  let needsFullCalc = false;
  for (const rawSheet of Array.isArray(model.sheets) ? model.sheets : []) {
    const sheet = rawSheet as Record<string, unknown>;
    const name = typeof sheet.name === 'string' && sheet.name.trim() ? sheet.name.trim() : 'Sheet';
    const worksheet = workbook.addWorksheet(name.slice(0, 31));
    const celldata = readSheetCells(sheet);
    for (const cell of celldata as unknown as Record<string, unknown>[]) {
      const r = Number(cell.r);
      const c = Number(cell.c);
      if (!Number.isFinite(r) || !Number.isFinite(c) || r < 0 || c < 0) continue;
      const v = (cell.v ?? {}) as Record<string, unknown>;
      const target = worksheet.getRow(r + 1).getCell(c + 1);
      if (typeof v.f === 'string' && v.f) {
        const formula = v.f.replace(/^=/, '');
        // fortune 把公式缓存计算结果放在 v（与普通值同源，始终是字符串）。
        const cached = numericCellValue(v.v);
        if (cached !== null) {
          target.value = { formula, result: cached };
        } else {
          target.value = { formula, result: typeof v.v === 'string' ? v.v : undefined };
          needsFullCalc = true;
        }
      } else if (v.v !== undefined && v.v !== null) {
        // 恢复数值类型：fortune 读 XML 时把 <v> 一律字符串化，直接照写会产生
        // t="s" 文本数字（Excel/WPS 标绿色小三角「以文本形式存储的数字」，且
        // SUM 对其不参与计算）。有数字格式声明（ct.t==='n'）或无类型声明的
        // 纯数字串都按数字写回；显式文本（ct.t 为其它值）保持字符串。
        const num = numericCellValue(v.v);
        if (num !== null && isNumericType(v)) {
          target.value = num;
        } else {
          target.value = v.v as ExcelJS.CellValue;
        }
      }
      applyBasicStyle(target, v);
    }
    const config = (sheet.config ?? {}) as Record<string, unknown>;
    const merge = (config.merge ?? {}) as Record<
      string,
      { r?: number; c?: number; rs?: number; cs?: number }
    >;
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
  if (needsFullCalc) workbook.calcProperties = { fullCalcOnLoad: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

/**
 * 纯数字串 → 数字；非数字返回 null。接受整数、小数、千分位与科学计数法。
 * 布尔、公式文本、混合内容一律视为非数字。
 */
function numericCellValue(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    return null;
  }
  const n = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * 该单元格是否应按数值类型写回：
 * - fortune 数字格式声明 ct.t === 'n'（货币/日期/百分比等）→ 必为数字；
 * - 显式文本/其它 ct 类型 → 保持字符串；
 * - 无 ct 声明的纯数字串也按数字（xlsx 语义下纯数字串本就不是文本数据，
 *   同时修复历史版本已写成文本数字的文件）。
 */
function isNumericType(v: Record<string, unknown>): boolean {
  const ct = v.ct as { t?: unknown } | null;
  if (!ct || typeof ct !== 'object') return true;
  if (ct.t === 'n') return true;
  return false;
}

/** fortune 单元格基础样式 → exceljs（数字格式、字体、对齐、填充色）。 */
function applyBasicStyle(target: ExcelJS.Cell, v: Record<string, unknown>): void {
  // 数字格式（货币 ¥、日期、百分比等）：fortune 存为 ct.fa（格式码）。
  // 不写回 numFmt 会让货币格式在往返后整体退化成「常规」。
  const ct = v.ct as { fa?: unknown } | null;
  if (ct && typeof ct === 'object' && typeof ct.fa === 'string' && ct.fa.trim()) {
    const format = ct.fa.trim();
    if (format !== 'General') target.numFmt = format;
  }
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
  else if (v.ht === 1) alignment.horizontal = 'left';
  else if (v.ht === 2) alignment.horizontal = 'right';
  if (v.vt === 0) alignment.vertical = 'middle';
  else if (v.vt === 1) alignment.vertical = 'top';
  else if (v.vt === 2) alignment.vertical = 'bottom';
  if (Object.keys(alignment).length > 0) target.alignment = alignment as Partial<ExcelJS.Alignment>;
  if (typeof v.bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.bg)) {
    target.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${v.bg.slice(1).toUpperCase()}` },
    };
  }
}
