import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
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
  if (!canFoldBlock(view.state, blockId)) return false;
  const meta: FoldMeta = { type: 'toggle', blockId };
  view.dispatch(view.state.tr.setMeta(foldPluginKey, meta));
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
          btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const view = getView();
            if (view) toggleBlockFold(view, blockId);
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
