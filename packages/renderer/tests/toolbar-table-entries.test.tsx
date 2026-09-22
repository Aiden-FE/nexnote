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

const TABLE_MENU_ID = 'toolbar-table-menu';

describe('DEV-086 · 工具栏表格上下文动作折叠为「表格」菜单', () => {
  it('inTable=true：4 个表格动作不再平铺，而是收进 toolbar-table-menu 菜单', () => {
    const entries = blockToolbarEntries({ sourceModeToggle: false, inTable: true });
    const ids = entries.map((e) => e.id);
    // 4 个 action id 不再是顶级 entry
    for (const id of TABLE_ACTIONS) expect(ids).not.toContain(id);
    // 顶级出现 toolbar-table-menu 菜单
    expect(ids).toContain(TABLE_MENU_ID);
    // 菜单位置在 INSERT_MENU_ID 之前
    const insertIdx = ids.indexOf(INSERT_MENU_ID);
    const menuIdx = ids.indexOf(TABLE_MENU_ID);
    expect(menuIdx).toBeLessThan(insertIdx);
  });

  it('表格菜单包含 4 个子项（顺序与原 action 一致）', () => {
    const entries = blockToolbarEntries({ sourceModeToggle: false, inTable: true });
    const menu = entries.find((e) => e.id === TABLE_MENU_ID);
    expect(menu?.kind).toBe('menu');
    if (menu?.kind !== 'menu') return;
    expect(menu.items.map((i) => i.id)).toEqual(TABLE_ACTIONS);
  });

  it('inTable=false（缺省）：不出现表格菜单', () => {
    const entries = blockToolbarEntries({ sourceModeToggle: false });
    const ids = entries.map((e) => e.id);
    expect(ids).not.toContain(TABLE_MENU_ID);
  });

  it('菜单 kind 必须是 menu（不回归到 4 个顶级 action）', () => {
    const entries = blockToolbarEntries({ sourceModeToggle: false, inTable: true });
    const topLevel = entries.filter((e) => TABLE_ACTIONS.includes(e.id));
    expect(topLevel).toHaveLength(0);
  });
});
