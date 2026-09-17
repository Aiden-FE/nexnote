import { describe, expect, it } from 'vitest';
import { buildKernelExtensions, createMarkdownManager, parseMarkdown } from '@nexnote/kernel';
import {
  createOutlineId,
  parseBlockOutline,
  parseMarkdownOutline,
  slugifyOutlineText,
  type OutlineEntry,
} from '../src/editor/outline';

describe('parseMarkdownOutline（DEV-047 共享标题目录）', () => {
  it('解析 ATX 与 Setext 标题：CRLF、跳级、稳定定位与顺序 ordinal', () => {
    const markdown = '# Top\r\ntext\r\n### Third level\r\n\r\nSetext title\r\n---\r\n###### End';

    expect(parseMarkdownOutline(markdown)).toEqual([
      { id: 'top', level: 1, text: 'Top', ordinal: 0, line: 1, from: 0, to: 5 },
      { id: 'third-level', level: 3, text: 'Third level', ordinal: 1, line: 3, from: 13, to: 28 },
      { id: 'setext-title', level: 2, text: 'Setext title', ordinal: 2, line: 5, from: 32, to: 44 },
      { id: 'end', level: 6, text: 'End', ordinal: 3, line: 7, from: 51, to: 61 },
    ]);
  });

  it('排除 frontmatter 与 fenced code/mermaid 中的伪标题；未闭合 fence 到文末均为代码', () => {
    const markdown = [
      '---',
      'title: Example',
      '# yaml fake',
      '---',
      '# Real',
      '```md',
      '# code fake',
      '```',
      '~~~mermaid',
      '# diagram fake',
      'Node',
      '===',
      '~~~',
      '# After',
      '```ts',
      '# unterminated fake',
    ].join('\n');

    expect(parseMarkdownOutline(markdown).map(({ text, level }) => ({ text, level }))).toEqual([
      { text: 'Real', level: 1 },
      { text: 'After', level: 1 },
    ]);
  });

  it('为重复与空标题生成确定且唯一的 id，且不修改正文', () => {
    const markdown = '# Same\n## Same\n###\n# Same\n';
    const original = markdown;

    expect(
      parseMarkdownOutline(markdown).map(({ id, text, level, ordinal }) => ({
        id,
        text,
        level,
        ordinal,
      })),
    ).toEqual([
      { id: 'same', text: 'Same', level: 1, ordinal: 0 },
      { id: 'same-2', text: 'Same', level: 2, ordinal: 1 },
      { id: 'heading', text: '', level: 3, ordinal: 2 },
      { id: 'same-3', text: 'Same', level: 1, ordinal: 3 },
    ]);
    expect(markdown).toBe(original);
  });

  it('剥离 ATX 收尾 # 序列与行尾块锚点 token（与 firstH1 语义一致）', () => {
    const entries = parseMarkdownOutline('## Head ##\r\n# 概览 ^abc123\r\n');
    expect(entries.map(({ id, level, text }) => ({ id, level, text }))).toEqual([
      { id: 'head', level: 2, text: 'Head' },
      { id: '概览', level: 1, text: '概览' },
    ]);
  });

  it('ATX 行内 Markdown 提取与块模式 textContent 一致，且保留源码定位', () => {
    const markdown =
      '# *Em* **Strong** ~~Gone~~ `code *raw*` [Link](https://example.com) ![Alt](image.png) [[Target|Alias]] [[Only Target]] \\*escaped\\* &amp; &#x4E2D;';
    const visible = 'Em Strong Gone code *raw* Link Alt Alias Only Target *escaped* & 中';
    const block = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: visible }],
        },
      ],
    };

    const [entry] = parseMarkdownOutline(markdown);
    expect(entry).toEqual({
      id: 'em-strong-gone-code-raw-link-alt-alias-only-target-escaped-中',
      level: 1,
      text: visible,
      ordinal: 0,
      line: 1,
      from: 0,
      to: markdown.length,
    });
    expect(entry?.text).toBe(parseBlockOutline(block)[0]?.text);
    expect(entry?.id).toBe(parseBlockOutline(block)[0]?.id);
  });

  it('ATX 标题移除安全行内 HTML tag 并保留内部文本，危险 tag 只作为字符串处理', () => {
    const markdown =
      '# Hello <em class="tone">world</em> <strong>again</strong> <script>alert(1)</script> <style>.x{}</style>';

    const [entry] = parseMarkdownOutline(markdown);
    expect(entry?.text).toBe('Hello world again <script>alert(1)</script> <style>.x{}</style>');
    expect(entry?.from).toBe(0);
    expect(entry?.to).toBe(markdown.length);
  });

  it('ATX 引用式链接与图片按 definition 提取可见文本，未定义引用保守保留源码', () => {
    const markdown = [
      '# [Full][guide] [Collapsed][] [Shortcut] ![Diagram][image] ![Logo][] [Missing][nope] [Unknown]',
      '',
      '[guide]: https://example.com/guide',
      '[collapsed]: /collapsed',
      '[shortcut]: /shortcut',
      '[image]: diagram.png',
      '[logo]: logo.png',
    ].join('\n');

    expect(parseMarkdownOutline(markdown)[0]?.text).toBe(
      'Full Collapsed Shortcut Diagram Logo [Missing][nope] [Unknown]',
    );
  });

  it('Setext 标题对安全 HTML、引用式链接与图片使用相同的可见文本提取', () => {
    const markdown = [
      '<em>world</em> [Guide][docs] ![Picture][] [Missing][] [Unknown]',
      '===',
      '',
      '[docs]: /docs',
      '[picture]: picture.png',
    ].join('\n');

    const [entry] = parseMarkdownOutline(markdown);
    expect(entry).toMatchObject({
      id: 'world-guide-picture-missing-unknown',
      level: 1,
      text: 'world Guide Picture [Missing][] [Unknown]',
      line: 1,
      from: 0,
      to: 63,
    });
  });

  it('Setext 标题使用相同的可见文本提取，重复可见文本决定 id 去重', () => {
    const markdown = [
      '[Same](one) &amp;',
      '===',
      '**Same** &',
      '---',
      '[[Same|Same]] &amp;',
      '---',
    ].join('\n');

    expect(
      parseMarkdownOutline(markdown).map(({ id, text, level, line, from, to }) => ({
        id,
        text,
        level,
        line,
        from,
        to,
      })),
    ).toEqual([
      { id: 'same', text: 'Same &', level: 1, line: 1, from: 0, to: 17 },
      { id: 'same-2', text: 'Same &', level: 2, line: 3, from: 22, to: 32 },
      { id: 'same-3', text: 'Same &', level: 2, line: 5, from: 37, to: 56 },
    ]);
  });

  it('缩进 1-3 空格仍是 ATX；4 空格、\\# 转义、#无空格、7 个 # 都不是标题', () => {
    const markdown = [
      ' # One',
      '   ## Two',
      '    ### Four spaces',
      '\\# Escaped',
      '#NoSpace',
      '####### Seven',
    ].join('\n');

    expect(parseMarkdownOutline(markdown).map(({ text, line }) => ({ text, line }))).toEqual([
      { text: 'One', line: 1 },
      { text: 'Two', line: 2 },
    ]);
  });

  it('多行 Setext 段落以 \\n join（与块侧 textContent 一致），slug 归一空白不受影响', () => {
    expect(parseMarkdownOutline('Intro\ncontinued\n===')).toEqual([
      {
        id: 'intro-continued',
        level: 1,
        text: 'Intro\ncontinued',
        ordinal: 0,
        line: 1,
        from: 0,
        to: 15,
      },
    ]);
  });

  it('孤立分隔线与空文档不产生标题；未闭合 frontmatter 防御式视为正文', () => {
    expect(parseMarkdownOutline('---\n\n***\n\n- - -\n')).toEqual([]);
    expect(parseMarkdownOutline('')).toEqual([]);
    expect(
      parseMarkdownOutline('---\ntitle: x\n# Heading').map(({ text, line }) => ({ text, line })),
    ).toEqual([{ text: 'Heading', line: 3 }]);
  });

  it('识别块引用内 ATX 标题（可嵌套、可缩进）；from/to 仍指向原始行', () => {
    const markdown = '# 顶层\n\n> # 引用标题\n\n  > > ### 嵌套引用\n\n># 直接引用\n';

    expect(
      parseMarkdownOutline(markdown).map(({ id, level, text, line, from, to }) => ({
        id,
        level,
        text,
        line,
        from,
        to,
      })),
    ).toEqual([
      { id: '顶层', level: 1, text: '顶层', line: 1, from: 0, to: 4 },
      // 行 3「> # 引用标题」共 8 字符（start 6）：from/to 指向原始行行首与内容末，含引用前缀。
      { id: '引用标题', level: 1, text: '引用标题', line: 3, from: 6, to: 14 },
      { id: '嵌套引用', level: 3, text: '嵌套引用', line: 5, from: 16, to: 30 },
      { id: '直接引用', level: 1, text: '直接引用', line: 7, from: 32, to: 39 },
    ]);
  });

  it('块引用内 Setext 下划线与待定段落文本同样剥引用前缀识别', () => {
    const markdown = '> 引用小节\n> ---\n>\n> 单行\n> ===';
    expect(
      parseMarkdownOutline(markdown).map(({ text, level, line }) => ({ text, level, line })),
    ).toEqual([
      { text: '引用小节', level: 2, line: 1 },
      { text: '单行', level: 1, line: 4 },
    ]);
  });

  it('块引用内 fence 先剥引用前缀识别：其中伪标题不产生条目，未闭合到文末均为代码', () => {
    const markdown = [
      '# 实标题',
      '',
      '> ```ts',
      '> # 引用内伪标题',
      '> ===',
      '> ```',
      '',
      '> ~~~',
      '> # 未闭合伪标题',
    ].join('\n');

    expect(parseMarkdownOutline(markdown).map(({ text, level }) => ({ text, level }))).toEqual([
      { text: '实标题', level: 1 },
    ]);
  });

  it('与 parseBlockOutline 的 parity：同一 markdown 经 kernel 解析后两侧条目 text/level 一致', () => {
    const markdown = [
      '# 顶层',
      '',
      'Intro',
      'continued',
      '===',
      '',
      '> # 引用标题',
      '',
      '> > ### 嵌套引用',
      '',
      '> ## 引用 *强调* 标题',
      '',
      '> 引用小节',
      '> ---',
      '',
      '> ```',
      '> # 引用内伪标题',
      '> ```',
      '',
      '## 尾部',
    ].join('\n');
    const extensions = buildKernelExtensions({ slashMenu: false, dragHandle: false });
    const doc = parseMarkdown(createMarkdownManager(extensions), markdown);

    const pick = (entries: OutlineEntry[]) => entries.map(({ text, level }) => ({ text, level }));
    expect(pick(parseMarkdownOutline(markdown))).toEqual(pick(parseBlockOutline(doc)));
  });
});

describe('parseBlockOutline（块文档标题提取，无 DOM 依赖）', () => {
  it('从 TipTap JSON 提取 heading 与纯文本，位置符合 ProseMirror 语义', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'intro' }] },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'world', marks: [{ type: 'bold' }] },
          ],
        },
        { type: 'blockquote', content: [{ type: 'heading', attrs: { level: 4 } }] },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Hello world ^block-id' }],
        },
      ],
    };

    expect(parseBlockOutline(doc)).toEqual([
      { id: 'hello-world', level: 2, text: 'Hello world', ordinal: 0, pos: 7 },
      { id: 'heading', level: 4, text: '', ordinal: 1, pos: 21 },
      { id: 'hello-world-2', level: 2, text: 'Hello world', ordinal: 2, pos: 24 },
    ]);
  });

  it('非法或缺失 level 的 heading 节点被忽略', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 7 } },
        { type: 'heading', attrs: {} },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Valid' }] },
      ],
    };

    expect(parseBlockOutline(doc)).toEqual([
      { id: 'valid', level: 2, text: 'Valid', ordinal: 0, pos: 4 },
    ]);
  });

  it('从 ProseMirror document 的 descendants 遍历提取标题位置', () => {
    const nodes = [
      { type: { name: 'paragraph' }, attrs: {}, textContent: 'ignore' },
      {
        type: { name: 'heading' },
        attrs: { level: 3 },
        textContent: 'Runtime heading ^runtime-id',
      },
    ];
    const doc = {
      descendants(visitor: (node: (typeof nodes)[number], pos: number) => void) {
        visitor(nodes[0], 0);
        visitor(nodes[1], 9);
      },
    };

    expect(parseBlockOutline(doc)).toEqual([
      { id: 'runtime-heading', level: 3, text: 'Runtime heading', ordinal: 0, pos: 9 },
    ]);
  });
});

describe('outline id 生成与去重', () => {
  it('生成可读 slug，重复文本追加序号，空文本回退 heading', () => {
    expect(slugifyOutlineText('  中文 Title — A&B  ')).toBe('中文-title-a-b');
    const used = new Map<string, number>();
    expect(createOutlineId('A', used)).toBe('a');
    expect(createOutlineId('A', used)).toBe('a-2');
    expect(createOutlineId('A', used)).toBe('a-3');
    expect(createOutlineId('', used)).toBe('heading');
    // 与字面量 slug 撞名时继续避让，保证集合内唯一。
    expect(createOutlineId('A-2', used)).toBe('a-2-2');
  });
});
