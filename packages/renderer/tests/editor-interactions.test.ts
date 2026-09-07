import { describe, expect, it } from 'vitest';
import {
  filterPageCandidates,
  filterTagCandidates,
  parseWikilinkQuery,
  withUncreated,
} from '../src/editor/interactions/suggestions';
import {
  buildBlockMenuItems,
  BLOCK_MENU_PREFIX,
  BLOCK_MENU_CONVERT_PREFIX,
} from '../src/editor/interactions/block-menu';
import { formatBubbleActions, FORMAT_BOLD, FORMAT_LINK } from '../src/editor/interactions/formatting';

describe('DEV-017 wikilink 候选（纯逻辑）', () => {
  const pages = [
    { path: '项目/计划.md', title: '计划' },
    { path: '项目/总结.md', title: '总结' },
    { path: '随笔.md', title: '随笔' },
  ];
  it('命中已有页时无红链', () => {
    const items = withUncreated(pages, '计划');
    const hit = items.find((i) => i.title === '计划');
    expect(hit?.id).toBe('项目/计划');
    expect(hit?.meta).toBeUndefined();
    expect(items.some((i) => i.meta === 'uncreated')).toBe(false);
  });
  it('未命中已有页时追加红链（回车可创建）', () => {
    const items = withUncreated(pages, '不存在的页');
    const create = items.find((i) => i.meta === 'uncreated');
    expect(create?.id).toBe('不存在的页');
  });
  it('空 query 返回全部页面、无红链', () => {
    const items = withUncreated(pages, '');
    expect(items.length).toBe(3);
    expect(items.some((i) => i.meta === 'uncreated')).toBe(false);
  });
  it('精确命中优先排序', () => {
    const items = filterPageCandidates(pages, '计划');
    expect(items[0]?.id).toBe('项目/计划');
  });
});

describe('DEV-017 wikilink 别名/锚点语法（[[title|alias]] / [[title#heading]]）', () => {
  const pages = [
    { path: '项目/计划.md', title: '计划' },
    { path: '随笔.md', title: '随笔' },
  ];
  it('parseWikilinkQuery 拆分标题/别名/锚点', () => {
    expect(parseWikilinkQuery('计划')).toEqual({ title: '计划', alias: null, heading: null });
    expect(parseWikilinkQuery('计划|日程')).toEqual({ title: '计划', alias: '日程', heading: null });
    expect(parseWikilinkQuery('计划#目标')).toEqual({ title: '计划', alias: null, heading: '目标' });
    expect(parseWikilinkQuery('计划|')).toEqual({ title: '计划', alias: null, heading: null });
  });
  it('输入别名后仍按标题过滤候选，选择保留别名', () => {
    const items = filterPageCandidates(pages, '计划|日程');
    expect(items.length).toBe(1);
    expect(items[0]?.insert).toEqual({ target: '项目/计划', alias: '日程' });
  });
  it('输入锚点后选择保留锚点', () => {
    const items = filterPageCandidates(pages, '随笔#第二节');
    expect(items[0]?.insert).toEqual({ target: '随笔#第二节' });
  });
  it('无修饰语法时无 insert 载荷（内核回退默认别名推导）', () => {
    const items = filterPageCandidates(pages, '计划');
    expect(items[0]?.insert).toBeUndefined();
  });
  it('红链项以标题部分为创建目标，并携带已输入别名/锚点', () => {
    const items = withUncreated(pages, '新页|备注');
    const create = items.find((i) => i.meta === 'uncreated');
    expect(create?.id).toBe('新页');
    expect(create?.insert).toEqual({ target: '新页', alias: '备注' });
    const anchored = withUncreated(pages, '新页#引言').find((i) => i.meta === 'uncreated');
    expect(anchored?.insert).toEqual({ target: '新页#引言' });
  });
});

describe('DEV-017 标签候选（嵌套）', () => {
  it('前缀优先 + 嵌套 hint', () => {
    const items = filterTagCandidates(['work/project', 'work/other', 'inbox', 'work'], 'work');
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items[0]?.id).toBe('work');
    expect(items.some((i) => i.id === 'work/project')).toBe(true);
  });
  it('空 query 返回全部', () => {
    const items = filterTagCandidates(['a', 'b/c'], '');
    expect(items.length).toBe(2);
  });
});

describe('DEV-017 悬浮格式化按钮', () => {
  it('包含粗体/斜体/删除线/行内代码/链接', () => {
    const ids = formatBubbleActions().map((a) => a.id);
    expect(ids).toContain(FORMAT_BOLD);
    expect(ids).toContain(FORMAT_LINK);
    expect(ids.length >= 5).toBe(true);
  });
});

describe('DEV-017 块菜单构建', () => {
  const ctx = {
    view: {} as never,
    target: 'block' as const,
    from: 0,
    to: 4,
    text: '块',
    blockRange: { from: 0, to: 4 },
    coords: { top: 0, left: 0 },
    blockId: 'b1',
  };
  function build() {
    return buildBlockMenuItems(ctx, {
      getKernel: () => null,
      buildAiSubmenu: () => [{ id: 'ai-x', title: 'AI' }],
      pluginItems: [{ id: 'plugin-x', title: '插件项' }],
    });
  }
  it('包含基础动作 + AI + 插件项 + 转换子菜单', () => {
    const items = build();
    expect(items.some((i) => i.id === `${BLOCK_MENU_PREFIX}copy`)).toBe(true);
    expect(items.some((i) => i.id === `${BLOCK_MENU_PREFIX}delete`)).toBe(true);
    const convert = items.find((i) => i.submenu);
    expect(convert?.submenu?.some((s) => s.id === `${BLOCK_MENU_CONVERT_PREFIX}h2`)).toBe(true);
    expect(items.some((i) => i.id === 'ai-x')).toBe(true); // AI 项直接纳入
    expect(items.some((i) => i.title === '插件项')).toBe(true);
    expect(items.some((i) => i.separator)).toBe(true);
  });
  it('折叠项：不可折叠禁用；已折叠显示「展开」', () => {
    const foldedItems = buildBlockMenuItems(ctx, {
      getKernel: () => null,
      canFold: () => true,
      isFolded: () => true,
    });
    const foldItem = foldedItems.find((i) => i.id === `${BLOCK_MENU_PREFIX}fold`);
    expect(foldItem?.title).toBe('展开');
    expect(foldItem?.disabled).toBeFalsy();
    const disabledItems = buildBlockMenuItems(ctx, { getKernel: () => null, canFold: () => false });
    expect(disabledItems.find((i) => i.id === `${BLOCK_MENU_PREFIX}fold`)?.disabled).toBe(true);
  });
});
