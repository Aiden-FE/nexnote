// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import {
  buildKernelExtensions,
  createEditor,
  createMarkdownManager,
  createSaveScheduler,
  normalizeForCompare,
  parseMarkdown,
  serializeMarkdown,
} from '../src';

interface RoundTripCase {
  name: string;
  markdown: string;
  /** 允许格式规范化，但要求二次 round-trip 稳定 + JSON 语义稳定。 */
  compareSource?: boolean;
  assertDoc?: (doc: JSONContent) => void;
}

const commonmarkGfmCases: RoundTripCase[] = [
  { name: 'ATX 标题', markdown: '# 一级\n\n## 二级\n\n###### 六级' },
  { name: '段落', markdown: '第一段\n\n第二段' },
  { name: '无序列表', markdown: '- 甲\n- 乙\n  - 乙一' },
  { name: '有序列表起始号', markdown: '3. 三\n4. 四' },
  { name: '任务列表', markdown: '- [ ] 待办\n- [x] 完成' },
  {
    name: 'GFM 表格',
    markdown: '| 名称 | 值 |\n| --- | ---: |\n| alpha | 1 |',
  },
  { name: '围栏代码块', markdown: '```typescript\nconst a = 1\n```' },
  { name: '代码块内锚点字面量', markdown: '```text\n^not-an-anchor\n```' },
  { name: '引用', markdown: '> 引用第一行\n> 引用第二行' },
  { name: '嵌套引用', markdown: '> 外层\n> > 内层' },
  { name: '图片', markdown: '![替代文本](https://example.com/image.png "标题")' },
  { name: '外部链接', markdown: '[文字](https://example.com "链接标题")' },
  { name: '分隔线', markdown: '上\n\n---\n\n下' },
  { name: '粗体', markdown: '普通 **粗体** 普通' },
  { name: '斜体', markdown: '普通 *斜体* 普通' },
  { name: '删除线', markdown: '普通 ~~删除~~ 普通' },
  { name: '行内代码', markdown: '普通 `const x = 1` 普通' },
  { name: '行内代码含反引号', markdown: '普通 ``a`b`` 普通' },
  { name: '格式嵌套', markdown: '**粗体内 *斜体*** 与 ~~删除 `代码`~~' },
  { name: '硬换行', markdown: '第一行  \n第二行' },
  { name: '转义字符', markdown: '星号 \\*不是斜体\\*' },
  { name: '中英文混排', markdown: '中文 **bold** English `代码` 混排' },
];

const obsidianCases: RoundTripCase[] = [
  {
    name: 'wikilink',
    markdown: '参见 [[页面名称]]',
    assertDoc: (doc) => expect(JSON.stringify(doc)).toContain('"type":"wikilink"'),
  },
  {
    name: 'wikilink 别名',
    markdown: '参见 [[页面名称|显示别名]]',
    assertDoc: (doc) => {
      expect(JSON.stringify(doc)).toContain('"target":"页面名称"');
      expect(JSON.stringify(doc)).toContain('"alias":"显示别名"');
    },
  },
  { name: 'wikilink 子标题', markdown: '参见 [[页面#小节]] 与 [[页#^abc|块别名]]' },
  {
    name: '内联标签',
    markdown: '正文 #标签 与 #nested/tag',
    assertDoc: (doc) => expect(JSON.stringify(doc)).toContain('"type":"hashtag"'),
  },
  {
    name: 'frontmatter',
    markdown: '---\ntitle: 测试\ntags: [alpha, beta]\naliases:\n  - 别名\n---\n\n正文',
    assertDoc: (doc) => {
      expect(doc.content?.[0]?.type).toBe('frontmatter');
      expect(doc.content?.[0]?.content?.[0]?.text).toContain('tags: [alpha, beta]');
    },
  },
  {
    name: 'callout note + title',
    markdown: '> [!note] 提示标题\n> 正文 **加粗**',
    assertDoc: (doc) => {
      expect(doc.content?.[0]?.type).toBe('callout');
      expect(doc.content?.[0]?.attrs).toMatchObject({ type: 'note', title: '提示标题' });
    },
  },
  {
    name: 'callout warning 无标题',
    markdown: '> [!warning]\n> 注意事项',
  },
  {
    name: 'callout 多段',
    markdown: '> [!info] 多段\n> 第一段\n>\n> 第二段',
  },
  {
    name: 'callout 嵌套列表',
    markdown: '> [!todo] 清单\n> - 甲\n> - 乙',
  },
  {
    name: '标题 block ID',
    markdown: '# 标题 ^heading-1',
    assertDoc: (doc) => expect(doc.content?.[0]?.attrs?.blockId).toBe('heading-1'),
  },
  {
    name: '段落 block ID',
    markdown: '段落正文 ^paragraph-1',
    assertDoc: (doc) => expect(doc.content?.[0]?.attrs?.blockId).toBe('paragraph-1'),
  },
  {
    name: '列表项 block ID',
    markdown: '- 列表项 ^item-1',
    assertDoc: (doc) => {
      const item = doc.content?.[0]?.content?.[0];
      expect(item?.attrs?.blockId).toBe('item-1');
    },
  },
  {
    name: '代码块 standalone block ID',
    markdown: '```js\nconst x = 1\n```\n^code-1',
    assertDoc: (doc) => expect(doc.content?.[0]?.attrs?.blockId).toBe('code-1'),
  },
  {
    name: '表格 standalone block ID',
    markdown: '| A | B |\n| --- | --- |\n| 1 | 2 |\n^table-1',
    assertDoc: (doc) => expect(doc.content?.[0]?.attrs?.blockId).toBe('table-1'),
  },
  {
    name: '方言组合文档',
    markdown:
      '---\ntitle: 组合\ntags: [mvp]\n---\n\n# 组合页面 ^h1\n\n正文含 [[目标|别名]] 与 #标签 ^p1\n\n> [!tip] 技巧\n> 内容',
  },
];

function runCase(c: RoundTripCase): { output: string; doc: JSONContent; doc2: JSONContent } {
  const extensions = buildKernelExtensions({ slashMenu: false, dragHandle: false });
  const manager = createMarkdownManager(extensions);
  const doc = parseMarkdown(manager, c.markdown);
  const output = serializeMarkdown(manager, doc);
  const doc2 = parseMarkdown(manager, output);
  const output2 = serializeMarkdown(manager, doc2);

  c.assertDoc?.(doc);
  expect(normalizeForCompare(output2), `${c.name}: 二次输出必须稳定`).toBe(
    normalizeForCompare(output),
  );
  expect(doc2, `${c.name}: 语义 JSON 必须稳定`).toEqual(doc);
  if (c.compareSource !== false) {
    expect(normalizeForCompare(output), `${c.name}: 源与输出必须等价`).toBe(
      normalizeForCompare(c.markdown),
    );
  }
  return { output, doc, doc2 };
}

describe('Round-trip 验证矩阵', () => {
  for (const c of commonmarkGfmCases) {
    it(`CommonMark/GFM · ${c.name}`, () => {
      runCase(c);
    });
  }

  for (const c of obsidianCases) {
    it(`Obsidian · ${c.name}`, () => {
      runCase(c);
    });
  }

  it('输出验收统计（CommonMark/GFM 100%，Obsidian ≥95%）', () => {
    let commonPass = 0;
    let obsidianPass = 0;
    for (const c of commonmarkGfmCases) {
      runCase(c);
      commonPass += 1;
    }
    for (const c of obsidianCases) {
      runCase(c);
      obsidianPass += 1;
    }
    const commonRate = (commonPass / commonmarkGfmCases.length) * 100;
    const obsidianRate = (obsidianPass / obsidianCases.length) * 100;
    console.info(
      `[round-trip] CommonMark/GFM ${commonPass}/${commonmarkGfmCases.length} = ${commonRate.toFixed(1)}%; ` +
        `Obsidian ${obsidianPass}/${obsidianCases.length} = ${obsidianRate.toFixed(1)}%`,
    );
    expect(commonRate).toBe(100);
    expect(obsidianRate).toBeGreaterThanOrEqual(95);
  });
});

describe('Editor kernel 事务与保存', () => {
  it('用户文档变更立即触发 onDocChange，早于防抖保存', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const kernel = createEditor(document.createElement('div'), {
      initialMarkdown: '# 标题\n',
      slashMenu: false,
      dragHandle: false,
      saveDelayMs: 100,
      onDocChange: () => events.push('doc-change'),
      onContentChange: () => events.push('save'),
    });

    expect(events).toEqual([]);
    expect(kernel.editor.commands.insertContent('用户输入')).toBe(true);
    expect(events).toEqual(['doc-change']);

    await vi.advanceTimersByTimeAsync(100);
    expect(events).toEqual(['doc-change', 'save']);

    kernel.setMarkdown('# 程序化重载\n');
    expect(events).toEqual(['doc-change', 'save']);
    await kernel.flushPendingSave();
    expect(events).toEqual(['doc-change', 'save']);

    kernel.destroy();
    vi.useRealTimers();
  });

  it('打开非常规 Markdown 不触发保存（UniqueID 初始化补 ID 非用户编辑）', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const saved: string[] = [];
    const kernel = createEditor(container, {
      initialMarkdown:
        '---\ntitle: x\n---\n\n# 标题\n\n*  宽列表标记\n\n行尾双空格   \n硬换行\n\n~~~js\ncode\n~~~\n',
      slashMenu: false,
      dragHandle: false,
      saveDelayMs: 1,
      onContentChange: (md) => saved.push(md),
    });

    await vi.waitFor(() => {
      expect(kernel.editor.isInitialized).toBe(true);
      const ids = (kernel.getJSON().content ?? [])
        .map((b) => b.attrs?.blockId)
        .filter((id) => typeof id === 'string' && id.length > 0);
      expect(ids.length).toBeGreaterThan(0);
    });
    await kernel.flushPendingSave();
    // UniqueID 确实补了 ID（初始化事务发生过），但它不得被当成用户编辑调度保存。
    expect(saved).toEqual([]);
    expect(kernel.getRevision()).toBe(0);

    // 真实编辑仍然正常保存。
    expect(kernel.editor.commands.insertContent('用户编辑')).toBe(true);
    await kernel.flushPendingSave();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toContain('用户编辑');

    kernel.destroy();
    container.remove();
  });

  it('块拖拽等价事务可重排，保存后重开顺序与 block ID 一致', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const saved: string[] = [];
    const kernel = createEditor(container, {
      initialMarkdown: '第一块 ^a1\n\n第二块 ^b2\n\n第三块 ^c3',
      slashMenu: false,
      dragHandle: false,
      saveDelayMs: 1,
      onContentChange: (md) => saved.push(md),
    });

    expect(kernel.moveBlock('c3', 'a1', 'before')).toBe(true);
    await kernel.flushPendingSave();
    expect(saved.at(-1)?.indexOf('第三块')).toBeLessThan(saved.at(-1)?.indexOf('第一块') ?? 0);

    const reopened = createEditor(document.createElement('div'), {
      initialMarkdown: saved.at(-1),
      slashMenu: false,
      dragHandle: false,
    });
    const blocks = reopened.getJSON().content ?? [];
    expect(blocks.map((b) => b.attrs?.blockId)).toEqual(['c3', 'a1', 'b2']);
    expect(normalizeForCompare(reopened.getMarkdown())).toBe(
      normalizeForCompare(saved.at(-1) ?? ''),
    );

    reopened.destroy();
    kernel.destroy();
    container.remove();
  });

  it('undo/redo 恢复块顺序，revision 单调递增', () => {
    const kernel = createEditor(document.createElement('div'), {
      initialMarkdown: 'A ^a\n\nB ^b',
      slashMenu: false,
      dragHandle: false,
    });
    expect(kernel.getRevision()).toBe(0);
    expect(kernel.moveBlock('b', 'a')).toBe(true);
    const changed = kernel.getMarkdown();
    expect(changed.indexOf('B')).toBeLessThan(changed.indexOf('A'));
    expect(kernel.getRevision()).toBeGreaterThan(0);

    expect(kernel.undo()).toBe(true);
    expect(kernel.getMarkdown().indexOf('A')).toBeLessThan(kernel.getMarkdown().indexOf('B'));
    expect(kernel.redo()).toBe(true);
    expect(kernel.getMarkdown().indexOf('B')).toBeLessThan(kernel.getMarkdown().indexOf('A'));
    kernel.destroy();
  });

  it('保存调度器防抖、flush、cancel', async () => {
    vi.useFakeTimers();
    const saved: string[] = [];
    const scheduler = createSaveScheduler({ delayMs: 100, onSave: (md) => saved.push(md) });
    scheduler.schedule('v1');
    scheduler.schedule('v2');
    expect(scheduler.hasPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(99);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toEqual(['v2']);
    scheduler.schedule('v3');
    await scheduler.flush();
    expect(saved).toEqual(['v2', 'v3']);
    let release!: () => void;
    const inFlight = createSaveScheduler({
      delayMs: 1,
      onSave: () => new Promise<void>((resolve) => (release = resolve)),
    });
    inFlight.schedule('slow');
    await vi.advanceTimersByTimeAsync(1);
    let flushed = false;
    const flush = inFlight.flush().then(() => (flushed = true));
    await Promise.resolve();
    expect(flushed).toBe(false);
    release();
    await flush;
    expect(flushed).toBe(true);

    scheduler.schedule('v4');
    scheduler.cancel();
    await vi.runAllTimersAsync();
    expect(saved).toEqual(['v2', 'v3']);
    vi.useRealTimers();
  });
});

describe('DEV-044 块 ID 锚点泄漏防御', () => {
  const PUA_RE = /[\uFFF0\uFFF1]/;
  const collectTexts = (node: JSONContent, out: string[] = []): string[] => {
    if (node.type === 'text' && typeof node.text === 'string') out.push(node.text);
    for (const child of node.content ?? []) collectTexts(child, out);
    return out;
  };

  it('taskList(blockId) + 文档末尾空 paragraph(blockId) 往返：无 ID/PUA 进 text，空尾段不并入 taskItem', () => {
    const extensions = buildKernelExtensions({ slashMenu: false, dragHandle: false });
    const manager = createMarkdownManager(extensions);
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false, blockId: 'task-1' },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '待办内容' }] }],
            },
          ],
        },
        { type: 'paragraph', attrs: { blockId: 'trailing-empty' }, content: [] },
      ],
    };
    const output = serializeMarkdown(manager, doc);
    // 序列化不得产出可被 lazy continuation 吸收的独立 ` ^id` 锚点行
    expect(output).not.toMatch(/^[ \t]*\^[A-Za-z0-9-]+\s*$/m);
    const doc2 = parseMarkdown(manager, output);
    const texts = collectTexts(doc2);
    expect(texts.join('\n')).not.toMatch(PUA_RE);
    expect(texts.join('\n')).not.toContain('trailing-empty');
    const taskItem = doc2.content?.[0]?.content?.[0];
    expect(taskItem?.type).toBe('taskItem');
    expect(taskItem?.attrs?.blockId).toBe('task-1');
    // 空尾段不得作为续段并入 taskItem
    expect(taskItem?.content?.every((c) => c.type === 'paragraph')).toBe(true);
    expect((taskItem?.content ?? []).length).toBe(1);
    // 二次往返稳定
    const output2 = serializeMarkdown(manager, doc2);
    expect(normalizeForCompare(output2)).toBe(normalizeForCompare(output));
  });

  it('`- [ ] 待办 ^id1` + 空行 + ` ^id2` 直接 parse：id2 不得进入任何 text 节点', () => {
    const extensions = buildKernelExtensions({ slashMenu: false, dragHandle: false });
    const manager = createMarkdownManager(extensions);
    const doc = parseMarkdown(manager, '- [ ] 待办内容 ^id1\n\n ^id2');
    const texts = collectTexts(doc);
    expect(texts.join('\n')).not.toMatch(PUA_RE);
    expect(texts.join('\n')).not.toContain('id2');
    const taskItem = doc.content?.[0]?.content?.[0];
    expect(taskItem?.attrs?.blockId).toBe('id1');
  });

  it('lazy continuation 吸收形态（无空行）也能确定性回收，不泄漏 PUA', () => {
    const extensions = buildKernelExtensions({ slashMenu: false, dragHandle: false });
    const manager = createMarkdownManager(extensions);
    // 历史污染文件形态：` ^id2` 紧随其后，无空行，被吸收进 taskItem 首段
    const doc = parseMarkdown(manager, '- [ ] 待办内容 ^id1\n ^id2');
    const texts = collectTexts(doc);
    expect(texts.join('\n')).not.toMatch(PUA_RE);
    expect(texts.join('\n')).not.toContain('id1');
    expect(texts.join('\n')).not.toContain('id2');
    const taskItem = doc.content?.[0]?.content?.[0];
    expect(taskItem?.attrs?.blockId).toBe('id1');
  });

  it('真实 createEditor（trailingNode + UniqueID）：重开循环正文无泄漏、锚点数不增长', async () => {
    const makeKernel = (md: string) => {
      const kernel = createEditor(document.createElement('div'), {
        initialMarkdown: md,
        slashMenu: false,
        dragHandle: false,
      });
      return kernel;
    };
    let current = '- [ ] 任务甲\n';
    let anchorCount = -1;
    for (let round = 0; round < 3; round += 1) {
      const kernel = makeKernel(current);
      await vi.waitFor(() => {
        const blocks = kernel.getJSON().content ?? [];
        expect(
          blocks.some((b) => typeof b.attrs?.blockId === 'string' && b.attrs.blockId.length > 0),
        ).toBe(true);
      });
      expect(kernel.editor.getText()).not.toMatch(/[\uFFF0\uFFF1]/);
      // UniqueID 生成的随机 id 不得出现在正文文本里
      const generatedIds = collectTexts(kernel.getJSON());
      expect(generatedIds.join('')).not.toMatch(/[\uFFF0\uFFF1]/);
      const json = JSON.stringify(kernel.getJSON());
      const attrIds = [...json.matchAll(/"blockId":"([a-z0-9]+)"/g)].map((m) => m[1]);
      expect(attrIds.length).toBeGreaterThan(0);
      const visibleText = kernel.editor.getText();
      for (const id of attrIds) {
        expect(visibleText).not.toContain(id);
      }
      const saved = kernel.getMarkdown();
      expect(saved).not.toMatch(/^[ \t]*\^[A-Za-z0-9-]+\s*$/m);
      const count = (saved.match(/\^[A-Za-z0-9-]+/g) ?? []).length;
      if (anchorCount === -1) anchorCount = count;
      else expect(count).toBe(anchorCount);
      current = saved;
      kernel.destroy();
    }
  });

  it('历史污染文件往返幂等：首次序列化无空白差异（` ^id2` 回收）', () => {
    const extensions = buildKernelExtensions({ slashMenu: false, dragHandle: false });
    const manager = createMarkdownManager(extensions);
    const doc = parseMarkdown(manager, '- [ ] 待办内容 ^id1\n\n ^id2');
    const output = serializeMarkdown(manager, doc);
    expect(output).toBe('- [ ] 待办内容 ^id1');
    // 幂等：再次 parse→serialize 完全一致
    const doc2 = parseMarkdown(manager, output);
    expect(serializeMarkdown(manager, doc2)).toBe(output);
  });

  it('普通 ASCII 段落不会被误识别为裸锚点', () => {
    const extensions = buildKernelExtensions({ slashMenu: false, dragHandle: false });
    const manager = createMarkdownManager(extensions);
    const source = '中文段落\n\nHello\n\n2024';
    const doc = parseMarkdown(manager, source);
    const output = serializeMarkdown(manager, doc);
    expect(output).not.toContain('^Hello');
    expect(output).not.toContain('^2024');
    expect(doc.content?.map((node) => node.attrs?.blockId)).not.toContain('Hello');
    expect(doc.content?.map((node) => node.attrs?.blockId)).not.toContain('2024');
  });

  it('用户手写 ^aonubg8xf 字样保留（锚点形态与行中字面量均不误删）', () => {
    const extensions = buildKernelExtensions({ slashMenu: false, dragHandle: false });
    const manager = createMarkdownManager(extensions);
    const doc = parseMarkdown(manager, '行中字面 ^aonubg8xf 保留\n\n行尾锚点 ^aonubg8xf');
    const texts = collectTexts(doc);
    expect(texts.join('\n')).toContain('^aonubg8xf');
    const output = serializeMarkdown(manager, doc);
    expect(output).toContain('aonubg8xf');
  });
});

describe('文件名 ↔ H1 标题绑定纯函数', () => {
  it('文件名生成初始 H1，并保留 frontmatter 在首部', async () => {
    const title = (await import('../../renderer/src/stores/tab-store')).titleFromPath(
      'folder/My Page.md',
    );
    const { bindH1ToTitle, firstH1 } = await import('../../renderer/src/stores/tab-store');
    const output = bindH1ToTitle('---\ntags: [x]\n---\n\n正文', title);
    expect(output).toBe('---\ntags: [x]\n---\n\n# My Page\n\n正文');
    expect(firstH1(output)).toBe('My Page');
  });

  it('修改 H1 推导同目录新路径，并清理非法文件名字符', async () => {
    const { pagePathForTitle, sanitizePageTitle } =
      await import('../../renderer/src/stores/tab-store');
    expect(sanitizePageTitle(' 新/标题:*? ')).toBe('新-标题---');
    expect(pagePathForTitle('notes/旧标题.md', '新标题')).toBe('notes/新标题.md');
  });
});
