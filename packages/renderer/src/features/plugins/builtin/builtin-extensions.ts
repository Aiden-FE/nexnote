import type { Extension } from '@tiptap/core';
import type { PluginView } from '@nexnote/shared';
import { BUILTIN_PLUGIN_IDS } from '@nexnote/shared';
import {
  MathBlock,
  MathInline,
  MermaidBlock,
  MERMAID_BLOCK_NAME,
  MATH_BLOCK_NAME,
  MATH_INLINE_NAME,
} from '@nexnote/kernel';
import type { SlashMenuItem } from '@nexnote/kernel';
import { createKatexBlockView, createKatexInlineView, createMermaidView } from './node-views';

/**
 * DEV-015 内置插件（Mermaid/KaTeX）的渲染层派生（纯逻辑，浏览器与单测共用）。
 *
 * 内核始终注册 mermaidBlock / mathBlock / mathInline 节点（Markdown 往返能力
 * 随内核在线）；仅当对应内置插件处于 active 时，渲染层才叠加富预览 NodeView
 * 与斜杠菜单入口——禁用后回退为源码视图且菜单不再出现。
 */

export interface BuiltinBlockFlags {
  mermaid: boolean;
  katex: boolean;
}

export function flagsFromActivePlugins(plugins: Pick<PluginView, 'id' | 'state'>[]): BuiltinBlockFlags {
  const active = new Set(plugins.filter((p) => p.state === 'active').map((p) => p.id));
  return {
    mermaid: active.has(BUILTIN_PLUGIN_IDS.mermaid),
    katex: active.has(BUILTIN_PLUGIN_IDS.katex),
  };
}

/** 内置插件激活时叠加的 TipTap 扩展（addNodeView 覆盖内核同名节点的渲染）。 */
export function buildBuiltinViewExtensions(flags: BuiltinBlockFlags): Extension[] {
  const extensions: Extension[] = [];
  if (flags.mermaid) {
    extensions.push(
      MermaidBlock.extend({
        addNodeView() {
          return createMermaidView();
        },
      }) as Extension,
    );
  }
  if (flags.katex) {
    extensions.push(
      MathBlock.extend({
        addNodeView() {
          return createKatexBlockView();
        },
      }) as Extension,
      MathInline.extend({
        addNodeView() {
          return createKatexInlineView();
        },
      }) as Extension,
    );
  }
  return extensions;
}

function mermaidSlashItem(
  id: string,
  title: string,
  source: string,
  keywords: string[],
): SlashMenuItem {
  return {
    id,
    title,
    hint: '```mermaid',
    group: '高级',
    keywords,
    action: ({ view }) => {
      const node = view.state.schema.nodes[MERMAID_BLOCK_NAME]?.create({ source });
      if (!node) return false;
      view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
      return true;
    },
  };
}

/** 斜杠菜单入口：与内核默认项同口径过滤，action 直接派发到 schema 节点。 */
export function buildBuiltinSlashItems(flags: BuiltinBlockFlags): SlashMenuItem[] {
  const items: SlashMenuItem[] = [];
  if (flags.mermaid) {
    items.push(
      mermaidSlashItem('builtin:mermaid-flowchart', '流程图', MermaidBlock.options.flowchartSource, [
        'mermaid',
        '流程',
        'flow',
        'flowchart',
        'chart',
      ]),
      mermaidSlashItem('builtin:mermaid-gantt', '甘特图', MermaidBlock.options.ganttSource, [
        'mermaid',
        '甘特',
        'gantt',
      ]),
    );
  }
  if (flags.katex) {
    items.push(
      {
        id: 'builtin:math-block',
        title: '公式（块级）',
        hint: '$$',
        group: '高级',
        keywords: ['math', '公式', 'latex', 'katex', '块级'],
        action: ({ view }) => {
          const node = view.state.schema.nodes[MATH_BLOCK_NAME]?.create({ source: '' });
          if (!node) return false;
          view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
          return true;
        },
      },
      {
        id: 'builtin:math-inline',
        title: '公式（行内）',
        hint: '$',
        group: '高级',
        keywords: ['math', '公式', 'latex', 'katex', '行内', 'inline'],
        action: ({ view }) => {
          const node = view.state.schema.nodes[MATH_INLINE_NAME]?.create({ source: '' });
          if (!node) return false;
          view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
          return true;
        },
      },
    );
  }
  return items;
}
