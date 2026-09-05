import { Node, mergeAttributes } from '@tiptap/core';
import type { MarkdownToken } from '@tiptap/core';

/**
 * 元数据头（frontmatter）：文档顶部的 `---\nYAML\n---` 块。
 *
 * Markdown 侧不走路由 tokenizer：由 kernel 管道（markdown/frontmatter.ts）在
 * parse/serialize 外层确定性拆装，保证「只在文档首部」语义与 100% 原文保真。
 * 编辑器内呈现为等宽 YAML 块（code 节点语义），DEV-005 将替换为属性面板。
 */

export interface FrontmatterOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    frontmatter: {
      setFrontmatter: (yaml: string) => ReturnType;
    };
  }
}

export const Frontmatter = Node.create<FrontmatterOptions>({
  name: 'frontmatter',

  group: 'block',
  content: 'text*',
  code: true,
  defining: true,
  isolating: true,
  marks: '',

  addOptions() {
    return { HTMLAttributes: {} };
  },

  parseHTML() {
    return [{ tag: 'pre[data-frontmatter]', preserveWhitespace: 'full' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'pre',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-frontmatter': '',
        class: 'nexnote-frontmatter',
        spellcheck: 'false',
      }),
      ['code', { class: 'nexnote-frontmatter-code' }, 0],
    ];
  },

  addCommands() {
    return {
      setFrontmatter:
        (yaml: string) =>
        ({ commands, state }) => {
          const existing = state.doc.firstChild;
          if (existing?.type.name === this.name) {
            return commands.insertContentAt(0, { type: this.name, content: [{ type: 'text', text: yaml }] });
          }
          return commands.insertContentAt(0, [
            { type: this.name, content: yaml ? [{ type: 'text', text: yaml }] : [] },
            { type: 'paragraph' },
          ]);
        },
    };
  },

  // 注册到 markdown 管理器仅用于占位（实际 parse/serialize 在 kernel 管道层处理）
  parseMarkdown(token: MarkdownToken & { yaml?: string }, helpers) {
    return {
      type: 'frontmatter',
      content: token.yaml ? [helpers.createTextNode(token.yaml)] : [],
    };
  },

  renderMarkdown(node, helpers) {
    return `---\n${helpers.renderChildren(node.content ?? [])}\n---`;
  },
});

/** 从 Markdown 源拆出 frontmatter；返回 null 表示无 frontmatter。 */
export function splitFrontmatter(markdown: string): { yaml: string | null; body: string } {
  const m = /^---[ \t]*\n([\s\S]*?)\n---(?=\n|$)/.exec(markdown);
  if (!m) return { yaml: null, body: markdown };
  return {
    yaml: m[1] ?? '',
    body: markdown.slice(m[0].length).replace(/^\n/, ''),
  };
}

/** 把 frontmatter 节点序列化回 Markdown 头。 */
export function renderFrontmatterMarkdown(yaml: string): string {
  const body = yaml.replace(/\n+$/, '');
  return body.length > 0 ? `---\n${body}\n---\n\n` : '---\n---\n\n';
}
