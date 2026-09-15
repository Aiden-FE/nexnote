import CodeBlock from '@tiptap/extension-code-block';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import type { JSONContent, MarkdownToken } from '@tiptap/core';
import { ANCHOR_OPEN, ANCHOR_CLOSE, BLOCK_ID_RE_SOURCE } from '../markdown/block-id';
import { createCodeHighlightPlugin } from '../highlight/code-highlight-plugin';

/** 代码块 / 表格的 `^id` 追加（Obsidian：锚点独立成行，挂在块后）。 */
export const KernelCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute('data-block-id') || null,
        renderHTML: (attrs) => ({ 'data-block-id': (attrs.blockId as string | null) ?? '' }),
      },
    };
  },

  renderMarkdown(node: JSONContent, helpers) {
    // 复刻 @tiptap/extension-code-block 的 fence 渲染，再追加独立 `^id` 行。
    // 保留原始 language（不把 js 改写成 javascript），保证 Markdown 字节往返。
    const language = (node.attrs?.language as string) || '';
    let output: string;
    if (!node.content) {
      output = `\`\`\`${language}\n\n\`\`\``;
    } else {
      const body = helpers.renderChildren(node.content ?? [], '\n');
      output = [`\`\`\`${language}`, body, '```'].join('\n');
    }
    const blockId = node.attrs?.blockId as string | null | undefined;
    if (blockId) output += `\n^${blockId}`;
    return output;
  },

  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), createCodeHighlightPlugin()];
  },
});

const BaseTableParseMarkdown = Table.config.parseMarkdown!;
const BaseTableRenderMarkdown = Table.config.renderMarkdown!;

export const KernelTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute('data-block-id') || null,
        renderHTML: (attrs) => ({ 'data-block-id': (attrs.blockId as string | null) ?? '' }),
      },
    };
  },

  parseMarkdown(token: MarkdownToken, helpers) {
    const parsed = BaseTableParseMarkdown(token, helpers);
    if (!parsed || Array.isArray(parsed) || 'mark' in parsed) return parsed;
    const node = parsed as JSONContent;
    if (!Array.isArray(node.content)) return node;

    const placeholderOnly = new RegExp(
      `^[ \\t]*${ANCHOR_OPEN}(${BLOCK_ID_RE_SOURCE})${ANCHOR_CLOSE}[ \\t]*$`,
    );
    const rows = node.content.filter((r) => r.type === 'tableRow');
    const lastRow = rows[rows.length - 1];
    if (lastRow && Array.isArray(lastRow.content)) {
      const cellTexts = lastRow.content.map((cell) =>
        (cell.content ?? [])
          .map((p) =>
            (p.content ?? []).map((t) => (t.type === 'text' ? (t.text ?? '') : '')).join(''),
          )
          .join(''),
      );
      const nonEmpty = cellTexts.filter((t) => t.trim().length > 0);
      const m = placeholderOnly.exec(nonEmpty[nonEmpty.length - 1] ?? '');
      if (m && nonEmpty.length === 1) {
        const content = node.content.filter((r) => r !== lastRow);
        return { ...node, attrs: { ...(node.attrs ?? {}), blockId: m[1] }, content };
      }
    }
    return node;
  },

  renderMarkdown(node: JSONContent, helpers, context) {
    const parent = BaseTableRenderMarkdown(node, helpers, context);
    const stripped = parent.replace(/^\n+/, '').replace(/\n+$/, '');
    const blockId = node.attrs?.blockId as string | null | undefined;
    if (blockId) return `${stripped}\n^${blockId}`;
    return stripped;
  },
});

export const KernelTableRow = TableRow;
export const KernelTableHeader = TableHeader;
export const KernelTableCell = TableCell;
