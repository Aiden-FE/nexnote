import { Node, mergeAttributes, type NodeViewRendererProps } from '@tiptap/core';
import type { MarkdownToken } from '@tiptap/core';
import { formatDisplayDateTime } from '../frontmatter/model';

/**
 * 元数据头（frontmatter）：文档顶部的 `---\nYAML\n---` 块。
 *
 * Markdown 侧不走路由 tokenizer：由 kernel 管道（markdown/frontmatter.ts）在
 * parse/serialize 外层确定性拆装，保证「只在文档首部」语义与 100% 原文保真。
 * 编辑器内呈现为只读的「文档属性头」——created / updated 显示为本地可读时间，
 * 其余字段保持原文；序列化（renderMarkdown）输出节点 text 不变，故字节级保真
 * （DEV-095）。前文注释的「DEV-005 将替换为属性面板」仍准确：内联编辑已统一
 * 收敛到 DocumentPropertiesPopover。
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

  /**
   * 只读的「文档属性头」渲染：created / updated 显示为本地可读时间，其余字段保持原文。
   * 节点 text 仍是原始 YAML，renderMarkdown 直接输出，序列化字节级保真。
   * 不提供 contentDOM → 内联不可编辑（编辑统一收敛到 DocumentPropertiesPopover）。
   */
  addNodeView() {
    // TipTap 把节点、视图、扩展等打包成一个对象传给 NodeView 工厂；取出 node。
    return ({ node }: NodeViewRendererProps) => {
      const dom = document.createElement('pre');
      dom.className = 'nexnote-frontmatter';
      dom.setAttribute('data-frontmatter', '');
      dom.setAttribute('spellcheck', 'false');
      dom.contentEditable = 'false';
      const code = document.createElement('code');
      code.className = 'nexnote-frontmatter-code';
      dom.appendChild(code);

      const render = (yaml: string): void => {
        code.textContent = '';
        const lines = yaml.split('\n');
        for (const line of lines) {
          const row = document.createElement('div');
          row.className = 'nexnote-frontmatter-row';
          // 简单匹配 `key: value`：把 created / updated 的值替换为可读时间，其余原样。
          const m = /^(\s*)([A-Za-z0-9_-]+):\s*(.*?)\s*$/.exec(line);
          if (m && (m[2] === 'created' || m[2] === 'updated')) {
            const indent = m[1] ?? '';
            const key = m[2] ?? '';
            const raw = m[3] ?? '';
            const formatted = formatDisplayDateTime(raw);
            row.appendChild(document.createTextNode(indent));
            row.appendChild(document.createTextNode(`${key}: `));
            const val = document.createElement('span');
            val.className = 'nexnote-frontmatter-time';
            val.textContent = formatted;
            row.appendChild(val);
          } else {
            row.textContent = line;
          }
          code.appendChild(row);
        }
      };
      // 构造时立刻渲染一次：ProseMirror 不会再调用 update(node) 直到下一次 transaction。
      render(node.textContent);
      // TipTap 把 `update(node, decorations, innerDecorations)` 透传给 ProseMirror NodeView；
      // 我们只关心节点 text，故忽略后两个参数。返回 true 表示「结构未变、不重建」。
      return {
        dom,
        update(updatedNode) {
          render(updatedNode.textContent);
          return true;
        },
      };
    };
  },

  addCommands() {
    return {
      setFrontmatter:
        (yaml: string) =>
        ({ commands, state }) => {
          const existing = state.doc.firstChild;
          if (existing?.type.name === this.name) {
            return commands.insertContentAt(0, {
              type: this.name,
              content: [{ type: 'text', text: yaml }],
            });
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
