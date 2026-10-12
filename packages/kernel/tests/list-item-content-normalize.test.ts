// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  buildKernelExtensions,
  createEditor,
  createMarkdownManager,
  normalizeForCompare,
  parseMarkdown,
  serializeMarkdown,
} from '../src';

/**
 * DEV-109：空正文有序列表项 + 缩进块导致 listItem JSON 非法，
 * setMarkdown 抛 `Invalid content for node type listItem`，整页预览渲染失败。
 *
 * 根因：有序列表自定义分词器把「项正文为空 + 缩进块」的全部内容划入 blockLines，
 * 产出的 listItem 以 list/table token 开头（无前置 paragraph），违反
 * `paragraph block*` 约束；JSON 不经校验入库后 UniqueID 补 ID 的 setNodeMarkup
 * 才校验并抛错。
 *
 * 修复：parseMarkdown 管线内 normalizeListItemContent 兜底——首子块不是
 * paragraph 的列表项补一个空 paragraph，JSON 对 schema 合法。
 */

/** 触发形态：`N. `（编号后无正文）下一行跟缩进的列表或表格。 */
const TRIGGER_INPUTS = ['1. \n   - a\n', '1. \n   | t |\n   | - |\n'];

/** 触发形态（空 content 变体）：无正文且无缩进块的有序项，parse 产出 listItem(content: [])。 */
const EMPTY_ITEM_INPUTS = ['1. \n', '1.\n', '1. \n2. b\n', '1. a\n2. \n3. c\n'];

const extensions = buildKernelExtensions({ slashMenu: false, dragHandle: false });

/** 用真实 schema 对全文档节点做 validContent 断言。 */
function assertSchemaValid(kernel: ReturnType<typeof createEditor>): void {
  const doc = kernel.editor.state.doc;
  doc.descendants((node) => {
    if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
      expect(
        node.type.validContent(node.content),
        `listItem 内容必须满足 schema：${JSON.stringify(node.toJSON())}`,
      ).toBe(true);
    }
    return true;
  });
}

describe('DEV-109 · 空正文有序列表项解析', () => {
  for (const markdown of TRIGGER_INPUTS) {
    it(`setMarkdown 全流程不抛错：${JSON.stringify(markdown)}`, () => {
      const kernel = createEditor(document.createElement('div'), {
        initialMarkdown: '',
        slashMenu: false,
        dragHandle: false,
      });
      try {
        expect(() => kernel.setMarkdown(markdown)).not.toThrow();
        assertSchemaValid(kernel);
      } finally {
        kernel.destroy();
      }
    });
  }

  it('parseMarkdown 产出 schema 合法 JSON（listItem 首子块为 paragraph）', () => {
    const manager = createMarkdownManager(extensions);
    const doc = parseMarkdown(manager, '1. \n   - a\n');
    const list = doc.content?.[0];
    expect(list?.type).toBe('orderedList');
    const item = list?.content?.[0];
    expect(item?.type).toBe('listItem');
    expect(item?.content?.[0]?.type).toBe('paragraph');
    // 嵌套列表保留在列表项内容里
    expect(item?.content?.some((c) => c.type === 'bulletList')).toBe(true);
  });

  it('往返稳定：解析 → 序列化幂等，结构保留、锚点不进空段', () => {
    const manager = createMarkdownManager(extensions);
    for (const src of TRIGGER_INPUTS) {
      const doc = parseMarkdown(manager, src);
      const out = serializeMarkdown(manager, doc);
      const doc2 = parseMarkdown(manager, out);
      expect(normalizeForCompare(serializeMarkdown(manager, doc2))).toBe(normalizeForCompare(out));
      // 空段落不得被分配 blockId（锚点无内容承载，与空段锚点丢弃语义一致）
      const item = doc.content?.[0]?.content?.[0];
      const emptyPara = item?.content?.[0];
      if (emptyPara?.type === 'paragraph' && (emptyPara.content ?? []).length === 0) {
        expect(emptyPara.attrs?.blockId ?? null).toBeNull();
      }
    }
  });

  it('非空正文有序项与嵌套列表不回归', () => {
    const manager = createMarkdownManager(extensions);
    const src = '1. 甲\n2. 乙\n   - 乙一\n   - 乙二\n3. 丙\n';
    const doc = parseMarkdown(manager, src);
    const items = doc.content?.[0]?.content ?? [];
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.type).toBe('listItem');
      expect(item.content?.[0]?.type).toBe('paragraph');
    }
    const nested = items[1]?.content?.find((c) => c.type === 'bulletList');
    expect((nested?.content ?? []).length).toBe(2);
  });

  it('createEditor 初始 markdown 为触发形态：挂载即成功，无 Invalid content', () => {
    const kernel = createEditor(document.createElement('div'), {
      initialMarkdown: '1. \n   - a\n',
      slashMenu: false,
      dragHandle: false,
    });
    try {
      assertSchemaValid(kernel);
      expect(kernel.getMarkdown()).toContain('a');
    } finally {
      kernel.destroy();
    }
  });

  for (const markdown of EMPTY_ITEM_INPUTS) {
    it(`孤立空有序项 setMarkdown 不抛错：${JSON.stringify(markdown)}`, () => {
      const kernel = createEditor(document.createElement('div'), {
        initialMarkdown: '',
        slashMenu: false,
        dragHandle: false,
      });
      try {
        expect(() => kernel.setMarkdown(markdown)).not.toThrow();
        assertSchemaValid(kernel);
      } finally {
        kernel.destroy();
      }
    });
  }

  it('孤立空有序项往返稳定：parse → serialize 幂等，不再产出空 content 的 listItem', () => {
    const manager = createMarkdownManager(extensions);
    for (const src of EMPTY_ITEM_INPUTS) {
      const doc = parseMarkdown(manager, src);
      const out = serializeMarkdown(manager, doc);
      const doc2 = parseMarkdown(manager, out);
      expect(normalizeForCompare(serializeMarkdown(manager, doc2))).toBe(normalizeForCompare(out));
      const walk = (node: ReturnType<typeof parseMarkdown>): void => {
        if (node.type === 'listItem' || node.type === 'taskItem') {
          expect(
            node.content?.[0]?.type,
            `listItem 首子块须为 paragraph：${JSON.stringify(node)}`,
          ).toBe('paragraph');
        }
        node.content?.forEach(walk);
      };
      walk(doc);
      walk(doc2);
    }
  });
});
