import { describe, expect, it } from 'vitest';
import {
  filterPageCandidates,
  filterTagCandidates,
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
});
