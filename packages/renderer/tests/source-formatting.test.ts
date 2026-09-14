import { describe, expect, it } from 'vitest';
import {
  FORMAT_BOLD,
  FORMAT_CODE,
  FORMAT_ITALIC,
  FORMAT_LINK,
  FORMAT_STRIKE,
  FORMAT_WIKILINK,
} from '../src/editor/interactions/formatting';
import { planSourceFormat, SOURCE_FORMAT_IDS } from '../src/editor/source/source-formatting';

/**
 * DEV-023 源码模式划词格式化（纯逻辑，不依赖编辑器环境）：
 * planSourceFormat 计算 Markdown 包裹写回（insert + 相对选区），
 * 由 applySourceFormat 以单个 CodeMirror 事务应用。
 */
describe('planSourceFormat：选区包裹', () => {
  it('加粗/斜体/删除线/行内代码包裹选区文本，写回后仍选中原文本', () => {
    expect(planSourceFormat(FORMAT_BOLD, '加粗文字', undefined)).toEqual({
      insert: '**加粗文字**',
      anchor: 2,
      head: 6,
    });
    expect(planSourceFormat(FORMAT_ITALIC, '斜体', undefined)).toEqual({
      insert: '*斜体*',
      anchor: 1,
      head: 3,
    });
    expect(planSourceFormat(FORMAT_STRIKE, '删除', undefined)).toEqual({
      insert: '~~删除~~',
      anchor: 2,
      head: 4,
    });
    expect(planSourceFormat(FORMAT_CODE, 'x = 1', undefined)).toEqual({
      insert: '`x = 1`',
      anchor: 1,
      head: 6,
    });
  });

  it('链接：选区文本作 label，URL 入 (url)；取消（无 URL）返回 null', () => {
    expect(planSourceFormat(FORMAT_LINK, '点我', 'https://example.com')).toEqual({
      insert: '[点我](https://example.com)',
      anchor: 1,
      head: 3,
    });
    expect(planSourceFormat(FORMAT_LINK, '点我', null)).toBeNull();
    expect(planSourceFormat(FORMAT_LINK, '点我', '')).toBeNull();
  });

  it('链接 URL 含空格/圆括号时用 <…> 包裹，保证 Markdown 语法正确', () => {
    expect(planSourceFormat(FORMAT_LINK, '维基', 'https://a.b/Foo_(bar)')).toEqual({
      insert: '[维基](<https://a.b/Foo_(bar)>)',
      anchor: 1,
      head: 3,
    });
  });

  it('双链：选区文本包 [[…]]；链接与双链为不同动作 id', () => {
    expect(planSourceFormat(FORMAT_WIKILINK, '计划', undefined)).toEqual({
      insert: '[[计划]]',
      anchor: 2,
      head: 4,
    });
    expect(FORMAT_WIKILINK).not.toBe(FORMAT_LINK);
  });

  it('多行/CRLF 选区原样包裹，不改动选区内字节', () => {
    const text = '第一行\r\n第二行';
    expect(planSourceFormat(FORMAT_BOLD, text, undefined)).toEqual({
      insert: `**${text}**`,
      anchor: 2,
      head: 2 + text.length,
    });
  });
});

describe('planSourceFormat：无选区骨架与光标落点', () => {
  it('空文本插入空语法骨架，光标落在待填位置', () => {
    expect(planSourceFormat(FORMAT_BOLD, '', undefined)).toEqual({
      insert: '****',
      anchor: 2,
      head: 2,
    });
    expect(planSourceFormat(FORMAT_ITALIC, '', undefined)).toEqual({
      insert: '**',
      anchor: 1,
      head: 1,
    });
    expect(planSourceFormat(FORMAT_STRIKE, '', undefined)).toEqual({
      insert: '~~~~',
      anchor: 2,
      head: 2,
    });
    expect(planSourceFormat(FORMAT_CODE, '', undefined)).toEqual({
      insert: '``',
      anchor: 1,
      head: 1,
    });
    expect(planSourceFormat(FORMAT_LINK, '', 'https://example.com')).toEqual({
      insert: '[](https://example.com)',
      anchor: 1,
      head: 1,
    });
  });

  it('双链空文本插入 [[页面名]] 骨架并选中「页面名」', () => {
    expect(planSourceFormat(FORMAT_WIKILINK, '', undefined)).toEqual({
      insert: '[[页面名]]',
      anchor: 2,
      head: 5,
    });
  });

  it('未知 id 返回 null（交回 AI/询问 AI 分派）', () => {
    expect(planSourceFormat('ai:rewrite', '文本', undefined)).toBeNull();
    expect(planSourceFormat('chat:ask-selection', '文本', undefined)).toBeNull();
  });

  it('格式化动作集合顺序：加粗/斜体/删除线/行内代码/链接/双链（与块编辑一致）', () => {
    expect(SOURCE_FORMAT_IDS).toEqual([
      FORMAT_BOLD,
      FORMAT_ITALIC,
      FORMAT_STRIKE,
      FORMAT_CODE,
      FORMAT_LINK,
      FORMAT_WIKILINK,
    ]);
  });
});
