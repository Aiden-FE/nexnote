import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';

/**
 * 标题折叠（DEV-017 块菜单「折叠/展开」）。
 *
 * - 折叠状态是视图层状态（PM 插件 StateField，按 blockId 记录），不写入 Markdown；
 *   重新打开页面后全部展开（与 Obsidian 默认行为一致）。
 * - 折叠语义：隐藏该标题之后、下一个同级或更高级标题之前的所有顶层块。
 * - 展开入口：折叠标题行首的 ▸ 按钮（mousedown 切换），或再次经块菜单「展开」。
 */

export interface FoldPluginState {
  folded: ReadonlySet<string>;
}

export const foldPluginKey = new PluginKey<FoldPluginState>('nexnoteFold');

interface FoldMeta {
  type: 'toggle';
  blockId: string;
}

interface TopLevelBlock {
  from: number;
  to: number;
  /** 标题级别（非标题为 null） */
  level: number | null;
  blockId: string | null;
}

function listTopLevelBlocks(state: EditorState): TopLevelBlock[] {
  const blocks: TopLevelBlock[] = [];
  state.doc.forEach((node, offset) => {
    blocks.push({
      from: offset,
      to: offset + node.nodeSize,
      level: node.type.name === 'heading' ? (node.attrs.level as number) : null,
      blockId: (node.attrs as { blockId?: string }).blockId ?? null,
    });
  });
  return blocks;
}

/** 可折叠 = 顶层标题块。 */
export function canFoldBlock(state: EditorState, blockId: string): boolean {
  return listTopLevelBlocks(state).some((b) => b.blockId === blockId && b.level != null);
}

export function isBlockFolded(state: EditorState, blockId: string): boolean {
  return foldPluginKey.getState(state)?.folded.has(blockId) ?? false;
}

/** 切换折叠；不可折叠（非标题 / 不存在）返回 false。 */
export function toggleBlockFold(view: EditorView, blockId: string): boolean {
  const state = view.state;
  if (!canFoldBlock(state, blockId)) return false;
  const tr = state.tr;
  if (!isBlockFolded(state, blockId)) {
    // 折叠前把落在隐藏区间内的选区移回标题行末，避免选区指向不可见内容
    const blocks = listTopLevelBlocks(state);
    const idx = blocks.findIndex((b) => b.blockId === blockId && b.level != null);
    if (idx >= 0) {
      const heading = blocks[idx]!;
      const level = heading.level as number;
      let hiddenEnd = -1;
      for (let j = idx + 1; j < blocks.length; j++) {
        const next = blocks[j]!;
        if (next.level != null && next.level <= level) break;
        hiddenEnd = next.to;
      }
      const { from, to } = state.selection;
      if (hiddenEnd > 0 && from < hiddenEnd && to > heading.to) {
        const anchor = Math.min(heading.to - 1, tr.doc.content.size);
        tr.setSelection(TextSelection.create(tr.doc, anchor));
      }
    }
  }
  tr.setMeta(foldPluginKey, { type: 'toggle', blockId } as FoldMeta);
  view.dispatch(tr);
  return true;
}

/** 计算折叠装饰：折叠标题标记 + 行首展开按钮 + 隐藏区间顶层块。 */
function buildDecorations(
  state: EditorState,
  folded: ReadonlySet<string>,
  getView: () => EditorView | null,
): DecorationSet {
  if (folded.size === 0) return DecorationSet.empty;
  const decos: Decoration[] = [];
  const blocks = listTopLevelBlocks(state);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (!block.blockId || !folded.has(block.blockId) || block.level == null) continue;
    const blockId = block.blockId;
    // 折叠标题本身的标记 + 展开按钮（内容起点前，side:-1 排在文本前）
    decos.push(Decoration.node(block.from, block.to, { class: 'nexnote-folded' }));
    decos.push(
      Decoration.widget(
        block.from + 1,
        () => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'nexnote-fold-toggle';
          btn.textContent = '▸';
          btn.title = '展开';
          btn.contentEditable = 'false';
          btn.setAttribute('role', 'button');
          btn.tabIndex = -1;
          let lastKeyToggleAt = 0;
          const toggle = () => {
            const v = getView();
            if (v) toggleBlockFold(v, blockId);
          };
          btn.addEventListener('mousedown', (e) => {
            // 不抢占编辑器焦点/选区；激活统一走 click/keydown
            e.preventDefault();
          });
          btn.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            // 阻止 PM 键映射（Enter 分块/Space 输入）抢占
            e.preventDefault();
            e.stopPropagation();
            lastKeyToggleAt = Date.now();
            toggle();
          });
          btn.addEventListener('click', (e) => {
            // 键盘原生激活可能仍派发 detail=0 的 click：与 keydown 去重，
            // 同时保留 AT/辅助技术的零 detail 点击（无近期 keydown 时生效）
            if (e.detail === 0 && Date.now() - lastKeyToggleAt < 500) return;
            toggle();
          });
          return btn;
        },
        { side: -1, key: `fold-${blockId}` },
      ),
    );
    // 隐藏区间：下一个 level ≤ 当前标题的顶层块之前的所有块
    for (let j = i + 1; j < blocks.length; j++) {
      const next = blocks[j]!;
      if (next.level != null && next.level <= block.level) break;
      decos.push(
        Decoration.node(next.from, next.to, {
          class: 'nexnote-fold-hidden',
          style: 'display:none',
        }),
      );
    }
  }
  return DecorationSet.create(state.doc, decos);
}

export const Fold = Extension.create({
  name: 'nexnoteFold',

  addProseMirrorPlugins() {
    // 每编辑器实例一份 view 引用（多面板共存时互不串扰）
    let viewRef: EditorView | null = null;
    return [
      new Plugin<FoldPluginState>({
        key: foldPluginKey,
        state: {
          init: (): FoldPluginState => ({ folded: new Set<string>() }),
          apply(tr: Transaction, old: FoldPluginState): FoldPluginState {
            const meta = tr.getMeta(foldPluginKey) as FoldMeta | undefined;
            let folded = old.folded;
            if (meta?.type === 'toggle') {
              const next = new Set(folded);
              if (next.has(meta.blockId)) next.delete(meta.blockId);
              else next.add(meta.blockId);
              folded = next;
            }
            if (tr.docChanged && folded.size > 0) {
              // 文档变更后清理已不存在/不再是标题的 blockId，防止状态膨胀
              const alive = new Set<string>();
              tr.doc.forEach((node) => {
                const id = (node.attrs as { blockId?: string }).blockId;
                if (id && node.type.name === 'heading' && folded.has(id)) alive.add(id);
              });
              if (alive.size !== folded.size) folded = alive;
            }
            return folded === old.folded ? old : { folded };
          },
        },
        props: {
          decorations(state) {
            return buildDecorations(
              state,
              foldPluginKey.getState(state)?.folded ?? new Set<string>(),
              () => viewRef,
            );
          },
        },
        view(editorView) {
          viewRef = editorView;
          return {
            destroy() {
              if (viewRef === editorView) viewRef = null;
            },
          };
        },
      }),
    ];
  },
});
