import { Node, mergeAttributes } from '@tiptap/core';
import type { MarkdownToken } from '@tiptap/core';

/**
 * Obsidian 双链：`[[页面名|别名]]`（别名可省略，支持 `#标题` / `#^块ID` 子引用）。
 *
 * 内联原子节点；target 保持原文（不做解析），alias 为显示别名。
 */

export interface WikilinkOptions {
  HTMLAttributes: Record<string, unknown>;
  /** 点击行为由渲染层接管（打开目标页面等），内核只转发目标 */
  onActivate?: (target: string) => void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikilink: {
      insertWikilink: (attributes: { target: string; alias?: string | null }) => ReturnType;
    };
  }
}

export const Wikilink = Node.create<WikilinkOptions>({
  name: 'wikilink',

  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { HTMLAttributes: {}, onActivate: undefined };
  },

  addAttributes() {
    return {
      target: {
        default: '' as string,
        parseHTML: (el) => el.getAttribute('data-wikilink-target') ?? '',
        renderHTML: (attrs) => ({ 'data-wikilink-target': attrs.target as string }),
      },
      alias: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute('data-wikilink-alias') || null,
        renderHTML: (attrs) => ({ 'data-wikilink-alias': (attrs.alias as string | null) ?? '' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-wikilink-target]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const alias = (node.attrs.alias as string | null) ?? null;
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'nexnote-wikilink',
        'data-wikilink-target': node.attrs.target as string,
        'data-wikilink-alias': alias ?? '',
        title: node.attrs.target as string,
      }),
      alias ?? (node.attrs.target as string),
    ];
  },

  addNodeView() {
    // 框架无关的最小 node view：点击转发 onActivate（Ctrl/Cmd+点击留给渲染层后续扩展）
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'nexnote-wikilink';
      dom.setAttribute('data-wikilink-target', String(node.attrs.target ?? ''));
      dom.setAttribute('data-wikilink-alias', String(node.attrs.alias ?? ''));
      dom.title = String(node.attrs.target ?? '');
      dom.textContent = (node.attrs.alias as string | null) ?? String(node.attrs.target ?? '');
      dom.addEventListener('click', (e) => {
        if (!e.metaKey && !e.ctrlKey) return;
        this.options.onActivate?.(String(node.attrs.target ?? ''));
      });
      return { dom };
    };
  },

  addCommands() {
    return {
      insertWikilink:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: attributes }),
    };
  },

  markdownTokenizer: {
    name: 'wikilink',
    level: 'inline',

    start(src: string) {
      return src.indexOf('[[');
    },

    tokenize(src: string) {
      // [[target]] / [[target|alias]]；target 内不允许换行与 [[ ]]
      const m = /^\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/.exec(src);
      if (!m) return undefined;
      return {
        type: 'wikilink',
        raw: m[0],
        wikilinkTarget: (m[1] ?? '').trim(),
        wikilinkAlias: m[2] && m[2].length > 0 ? m[2] : undefined,
      };
    },
  },

  parseMarkdown(token: MarkdownToken & { wikilinkTarget?: string; wikilinkAlias?: string }, _helpers) {
    return {
      type: 'wikilink',
      attrs: {
        target: token.wikilinkTarget ?? '',
        alias: token.wikilinkAlias ?? null,
      },
    };
  },

  renderMarkdown(node) {
    const target = (node.attrs?.target as string) || '';
    const alias = (node.attrs?.alias as string | null) ?? null;
    return alias ? `[[${target}|${alias}]]` : `[[${target}]]`;
  },
});
