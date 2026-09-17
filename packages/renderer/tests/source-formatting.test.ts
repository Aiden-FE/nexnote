import { describe, expect, it } from 'vitest';
import {
  FORMAT_BOLD,
  FORMAT_CODE,
  FORMAT_ITALIC,
  FORMAT_LINK,
  FORMAT_STRIKE,
  FORMAT_WIKILINK,
} from '../src/editor/interactions/formatting';
import {
  formatSourceMarkdown,
  planSourceFormat,
  planSourceMarkdown,
  SOURCE_FORMAT_IDS,
} from '../src/editor/source/source-formatting';

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

describe('Markdown 安全格式化', () => {
  it('规范标题与列表标记后空白、折叠连续空行，并保留 CRLF；标记字符与无上下文依据的缩进不动', () => {
    expect(formatSourceMarkdown('#   标题\r\n\r\n \r\n   *   项目\r\n正文')).toBe(
      '# 标题\r\n\r\n   * 项目\r\n正文',
    );
  });

  it('跳过 YAML frontmatter 与 fenced code 内容', () => {
    const input =
      '---\ntitle:   x\n---\n\n\n#   标题\n```md\n#   代码\n   *   原样\n\n\n```\n+ 项目';
    expect(formatSourceMarkdown(input)).toBe(
      '---\ntitle:   x\n---\n\n# 标题\n```md\n#   代码\n   *   原样\n\n\n```\n+ 项目',
    );
  });

  it('不把 thematic break、setext underline 或普通 hashtag 误格式化', () => {
    const input = '---\n标题\n---\n###hash\n#\t标题\n***';
    expect(formatSourceMarkdown(input)).toBe('---\n标题\n---\n###hash\n# 标题\n***');
    expect(formatSourceMarkdown('正文\n---\n###hash\n#\t标题\n***')).toBe(
      '正文\n---\n###hash\n# 标题\n***',
    );
  });

  it('有序父项内容列下的子列表不被取整：`1. a` 下 3 空格缩进保持原样', () => {
    // `1. ` 内容列在第 3 列，3 空格缩进的 `   - b` 是其子列表；
    // 旧实现无条件取整到 2 会使其脱嵌（2 < 3 变成顶层兄弟列表）。
    expect(formatSourceMarkdown('1. a\n   - b')).toBe('1. a\n   - b');
    expect(planSourceMarkdown('1. a\n   - b')).toEqual([]);
    expect(formatSourceMarkdown('1.   a\n    - b')).toBe('1.   a\n    - b');
  });

  it('无序列表标记字符绝不被改写（`-`/`+`/`*` 混用是两个列表），仅规范标记后空白', () => {
    // 改写 `*`→`-` 会把 `- a` 与 `* b` 两个列表静默合并为一个。
    expect(formatSourceMarkdown('- a\n* b\n+ c')).toBe('- a\n* b\n+ c');
    expect(formatSourceMarkdown('-   a\n*\tb\n+  c')).toBe('- a\n* b\n+ c');
    expect(formatSourceMarkdown('  +   嵌套')).toBe('  + 嵌套');
  });

  it('有序列表标记（`1.`）后的空白同样保持原样，不纳入规范范围', () => {
    expect(formatSourceMarkdown('1.   a\n2.\tb')).toBe('1.   a\n2.\tb');
  });

  it('标记后紧跟非空白视为漏空格笔误补一个空格；疑似正文（数字开头/行内再出现标记）不动', () => {
    expect(formatSourceMarkdown('*item')).toBe('* item');
    expect(formatSourceMarkdown('+条目')).toBe('+ 条目');
    // `-3 度` 更可能是负数文本，`*斜体*` 是强调：补空格会改变语义。
    expect(formatSourceMarkdown('-3 度')).toBe('-3 度');
    expect(formatSourceMarkdown('*斜体* 续行')).toBe('*斜体* 续行');
  });

  it('缩进取整仅在安全上下文执行：顶层 1 空格归 0，或对齐取整值上的同级无序项', () => {
    // 顶层 1 空格笔误归 0：CommonMark 中 1 与 0 空格同为顶层项，语义不变；
    // 若归 2 则在 `- a` 这类 0 缩进兄弟后会把兄弟变成子项，改变嵌套。
    expect(formatSourceMarkdown(' -   x')).toBe('- x');
    expect(formatSourceMarkdown('- a\n - b')).toBe('- a\n- b');
    // 奇数缩进 3 且前一个非空行恰为 2 空格缩进的无序项：对齐为同级 2 空格。
    expect(formatSourceMarkdown('- a\n  - b\n   - c')).toBe('- a\n  - b\n  - c');
    // 无同级项佐证时一律不动：`- a` 下的 3 空格子列表（内容列 2 ≤ 3，是子项）保持原缩进。
    expect(formatSourceMarkdown('- a\n   - b')).toBe('- a\n   - b');
    expect(formatSourceMarkdown('* a\n   - b')).toBe('* a\n   - b');
  });

  it('selection 仅产生与相交行有关的 edits，并需要非空范围', () => {
    const text = '#   一\n*   二\n#   三';
    expect(planSourceMarkdown(text, { from: 7, to: 11 })).toEqual([
      { from: 6, to: 9, insert: '*' },
    ]);
    expect(planSourceMarkdown(text, { from: 0, to: 0 })).toEqual([]);
  });
});
