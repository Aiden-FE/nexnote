import { Node, mergeAttributes } from '@tiptap/core';
import type { MarkdownToken } from '@tiptap/core';

/**
 * Mermaid 图表块（DEV-015 内置插件）。
 *
 * Obsidian 兼容：Markdown 形态为带 `mermaid` 语言标记的围栏代码块
 * （```mermaid … ```），因此不引入私有围栏约定，第三方工具可直接识别。
 *
 * 内核只负责承载与 Markdown 往返；编辑/预览 NodeView 由渲染层
 * （内置 Mermaid 插件启用时）挂载。插件禁用时回退为 renderHTML 源码视图，
 * 磁盘往返始终可用（Obsidian 方言能力归内核，不受插件启停影响）。
 */

export const MERMAID_BLOCK_NAME = 'mermaidBlock';
export const MERMAID_LANGUAGE = 'mermaid';

/** 新插入块的示例源码（首次即进入可预览状态，双击可改）。 */
export const MERMAID_DEFAULT_SOURCE = 'graph TD\n  A --> B';

/**
 * 流程图模板（DEV-047）：slash 菜单「流程图」与 insertMermaidFlowchart 命令共用。
 * 同为 Mermaid 源码，序列化仍是标准 ```mermaid 围栏。
 */
export const MERMAID_FLOWCHART_SOURCE = [
  'flowchart TD',
  '  A[开始] --> B{是否继续}',
  '  B -- 是 --> C[执行任务]',
  '  C --> D[结束]',
  '  B -- 否 --> D',
].join('\n');

/** 甘特图模板（DEV-047）：slash 菜单「甘特图」与 insertMermaidGantt 命令共用。 */
export const MERMAID_GANTT_SOURCE = [
  'gantt',
  '  title 项目计划',
  '  dateFormat YYYY-MM-DD',
  '  section 阶段一',
  '  需求分析 :done, a1, 2026-01-05, 7d',
  '  开发实现 :active, a2, after a1, 10d',
  '  section 阶段二',
  '  测试验收 :b1, after a2, 5d',
  '  正式发布 :milestone, b2, after b1, 0d',
].join('\n');

// CommonMark 与 Obsidian 都允许 ``` / ~~~ 围栏；开闭标记必须相同。
const FENCE_RE = new RegExp('^(?:(```|~~~)' + MERMAID_LANGUAGE + '[ \\t]*\\n([\\s\\S]*?)\\n?\\1)');

export interface MermaidBlockOptions {
  flowchartSource: string;
  ganttSource: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mermaidBlock: {
      /** 在光标处插入 Mermaid 图表块（缺省带示例源码）。 */
      insertMermaidBlock: (attributes?: { source?: string }) => ReturnType;
      /** 在光标处插入流程图模板块。 */
      insertMermaidFlowchart: () => ReturnType;
      /** 在光标处插入甘特图模板块。 */
      insertMermaidGantt: () => ReturnType;
      /** 更新当前 Mermaid 块源码。 */
      setMermaidSource: (attributes: { source: string }) => ReturnType;
    };
  }
}

export const MermaidBlock = Node.create<MermaidBlockOptions>({
  name: MERMAID_BLOCK_NAME,

  addOptions() {
    return {
      flowchartSource: MERMAID_FLOWCHART_SOURCE,
      ganttSource: MERMAID_GANTT_SOURCE,
    };
  },

  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      source: {
        default: '' as string,
        parseHTML: (el) => el.getAttribute('data-mermaid-source') ?? '',
        renderHTML: (attrs) => ({ 'data-mermaid-source': String(attrs.source ?? '') }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-mermaid-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const source = String(HTMLAttributes['data-mermaid-source'] ?? '');
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-mermaid-block': '',
        class: 'nexnote-mermaid-block',
      }),
      ['pre', { class: 'nexnote-mermaid-source' }, source],
    ];
  },

  addCommands() {
    return {
      insertMermaidBlock:
        (attributes) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: { source: attributes?.source ?? MERMAID_DEFAULT_SOURCE },
            })
            .run(),
      // 模板命令复用 insertMermaidBlock，保证插入/序列化路径单源。
      insertMermaidFlowchart:
        () =>
        ({ commands }) =>
          commands.insertMermaidBlock({ source: this.options.flowchartSource }),
      insertMermaidGantt:
        () =>
        ({ commands }) =>
          commands.insertMermaidBlock({ source: this.options.ganttSource }),
      setMermaidSource:
        (attributes) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, attributes),
    };
  },

  markdownTokenizer: {
    name: MERMAID_BLOCK_NAME,
    level: 'block',

    start(src: string) {
      if (FENCE_RE.test(src)) return 0;
      const idx = src.search(new RegExp('\\n(?:```|~~~)' + MERMAID_LANGUAGE + '[ \\t]*\\n'));
      return idx < 0 ? -1 : idx + 1;
    },

    tokenize(src: string) {
      const m = FENCE_RE.exec(src);
      if (!m) return undefined;
      return {
        type: MERMAID_BLOCK_NAME,
        raw: m[0],
        mermaidSource: (m[2] ?? '').replace(/\n+$/, ''),
      } as MarkdownToken;
    },
  },

  parseMarkdown(token: MarkdownToken) {
    const t = token as MarkdownToken & { mermaidSource?: string };
    return {
      type: MERMAID_BLOCK_NAME,
      attrs: { source: t.mermaidSource ?? '' },
    };
  },

  renderMarkdown(node) {
    const source = String(node.attrs?.source ?? '');
    return '```' + `${MERMAID_LANGUAGE}\n${source}\n` + '```';
  },
});
