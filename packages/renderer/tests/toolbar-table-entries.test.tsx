import { describe, expect, it } from 'vitest';
import {
  blockToolbarEntries,
  INSERT_MENU_ID,
  TABLE_ROW_BELOW_ID,
  TABLE_COLUMN_RIGHT_ID,
  TABLE_ROW_DELETE_ID,
  TABLE_COLUMN_DELETE_ID,
} from '../src/editor/toolbar/entries';

const TABLE_ACTIONS = [
  TABLE_ROW_BELOW_ID,
  TABLE_COLUMN_RIGHT_ID,
  TABLE_ROW_DELETE_ID,
  TABLE_COLUMN_DELETE_ID,
];

describe('DEV-070 · 工具栏表格上下文动作', () => {
  it('inTable=true：4 个表格动作出现在插入菜单之前', () => {
    const entries = blockToolbarEntries({ sourceModeToggle: false, inTable: true });
    const ids = entries.map((e) => e.id);
    for (const id of TABLE_ACTIONS) expect(ids).toContain(id);
    const insertIdx = ids.indexOf(INSERT_MENU_ID);
    for (const id of TABLE_ACTIONS) {
      expect(ids.indexOf(id)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(id)).toBeLessThan(insertIdx);
    }
  });

  it('inTable=false（缺省）：不出现表格动作', () => {
    const entries = blockToolbarEntries({ sourceModeToggle: false });
    const ids = entries.map((e) => e.id);
    for (const id of TABLE_ACTIONS) expect(ids).not.toContain(id);
  });

  it('表格动作声明为 insert 组动作（Icon-first 语义）', () => {
    const entries = blockToolbarEntries({ sourceModeToggle: false, inTable: true });
    const table = entries.filter((e) => TABLE_ACTIONS.includes(e.id));
    expect(table).toHaveLength(4);
    for (const entry of table) {
      expect(entry.kind).toBe('action');
    }
  });
});
