import { Node, mergeAttributes } from '@tiptap/core';
import type { MarkdownToken } from '@tiptap/core';

/**
 * Obsidian 内联标签：`#tag`（行首或空白之后才生效，禁止 mid-word 匹配）。
 * 字符集：Unicode 字母/数字、`_`、`-`、`/`（嵌套标签 a/b/c）。
 */

export interface HashtagOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    hashtag: {
      insertHashtag: (attributes: { tag: string }) => ReturnType;
    };
  }
}

/** 标签字符集：Unicode 字母/数字、`_`、`-`、`/`（嵌套标签 a/b/c），与 Obsidian 一致。 */
const TAG_CHARS = /[\p{L}\p{N}_/-]+/u.source;
const TAG_RE = new RegExp(`^#${TAG_CHARS}`, 'u');

export const Hashtag = Node.create<HashtagOptions>({
  name: 'hashtag',

  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      tag: {
        default: '' as string,
        parseHTML: (el) => el.getAttribute('data-hashtag') ?? '',
        renderHTML: (attrs) => ({ 'data-hashtag': attrs.tag as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-hashtag]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const tag = String(node.attrs.tag ?? '');
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'nexnote-hashtag',
        'data-hashtag': tag,
      }),
      `#${tag}`,
    ];
  },

  addCommands() {
    return {
      insertHashtag:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: attributes }),
    };
  },

  markdownTokenizer: {
    name: 'hashtag',
    level: 'inline',

    start(src: string) {
      // 仅当 `#` 位于行首或空白之后才提示起点（mid-word 的 `#` 永不触发）
      const m = /(?:^|\s)#[\p{L}\p{N}_]/u.exec(src);
      if (!m) return -1;
      // m[0] 末尾字符是 `#` 后的首字符，`#` 位于 m[0].length - 2
      return m[0].length - 2;
    },

    tokenize(src: string) {
      const m = TAG_RE.exec(src);
      if (!m) return undefined;
      return {
        type: 'hashtag',
        raw: m[0],
        hashtagTag: m[0].slice(1),
      };
    },
  },

  parseMarkdown(token: MarkdownToken & { hashtagTag?: string }, _helpers) {
    return { type: 'hashtag', attrs: { tag: token.hashtagTag ?? '' } };
  },

  renderMarkdown(node) {
    return `#${(node.attrs?.tag as string) || ''}`;
  },
});
