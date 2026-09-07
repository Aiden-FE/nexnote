import { Node, mergeAttributes } from '@tiptap/core';
import type { MarkdownToken } from '@tiptap/core';

/**
 * 插件自定义块（DEV-014 扩展点 1）：
 *
 * 宿主提供 `pluginBlock` 占位 TipTap 节点，渲染时委托给对应插件（renderer 层
 * NodeView 读 data-plugin-id / data-block-type，挂插件视图）。块数据为插件私有的
 * JSON 字符串，宿主只负责承载、选择、调整大小与 Markdown 往返，不解释内容。
 *
 * Markdown 表示：带信息串的围栏代码块（与 DEV-015 Mermaid 同类约定）：
 * ```nexnote-plugin:<pluginId>:<blockType>
 * { ...插件私有 JSON... }
 * ```
 */

export const PLUGIN_BLOCK_FENCE = 'nexnote-plugin';

export interface PluginBlockAttributes {
  pluginId: string;
  blockType: string;
  /** 插件私有数据（JSON 字符串）；渲染/编辑由插件解释。 */
  data: string;
}

const FENCE_RE = new RegExp(
  '^```' + PLUGIN_BLOCK_FENCE + ':([\\w.\\-]+):([\\w.\\-]+)[^\\n]*\\n([\\s\\S]*?)\\n?```',
);

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pluginBlock: {
      /** 在光标处插入一个插件块。 */
      insertPluginBlock: (attributes: Partial<PluginBlockAttributes> & {
        pluginId: string;
        blockType: string;
      }) => ReturnType;
      /** 更新当前/目标插件块的私有数据或类型。 */
      setPluginBlockData: (attributes: { data: string }) => ReturnType;
    };
  }
}

export const PluginBlock = Node.create({
  name: 'pluginBlock',

  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      pluginId: { default: '' },
      blockType: { default: '' },
      data: {
        default: '{}',
        parseHTML: (el) => el.getAttribute('data-plugin-data') ?? '{}',
        renderHTML: (attrs) => ({ 'data-plugin-data': String(attrs.data ?? '{}') }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-plugin-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-plugin-block': '',
        'data-plugin-id': String(HTMLAttributes.pluginId ?? ''),
        'data-block-type': String(HTMLAttributes.blockType ?? ''),
        class: 'nexnote-plugin-block',
      }),
    ];
  },

  addCommands() {
    return {
      insertPluginBlock:
        (attributes) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: { data: '{}', ...attributes },
            })
            .run(),
      setPluginBlockData:
        (attributes) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, attributes),
    };
  },

  markdownTokenizer: {
    name: 'pluginBlock',
    level: 'block',

    start(src: string) {
      const m = FENCE_RE.exec(src);
      if (m) return m.index;
      const idx = src.search(new RegExp('\n```' + PLUGIN_BLOCK_FENCE + ':'));
      return idx < 0 ? -1 : idx + 1;
    },

    tokenize(src: string) {
      const m = FENCE_RE.exec(src);
      if (!m) return undefined;
      const [raw, pluginId, blockType, body] = m;
      return {
        type: 'pluginBlock',
        raw,
        pluginId,
        blockType,
        data: (body ?? '{}').trim(),
      } as MarkdownToken;
    },
  },

  parseMarkdown(token: MarkdownToken) {
    const t = token as MarkdownToken & { pluginId?: string; blockType?: string; data?: string };
    return {
      type: 'pluginBlock',
      attrs: {
        pluginId: t.pluginId ?? '',
        blockType: t.blockType ?? '',
        data: t.data ?? '{}',
      },
    };
  },

  renderMarkdown(node) {
    const pluginId = String(node.attrs?.pluginId ?? '');
    const blockType = String(node.attrs?.blockType ?? '');
    const data = String(node.attrs?.data ?? '{}');
    return '```' + `${PLUGIN_BLOCK_FENCE}:${pluginId}:${blockType}\n${data}\n` + '```';
  },
});
