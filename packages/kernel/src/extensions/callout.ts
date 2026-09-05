import { Node, mergeAttributes } from '@tiptap/core';
import type { MarkdownToken } from '@tiptap/core';

/**
 * Obsidian callout：`> [!type] Title` + 任意 `>` 引用体。
 *
 * 模型：callout 节点（attrs: type/title）+ block+ 内容。
 * title 为纯文本属性（含内联语法的标题按字面保存，保证 round-trip 不丢失）。
 */

export const CALLOUT_TYPES = [
  'note',
  'abstract',
  'summary',
  'tldr',
  'info',
  'todo',
  'tip',
  'hint',
  'important',
  'success',
  'check',
  'done',
  'question',
  'help',
  'faq',
  'warning',
  'caution',
  'attention',
  'failure',
  'fail',
  'missing',
  'danger',
  'error',
  'bug',
  'example',
  'quote',
  'cite',
] as const;

export type CalloutType = (typeof CALLOUT_TYPES)[number];

function normalizeCalloutType(raw: string): CalloutType {
  const lower = raw.toLowerCase();
  return (CALLOUT_TYPES as readonly string[]).includes(lower) ? (lower as CalloutType) : 'note';
}

export interface CalloutOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** 将当前块（或选区块）转为 callout */
      setCallout: (attributes: { type?: CalloutType; title?: string | null }) => ReturnType;
      /** 切换 callout（已是 callout 则退出为普通段落） */
      toggleCallout: (attributes?: { type?: CalloutType; title?: string | null }) => ReturnType;
    };
  }
}

export const Callout = Node.create<CalloutOptions>({
  name: 'callout',

  group: 'block',
  content: 'block+',
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      type: {
        default: 'note' as CalloutType,
        parseHTML: (el) => normalizeCalloutType(el.getAttribute('data-callout-type') ?? 'note'),
        renderHTML: (attrs) => ({ 'data-callout-type': attrs.type as string }),
      },
      title: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute('data-callout-title') || null,
        renderHTML: (attrs) => ({
          'data-callout-title': (attrs.title as string | null) ?? '',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout-type]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-callout-type': node.attrs.type as string,
        'data-callout-title': (node.attrs.title as string | null) ?? '',
        class: 'nexnote-callout',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCallout:
        (attributes) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attributes),
      toggleCallout:
        (attributes) =>
        ({ commands }) =>
          commands.toggleWrap(this.name, attributes),
    };
  },

  markdownTokenizer: {
    name: 'callout',
    level: 'block',

    start(src: string) {
      // 仅在行首的 `> [!` 处触发（findCalloutAnchor 保证不吞前导空行）
      const m = /^> ?\[!/.exec(src);
      if (m) return 0;
      const idx = src.search(/\n> ?\[!/);
      return idx < 0 ? -1 : idx + 1;
    },

    tokenize(src: string, _tokens: unknown, lexer) {
      const head = /^> ?\[!(\w+)\][ \t]*([^\n]*)/.exec(src);
      if (!head) return undefined;

      const restLines = src.slice(head[0].length).split('\n');
      const bodyLines: string[] = [];
      let i = 1; // restLines[0] 是首行剩余（应为空串）
      while (i < restLines.length && /^>/.test(restLines[i] ?? '')) {
        bodyLines.push((restLines[i] as string).replace(/^> ?/, ''));
        i += 1;
      }
      const raw = head[0] + (i > 1 ? `\n${restLines.slice(1, i).join('\n')}` : '');
      const body = bodyLines.join('\n');

      return {
        type: 'callout',
        raw,
        calloutType: head[1] ?? 'note',
        calloutTitle: (head[2] ?? '').trim(),
        tokens: body.trim() ? lexer.blockTokens(body) : [],
      };
    },
  },

  parseMarkdown(token: MarkdownToken & { calloutType?: string; calloutTitle?: string }, helpers) {
    const title = (token.calloutTitle ?? '').trim();
    return {
      type: 'callout',
      attrs: { type: normalizeCalloutType(token.calloutType ?? 'note'), title: title || null },
      content: helpers.parseChildren(token.tokens ?? []),
    };
  },

  renderMarkdown(node, helpers) {
    const type = (node.attrs?.type as string) || 'note';
    const title = (node.attrs?.title as string | null) ?? '';
    const head = `> [!${type}]${title ? ` ${title}` : ''}`;

    const body = helpers.renderChildren(node.content ?? [], '\n\n');
    // 去掉末尾多余空行后逐行加 `> ` 前缀；空行保留为 `>`
    const normalized = body.replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '');
    const lines = normalized.length === 0 ? [] : normalized.split('\n');
    const quoted = lines.map((line) => (/^\s*$/.test(line) ? '>' : `> ${line}`));
    return quoted.length > 0 ? `${head}\n${quoted.join('\n')}` : head;
  },
});
