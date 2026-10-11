// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import {
  buildKernelExtensions,
  createEditor,
  createMarkdownManager,
  normalizeForCompare,
  parseMarkdown,
  serializeMarkdown,
} from '../src';

/**
 * DEV-108：行末带格式文本的块 ID 锚点序列化/回收往返。
 *
 * 根因：serialize 侧把锚点占位符追加进段落最后一个文本节点并继承其 marks，
 * 行末带加粗等 mark 时落盘为 `**加粗尾 ^id**`；parse 侧锚点正则只认行末形态，
 * 不命中 → `^id` 泄漏为可见文本，blockId 丢失，下次保存再注入新 ID 逐次增长。
 *
 * 修复：末位文本节点带 mark 时，占位符作为独立的无 mark 文本节点插入，
 * 落盘 `**加粗尾** ^id`（parse 侧认识的行末形态）。
 */

/** 各 inline mark 的落盘包裹形态（与 @tiptap/markdown 序列化器一致）。 */
const MARK_WRAPPERS: Array<{ label: string; marks: Array<Record<string, unknown>>; wrap: (t: string) => string }> = [
  { label: '加粗', marks: [{ type: 'bold' }], wrap: (t) => `**${t}**` },
  { label: '斜体', marks: [{ type: 'italic' }], wrap: (t) => `*${t}*` },
  { label: '删除线', marks: [{ type: 'strike' }], wrap: (t) => `~~${t}~~` },
  { label: '行内代码', marks: [{ type: 'code' }], wrap: (t) => `\`${t}\`` },
];

const collectTexts = (node: JSONContent, out: string[] = []): string[] => {
  if (node.type === 'text' && typeof node.text === 'string') out.push(node.text);
  for (const child of node.content ?? []) collectTexts(child, out);
  return out;
};

describe('DEV-108 · mark 尾随的块 ID 锚点往返', () => {
  for (const { label, marks, wrap } of MARK_WRAPPERS) {
    it(`段落末尾 ${label} + blockId：serialize 落盘锚点在 mark 外，往返可回收`, () => {
      const extensions = buildKernelExtensions({ slashMenu: false, dragHandle: false });
      const manager = createMarkdownManager(extensions);
      const doc: JSONContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { blockId: 'anchor-1' },
            content: [
              { type: 'text', text: '普通 ' },
              { type: 'text', text: '加粗尾', marks },
            ],
          },
        ],
      };
      const output = serializeMarkdown(manager, doc).replace(/\n+$/, '');
      // 锚点必须在 mark 包裹之外、位于行末（parse 侧可回收的形态）
      expect(output).toBe(`普通 ${wrap('加粗尾')} ^anchor-1`);
      const doc2 = parseMarkdown(manager, output);
      expect(doc2.content?.[0]?.attrs?.blockId).toBe('anchor-1');
      // 无泄漏：正文文本里没有 ^id、没有 PUA 占位符
      const texts = collectTexts(doc2);
      expect(texts.join('\n')).not.toContain('^anchor-1');
      expect(texts.join('\n')).not.toMatch(/[\uFFF0\uFFF1]/);
      // 二次往返稳定
      expect(normalizeForCompare(serializeMarkdown(manager, doc2))).toBe(
        normalizeForCompare(output),
      );
    });
  }

  it('末位文本无 mark 时行为不回归：占位符并入该节点（既有形态）', () => {
    const extensions = buildKernelExtensions({ slashMenu: false, dragHandle: false });
    const manager = createMarkdownManager(extensions);
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: 'plain-1' },
          content: [
            { type: 'text', text: '普通 ' },
            { type: 'text', text: '加粗', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' 普通尾' },
          ],
        },
      ],
    };
    const output = serializeMarkdown(manager, doc).replace(/\n+$/, '');
    expect(output).toBe('普通 **加粗** 普通尾 ^plain-1');
    const doc2 = parseMarkdown(manager, output);
    expect(doc2.content?.[0]?.attrs?.blockId).toBe('plain-1');
  });

  it('链接尾随：锚点在链接之外（链接 URL 含 ^ 形态不受影响）', () => {
    const extensions = buildKernelExtensions({ slashMenu: false, dragHandle: false });
    const manager = createMarkdownManager(extensions);
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: 'link-1' },
          content: [
            {
              type: 'text',
              text: '链接尾',
              marks: [{ type: 'link', attrs: { href: 'https://example.com/x^y' } }],
            },
          ],
        },
      ],
    };
    const output = serializeMarkdown(manager, doc).replace(/\n+$/, '');
    // 锚点在 `[…](…)` 之外，不进入 URL/文本
    expect(output).toBe('[链接尾](https://example.com/x^y) ^link-1');
    const doc2 = parseMarkdown(manager, output);
    expect(doc2.content?.[0]?.attrs?.blockId).toBe('link-1');
    expect(collectTexts(doc2).join('\n')).not.toContain('^link-1');
  });

  it('真实 createEditor 重开循环：行末加粗 + blockId 不泄漏、锚点数不增长、ID 稳定', async () => {
    let current = '普通 **加粗尾** ^seed-id-1\n';
    let anchorCount = -1;
    let firstId: string | null = null;
    for (let round = 0; round < 3; round += 1) {
      const kernel = createEditor(document.createElement('div'), {
        initialMarkdown: current,
        slashMenu: false,
        dragHandle: false,
      });
      await vi.waitFor(() => {
        const json = JSON.stringify(kernel.getJSON());
        expect(json).toContain('"blockId"');
      });
      const json = kernel.getJSON();
      // 正文无泄漏：^id 与 PUA 都不得出现在可见文本里
      const visible = kernel.editor.getText();
      expect(visible).not.toMatch(/[\uFFF0\uFFF1]/);
      const attrIds = [...JSON.stringify(json).matchAll(/"blockId":"([A-Za-z0-9-]+)"/g)].map(
        (m) => m[1],
      );
      expect(attrIds.length).toBeGreaterThan(0);
      for (const id of attrIds) {
        expect(visible, `id ${id} 不得出现在正文`).not.toContain(id);
      }
      if (firstId === null) firstId = attrIds[0]!;
      else expect(attrIds).toContain(firstId);
      const saved = kernel.getMarkdown();
      const count = (saved.match(/\^[A-Za-z0-9-]+/g) ?? []).length;
      if (anchorCount === -1) anchorCount = count;
      else expect(count, '锚点数不得逐轮增长').toBe(anchorCount);
      current = saved;
      kernel.destroy();
    }
    expect(firstId).toBe('seed-id-1');
  });

  it('标题与列表项的 mark 尾随锚点同样可回收', () => {
    const extensions = buildKernelExtensions({ slashMenu: false, dragHandle: false });
    const manager = createMarkdownManager(extensions);
    const headingDoc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1, blockId: 'h-1' },
          content: [{ type: 'text', text: '标题尾', marks: [{ type: 'bold' }] }],
        },
      ],
    };
    const hOut = serializeMarkdown(manager, headingDoc);
    expect(hOut).toBe("# **标题尾** ^h-1");
    const h2 = parseMarkdown(manager, hOut);
    expect(h2.content?.[0]?.attrs?.blockId).toBe('h-1');
    expect(collectTexts(h2).join('\n')).not.toContain('^h-1');

    const listDoc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              attrs: { blockId: 'li-1' },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: '项尾', marks: [{ type: 'italic' }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const liOut = serializeMarkdown(manager, listDoc);
    expect(liOut).toBe("- *项尾* ^li-1");
    const li2 = parseMarkdown(manager, liOut);
    const item = li2.content?.[0]?.content?.[0];
    expect(item?.attrs?.blockId).toBe('li-1');
    expect(collectTexts(li2).join('\n')).not.toContain('^li-1');
  });
});
