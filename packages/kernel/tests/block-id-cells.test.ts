// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import {
  buildKernelExtensions,
  createMarkdownManager,
  normalizeForCompare,
  parseMarkdown,
  serializeMarkdown,
} from '../src';

function setup() {
  const extensions = buildKernelExtensions({ slashMenu: false, dragHandle: false });
  return createMarkdownManager(extensions);
}

/** 模拟 UniqueID：给所有段落（含 cell 内段落）挂 blockId 属性。 */
function assignParagraphBlockIds(node: JSONContent, id: () => string): void {
  if (node.type === 'paragraph' && typeof node.attrs?.blockId !== 'string') {
    node.attrs = { ...(node.attrs ?? {}), blockId: id() };
  }
  node.content?.forEach((child) => assignParagraphBlockIds(child, id));
}

function roundTrip(manager: ReturnType<typeof setup>, markdown: string): string {
  const doc = parseMarkdown(manager, markdown);
  return serializeMarkdown(manager, doc);
}

describe('DEV-071 表格单元格 blockId 污染防护', () => {
  it('serialize：cell 内段落 blockId 属性不注入 ^id', () => {
    const manager = setup();
    const doc: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'table',
          attrs: {},
          content: [
            {
              type: 'tableRow',
              attrs: {},
              content: [
                {
                  type: 'tableCell',
                  attrs: {},
                  content: [
                    {
                      type: 'paragraph',
                      attrs: { blockId: 'cellid1' },
                      content: [{ type: 'text', text: 'foo' }],
                    },
                  ],
                },
                {
                  type: 'tableHeader',
                  attrs: {},
                  content: [
                    {
                      type: 'paragraph',
                      attrs: { blockId: 'cellid2' },
                      content: [{ type: 'text', text: 'bar' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = serializeMarkdown(manager, doc);
    expect(out).not.toContain('^cellid1');
    expect(out).not.toContain('^cellid2');
    expect(normalizeForCompare(out)).toContain('foo');
  });

  it('parse：脏数据 cell 内尾部 ^id 被剥除，且二次 round-trip 幂等', () => {
    const manager = setup();
    const dirty = '| foo ^abc123 | bar |\n| --- | --- |\n| x ^xyz789 | y |';
    const doc = parseMarkdown(manager, dirty);
    const out = serializeMarkdown(manager, doc);
    expect(out).not.toContain('^abc123');
    expect(out).not.toContain('^xyz789');

    const doc2 = parseMarkdown(manager, out);
    const out2 = serializeMarkdown(manager, doc2);
    expect(normalizeForCompare(out2)).toBe(normalizeForCompare(out));
  });

  it('parse：整段仅为 ^id 的空单元格污染被剥除', () => {
    const manager = setup();
    const dirty = '| ^onlyid1 | b |\n| --- | --- |\n| a | b |';
    const doc = parseMarkdown(manager, dirty);
    const out = serializeMarkdown(manager, doc);
    expect(out).not.toContain('onlyid1');
    const cellText = JSON.stringify(doc);
    expect(cellText).not.toContain('^onlyid1');
  });

  it('cell 内中部 ^alpha 字面文本保留（用户手写语义）', () => {
    const manager = setup();
    const source = '| 见 ^alpha 说明 | b |\n| --- | --- |\n| a | b |';
    const out = roundTrip(manager, source);
    expect(out).toContain('^alpha');
  });

  it('模拟 UniqueID 补 ID：干净表格打开保存后 cell 不出现 ^id', () => {
    const manager = setup();
    let n = 0;
    const source = '| 名称 | 值 |\n| --- | --- |\n| alpha | 1 |';
    const doc = parseMarkdown(manager, source);
    assignParagraphBlockIds(doc, () => `uid${(n += 1)}`);
    const out = serializeMarkdown(manager, doc);
    expect(out).not.toMatch(/\^uid\d+/);
  });

  it('非表格段落 blockId（^id 后缀）行为不回归', () => {
    const manager = setup();
    const source = '段落正文 ^paragraph-1';
    const doc = parseMarkdown(manager, source);
    expect(doc.content?.[0]?.attrs?.blockId).toBe('paragraph-1');
    const out = roundTrip(manager, source);
    expect(out).toContain('^paragraph-1');
  });

  it('表格整体锚点（独立 ^id 行）行为不回归', () => {
    const manager = setup();
    const source = '| A | B |\n| --- | --- |\n| 1 | 2 |\n^table-1';
    const doc = parseMarkdown(manager, source);
    expect(doc.content?.[0]?.attrs?.blockId).toBe('table-1');
    const out = roundTrip(manager, source);
    expect(out).toContain('^table-1');
  });
});
