import { InputRule, Node, mergeAttributes } from '@tiptap/core';
import type { MarkdownToken } from '@tiptap/core';

/**
 * 数学公式（DEV-015 内置 KaTeX 插件）：块级 $$…$$ + 行内 $…$（Obsidian 方言）。
 *
 * 内核只负责承载与 Markdown 往返；KaTeX 渲染 NodeView 由渲染层在内置插件
 * 启用时挂载，禁用时回退为 renderHTML 源码视图。纯内核环境（测试/无渲染层）
 * 仍保证磁盘往返无损（Obsidian 方言能力归内核，不受插件启停影响）。
 *
 * 块级：$$ 独占整行——多行 $$\n…\n$$ 或单行整段 $$…$$（可至多 3 空格缩进）；
 * 行内：$…$（不跨行）。开闭定界符不得紧贴空白，内容不得为空或以空白
 * 开头结尾，避免货币 `$100`、跨块误配等假阳性。
 */

export const MATH_BLOCK_NAME = 'mathBlock';
export const MATH_INLINE_NAME = 'mathInline';

// 多行：$$ 后换行 … 换行 $$；单行：整行 $$…$$（捕获组 1=多行源码，组 2=单行源码）。
const BLOCK_RE =
  /^[ \t]{0,3}\$\$(?:[ \t]*\n([\s\S]*?)\n[ \t]{0,3}\$\$|[ \t]*([^\n$][^$\n]*?)\$\$)[ \t]*(?=\n|$)/;
// 闭定界符前一个字符必须是非空白且非 $：避免把 `$$x$$` 的定界符吞进内容。
const INLINE_RE = /\$(?![\s$])([^$\n]*?[^\s$])\$(?!\$)/;
/** marked 自定义 inline tokenizer 仅在 src 起始位置匹配（前缀由 start() 切给 inlineText）。 */
const INLINE_AT_START_RE = /^\$(?![\s$])([^$\n]*?[^\s$])\$(?!\$)/;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathBlock: {
      /** 在光标处插入块级公式（缺省空源码，渲染层进入编辑态）。 */
      insertMathBlock: (attributes?: { source?: string }) => ReturnType;
      /** 更新当前块级公式源码。 */
      setMathBlockSource: (attributes: { source: string }) => ReturnType;
    };
    mathInline: {
      /** 在光标处插入行内公式。 */
      insertMathInline: (attributes: { source: string }) => ReturnType;
      /** 更新当前行内公式源码。 */
      setMathInlineSource: (attributes: { source: string }) => ReturnType;
    };
  }
}

export const MathBlock = Node.create({
  name: MATH_BLOCK_NAME,

  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      source: {
        default: '' as string,
        parseHTML: (el) => el.getAttribute('data-math-source') ?? '',
        renderHTML: (attrs) => ({ 'data-math-source': String(attrs.source ?? '') }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-math-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const source = String(HTMLAttributes['data-math-source'] ?? '');
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-math-block': '',
        class: 'nexnote-math-block',
      }),
      ['pre', { class: 'nexnote-math-source' }, `$$\n${source}\n$$`],
    ];
  },

  addCommands() {
    return {
      insertMathBlock:
        (attributes) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: { source: attributes?.source ?? '' },
            })
            .run(),
      setMathBlockSource:
        (attributes) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, attributes),
    };
  },

  addInputRules() {
    return [
      // 整段输入 $$…$$ → 块级公式（行内 $…$ 由 MathInline 规则处理）。
      new InputRule({
        find: /\$\$([^\s$][^$\n]*?)\$\$$/,
        handler: ({ state, range, match }) => {
          const source = match[1];
          if (!source) return null;
          const $pos = state.selection.$from;
          if ($pos.parent.type.name !== 'paragraph') return null;
          // 匹配起点必须位于段首：整段即公式（含空段输入 $$…$$ 的原地升级）。
          if (range.from !== $pos.start()) return null;
          const tr = state.tr;
          tr.replaceRangeWith(
            $pos.before($pos.depth),
            $pos.after($pos.depth),
            this.type.create({ source: source.trim() }),
          );
        },
      }),
    ];
  },

  markdownTokenizer: {
    name: MATH_BLOCK_NAME,
    level: 'block',

    start(src: string) {
      if (BLOCK_RE.test(src)) return 0;
      const idx = src.search(/\n[ \t]{0,3}\$\$/);
      return idx < 0 ? -1 : idx + 1;
    },

    tokenize(src: string) {
      const m = BLOCK_RE.exec(src);
      if (!m) return undefined;
      return {
        type: MATH_BLOCK_NAME,
        raw: m[0],
        mathSource: (m[1] ?? m[2] ?? '').trim(),
      } as MarkdownToken;
    },
  },

  parseMarkdown(token: MarkdownToken) {
    const t = token as MarkdownToken & { mathSource?: string };
    return {
      type: MATH_BLOCK_NAME,
      attrs: { source: t.mathSource ?? '' },
    };
  },

  renderMarkdown(node) {
    return `$$\n${String(node.attrs?.source ?? '')}\n$$`;
  },
});

export const MathInline = Node.create({
  name: MATH_INLINE_NAME,

  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      source: {
        default: '' as string,
        parseHTML: (el) => el.getAttribute('data-math-inline') ?? '',
        renderHTML: (attrs) => ({ 'data-math-inline': String(attrs.source ?? '') }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-math-inline]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const source = String(HTMLAttributes['data-math-inline'] ?? '');
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-math-inline': '',
        class: 'nexnote-math-inline',
      }),
      `$${source}$`,
    ];
  },

  addCommands() {
    return {
      insertMathInline:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { source: attributes.source } }),
      setMathInlineSource:
        (attributes) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, attributes),
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: INLINE_RE,
        handler: ({ state, range, match }) => {
          const source = match[1];
          if (!source) return null;
          const tr = state.tr;
          tr.delete(range.from, range.to);
          tr.insert(range.from, this.type.create({ source }));
        },
      }),
    ];
  },

  markdownTokenizer: {
    name: MATH_INLINE_NAME,
    level: 'inline',

    start(src: string) {
      return src.search(INLINE_RE);
    },

    tokenize(src: string) {
      const m = INLINE_AT_START_RE.exec(src);
      if (!m) return undefined;
      return {
        type: MATH_INLINE_NAME,
        raw: m[0],
        mathSource: (m[1] ?? '').trim(),
      } as MarkdownToken;
    },
  },

  parseMarkdown(token: MarkdownToken) {
    const t = token as MarkdownToken & { mathSource?: string };
    return {
      type: MATH_INLINE_NAME,
      attrs: { source: t.mathSource ?? '' },
    };
  },

  renderMarkdown(node) {
    return `$${String(node.attrs?.source ?? '')}$`;
  },
});
