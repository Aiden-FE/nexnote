import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { common, createLowlight } from 'lowlight';
import type { JSONContent, MarkdownToken } from '@tiptap/core';
import { ANCHOR_OPEN, ANCHOR_CLOSE, BLOCK_ID_RE_SOURCE } from '../markdown/block-id';

/**
 * 代码块 / 表格的 `^id` 追加（Obsidian：锚点独立成行，挂在块后）。
 * 段落/标题/列表项的锚点由 markdown/block-id.ts 占位符管道处理。
 */

export const KernelCodeBlock = CodeBlockLowlight.extend({
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
    // 复刻 @tiptap/extension-code-block 的 fence 渲染，再追加独立 `^id` 行
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
}).configure({ lowlight: createLowlight(common), defaultLanguage: 'plaintext' });

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

    // Obsidian 表格锚点是紧跟表格的独立 `^id` 行，会被 marked 的表格词法吞成末行。
    // 预处理已把它换成占位符：末行所有单元格均为空白/仅占位符时，剥掉该行并挂到 table.blockId。
    const placeholderOnly = new RegExp(
      `^[ \t]*${ANCHOR_OPEN}(${BLOCK_ID_RE_SOURCE})${ANCHOR_CLOSE}[ \t]*$`,
    );
    const rows = node.content.filter((r) => r.type === 'tableRow');
    const lastRow = rows[rows.length - 1];
    if (lastRow && Array.isArray(lastRow.content)) {
      const cellTexts = lastRow.content.map((cell) =>
        (cell.content ?? [])
          .map((p) =>
            (p.content ?? []).map((t) => (t.type === 'text' ? t.text ?? '' : '')).join(''),
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
    // 上游表格渲染器会在开头补一个 \n；统一由 doc 级分隔符负责，剥除之
    const parent = BaseTableRenderMarkdown(node, helpers, context);
    const stripped = parent.replace(/^\n+/, '').replace(/\n+$/, '');
    const blockId = node.attrs?.blockId as string | null | undefined;
    if (blockId) return `${stripped}\n^${blockId}`;
    return stripped;
  },
});

// Table 节点的 schema 依赖：行 / 表头 / 单元格必须随内核表格一起注册。
export const KernelTableRow = TableRow;
export const KernelTableHeader = TableHeader;
export const KernelTableCell = TableCell;
