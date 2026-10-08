// @vitest-environment node
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BinaryService } from '../src/binary/binary-service';
import { VaultFsService } from '../src/fs/fs-service';
import { parseXlsxToModel, readSheetCells, writeModelToXlsx } from '../src/binary/xlsx-convert';
import { xlsxPackagesEquivalent } from '../src/binary/zip-preserve';
import editorPayload from './fixtures/xlsx-editor-onchange-payload.json';

/**
 * P0 回归（表格被写空）：
 * 编辑器 `@fortune-sheet/react` 的 onChange 回传的是**运行态**——载入时库把
 * `celldata` 展开为 `data[r][c]` 并 `delete celldata`（core `initSheetData`）。
 * 写盘侧若只认 `celldata`，每次保存都会把工作簿写成空表（表名保留、单元格全丢）。
 *
 * fixture `xlsx-editor-onchange-payload.json` 是从真实 `<Workbook>` 组件挂载时
 * 抓取的 onChange 载荷（字段为 name/id/status/data），不是手写的近似结构。
 */
describe('xlsx 保存兼容编辑器运行态载荷（P0 回归）', () => {
  let root: string;
  let service: BinaryService;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'nexnote-xlsx-editor-'));
    const fs = new VaultFsService(() => root);
    service = new BinaryService(fs, () => root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('运行态载荷（data，无 celldata）保存后单元格与工作表名都保留', async () => {
    const created = await service.createBinary('xlsx', { title: '支出表' });
    const saved = await service.save(
      'xlsx',
      created.path,
      { sheets: editorPayload },
      created.sha256,
    );

    const { data, sha256 } = await service.read('xlsx', created.path);
    expect(sha256).toBe(saved.sha256);
    const sheet = (data as { sheets: Record<string, unknown>[] }).sheets[0]!;
    expect(sheet.name).toBe('AI Coding 支出');
    const cells = (sheet.celldata ?? []) as { r: number; c: number; v: { v?: unknown } }[];
    expect(cells).toHaveLength(4);
    // fortune-excel 读回时把数字单元格也按文本呈现，这里只断言内容不丢。
    expect(cells.map((cell) => String(cell.v.v))).toEqual(
      expect.arrayContaining(['Plan', '费用', 'Cursor Pro', '20']),
    );
  });

  it('运行态与磁盘模型两种形态读成同一批单元格', () => {
    const diskShaped = {
      name: 'AI Coding 支出',
      celldata: [{ r: 0, c: 0, v: { v: 'Plan' } }],
    };
    const editorShaped = { name: 'AI Coding 支出', data: [[{ v: 'Plan' }], [null]] };
    expect(readSheetCells(editorShaped)).toEqual(readSheetCells(diskShaped));
    expect(readSheetCells({ name: '空表', data: [[null, null]] })).toEqual([]);
    expect(readSheetCells({ name: '空表' })).toEqual([]);
  });

  it('写出的包在忽略 docProps 时间戳后等价（无变化保存的判据）', async () => {
    const diskShaped = [{ name: 'AI Coding 支出', celldata: [{ r: 0, c: 0, v: { v: 'Plan' } }] }];
    const editorShaped = [{ name: 'AI Coding 支出', data: [[{ v: 'Plan' }], [null]] }];
    const [a, b] = await Promise.all([
      writeModelToXlsx({ sheets: diskShaped }),
      writeModelToXlsx({ sheets: editorShaped }),
    ]);
    expect(await xlsxPackagesEquivalent(a, b)).toBe(true);
    const changed = await writeModelToXlsx({
      sheets: [{ name: 'AI Coding 支出', data: [[{ v: 'Plan 2' }], [null]] }],
    });
    expect(await xlsxPackagesEquivalent(a, changed)).toBe(false);
  });

  it('内容未变化的重复保存不重写文件（不制造无意义 Git diff）', async () => {
    const created = await service.createBinary('xlsx', { title: '支出表' });
    const first = await service.save(
      'xlsx',
      created.path,
      { sheets: editorPayload },
      created.sha256,
    );
    const abs = path.join(root, created.path);
    const before = readFileSync(abs);
    const beforeStat = statSync(abs);
    // 让写盘可被时间戳区分：若实现走了写盘路径，mtime 必然前进。
    await new Promise((resolve) => setTimeout(resolve, 30));

    const second = await service.save(
      'xlsx',
      created.path,
      { sheets: editorPayload },
      first.sha256,
    );
    expect(second.sha256).toBe(first.sha256);
    expect(readFileSync(abs).equals(before)).toBe(true);
    expect(statSync(abs).mtimeMs).toBe(beforeStat.mtimeMs);
  });

  it('磁盘文件里的工作表名由运行态载荷保留（不是 Sheet1 回退）', async () => {
    const created = await service.createBinary('xlsx', { title: '支出表' });
    await service.save('xlsx', created.path, { sheets: editorPayload }, created.sha256);
    const parsed = parseXlsxToModel(await fsp.readFile(path.join(root, created.path)));
    expect((parsed.sheets[0] as { name?: string }).name).toBe('AI Coding 支出');
  });
});
