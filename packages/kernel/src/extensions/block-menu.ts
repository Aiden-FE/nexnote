import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

import type { EditorActionContext } from './action-context';
import { buildMenuDom } from './context-menu';
import type { ContextMenuItem, MenuHandle } from './context-menu';

/**
 * 块菜单（DEV-017）：点击块拖拽手柄弹出，对指针所在整块操作。
 *
 * 复用右键菜单的 DOM 构建器（分隔线/子菜单/position fixed 挂 body）。
 * 打开入口：块菜单的 PM 插件 state 暴露 showAt(view, x, y, blockId)，
 * drag-handle 点击回调经 blockMenuPluginKey.getState(editor.state) 获得——
 * 不依赖 tipTap extension.storage 的快照语义。
 */

export interface BlockMenuContext extends EditorActionContext {
  /** 指针所在顶层块的稳定 blockId（^id） */
  blockId: string;
}

export interface BlockMenuOptions {
  /** 在指针坐标处构造菜单（每次打开实时读取最新注册状态）。 */
  build: (ctx: BlockMenuContext) => ContextMenuItem[];
  onAction: (id: string, ctx: BlockMenuContext) => void;
  className: string;
}

export interface BlockMenuState {
  open: boolean;
  showAt: (view: EditorView, x: number, y: number, blockId: string) => void;
  close: () => void;
}

/** 按顶层块 blockId（^id）在文档中定位块范围（生产/测试都确定）。 */
function blockRangeById(
  view: EditorView,
  blockId: string,
): { from: number; to: number; text: string } | null {
  const { doc } = view.state;
  const pos = 0;
  let hitStart = -1;
  let hitEnd = -1;
  doc.forEach((node, offset) => {
    if (hitStart >= 0) return;
    const start = pos + offset;
    const end = start + node.nodeSize;
    if ((node.attrs as { blockId?: string }).blockId === blockId) {
      hitStart = start;
      hitEnd = end;
    }
  });
  if (hitStart < 0) return null;
  return {
    from: hitStart,
    to: hitEnd,
    text: view.state.doc.textBetween(hitStart, hitEnd, '\n', '\ufffc').trim(),
  };
}

export const blockMenuPluginKey = new PluginKey<BlockMenuState>('nexnoteBlockMenu');

export const BlockMenu = Extension.create<BlockMenuOptions>({
  name: 'nexnoteBlockMenu',

  addOptions() {
    return {
      build: () => [],
      onAction: () => undefined,
      className: 'nexnote-block-menu',
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    let active: MenuHandle | null = null;

    const state: BlockMenuState = {
      open: false,
      showAt(view: EditorView, x: number, y: number, blockId: string) {
        state.close();
        const range = blockRangeById(view, blockId);
        if (!range) return;
        const ctx: BlockMenuContext = {
          view,
          target: 'block',
          from: range.from,
          to: range.to,
          text: range.text,
          blockRange: { from: range.from, to: range.to },
          coords: { top: y, left: x },
          blockId,
        };
        const items = options.build(ctx);
        if (items.length === 0) return;
        active = buildMenuDom(options.className, items, { x, y }, (id) => {
          const snapshot = ctx;
          state.close();
          options.onAction(id, snapshot);
        });
        state.open = true;
      },
      close() {
        active?.destroy();
        active = null;
        state.open = false;
      },
    };

    return [
      new Plugin({
        key: blockMenuPluginKey,
        state: {
          init: () => state,
          apply: (tr, old) => (tr.docChanged ? old : old),
        },
        view() {
          return {
            destroy() {
              state.close();
            },
          };
        },
      }),
    ];
  },
});
