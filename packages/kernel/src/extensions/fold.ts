import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';

/**
 * 块编辑模式标题章节折叠。
 *
 * 折叠状态只存在于当前 ProseMirror 视图，按稳定 blockId 记录。标题章节边界由
 * 当前顶层 H1–H6 结构实时派生，任何折叠操作都不修改文档或 Markdown。
 */

export interface FoldPluginState {
  folded: ReadonlySet<string>;
}

export const foldPluginKey = new PluginKey<FoldPluginState>('nexnoteFold');

/**
 * 内核单块升降级事务携带的可信 blockId（见 editor.ts convertBlock）：
 * 同一节点改 attrs 时身份确定，折叠状态允许保留并按新层级重算。
 */
const FOLD_TRUSTED_IDS_META = 'nexnoteFoldTrustedIds';

/** 键盘激活后与原生 click 的去重窗口（毫秒）。 */
const KEYBOARD_CLICK_DEDUPE_MS = 500;

/** 每个编辑视图键盘切换后等待重建 chevron 承接焦点的 blockId。 */
const pendingKeyboardFocus = new WeakMap<EditorView, string>();

type FoldMeta =
  | { type: 'toggle'; blockId: string }
  | { type: 'clear' }
  | { type: 'set'; folded: ReadonlySet<string> };

interface TopLevelBlock {
  from: number;
  to: number;
  /** 标题级别（非标题为 null） */
  level: number | null;
  blockId: string | null;
}

interface FoldedSectionRange {
  blockId: string;
  headingIndex: number;
  /** 隐藏区结束块下标（exclusive）。 */
  endIndex: number;
  from: number;
  to: number;
}

function listTopLevelBlocksFromDoc(doc: ProseMirrorNode): TopLevelBlock[] {
  const blocks: TopLevelBlock[] = [];
  doc.forEach((node, offset) => {
    const levelAttr = node.attrs.level;
    blocks.push({
      from: offset,
      to: offset + node.nodeSize,
      level: node.type.name === 'heading' && typeof levelAttr === 'number' ? levelAttr : null,
      blockId: (node.attrs as { blockId?: string }).blockId ?? null,
    });
  });
  return blocks;
}

function listTopLevelBlocks(state: EditorState): TopLevelBlock[] {
  return listTopLevelBlocksFromDoc(state.doc);
}

function topLevelBlockIndexById(blocks: readonly TopLevelBlock[], blockId: string): number {
  return blocks.findIndex((block) => block.blockId === blockId);
}

/** 返回章节结束的块下标（exclusive）。 */
function sectionEndIndex(blocks: readonly TopLevelBlock[], headingIndex: number): number {
  const heading = blocks[headingIndex];
  if (!heading || heading.level == null) return headingIndex + 1;
  for (let i = headingIndex + 1; i < blocks.length; i++) {
    const next = blocks[i]!;
    if (next.level != null && next.level <= heading.level) return i;
  }
  return blocks.length;
}

function hasSectionContent(blocks: readonly TopLevelBlock[], headingIndex: number): boolean {
  return sectionEndIndex(blocks, headingIndex) > headingIndex + 1;
}

function foldedSectionRanges(
  blocks: readonly TopLevelBlock[],
  folded: ReadonlySet<string>,
): FoldedSectionRange[] {
  const ranges: FoldedSectionRange[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const heading = blocks[i]!;
    if (!heading.blockId || heading.level == null || !folded.has(heading.blockId)) continue;
    const end = sectionEndIndex(blocks, i);
    if (end <= i + 1) continue;
    ranges.push({
      blockId: heading.blockId,
      headingIndex: i,
      endIndex: end,
      from: blocks[i + 1]!.from,
      to: blocks[end - 1]!.to,
    });
  }
  return ranges;
}

function hiddenBlockIndexes(
  blocks: readonly TopLevelBlock[],
  folded: ReadonlySet<string>,
): ReadonlySet<number> {
  const hidden = new Set<number>();
  for (const range of foldedSectionRanges(blocks, folded)) {
    for (let i = range.headingIndex + 1; i < range.endIndex; i++) hidden.add(i);
  }
  return hidden;
}

function mergedHiddenRanges(
  blocks: readonly TopLevelBlock[],
  folded: ReadonlySet<string>,
): Array<{ from: number; to: number }> {
  const ranges = foldedSectionRanges(blocks, folded)
    .map(({ from, to }) => ({ from, to }))
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: Array<{ from: number; to: number }> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.to) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function uniqueNodePositionsByBlockId(doc: ProseMirrorNode): Map<string, number[]> {
  const positions = new Map<string, number[]>();
  doc.descendants((node, pos) => {
    const id = (node.attrs as { blockId?: string }).blockId;
    if (!id) return;
    const matches = positions.get(id) ?? [];
    matches.push(pos);
    positions.set(id, matches);
  });
  return positions;
}

/**
 * 文档事务后只保留能可靠映射到同一标题节点的状态。
 * 删除、转非标题、重复 ID、整段替换等无法证明身份的情况全部安全展开。
 */
function reconcileFoldedAfterDocChange(
  tr: Transaction,
  oldState: EditorState,
  folded: ReadonlySet<string>,
): ReadonlySet<string> {
  if (folded.size === 0) return folded;
  const oldBlocks = listTopLevelBlocksFromDoc(oldState.doc);
  const nextBlocks = listTopLevelBlocksFromDoc(tr.doc);
  const oldPositions = uniqueNodePositionsByBlockId(oldState.doc);
  const nextPositions = uniqueNodePositionsByBlockId(tr.doc);
  const retained = new Set<string>();
  const trustedIds = tr.getMeta(FOLD_TRUSTED_IDS_META) as ReadonlySet<string> | undefined;

  for (const blockId of folded) {
    const oldMatches = oldPositions.get(blockId);
    const nextMatches = nextPositions.get(blockId);
    if (oldMatches?.length !== 1 || nextMatches?.length !== 1) continue;

    const oldBlock = oldBlocks.find((block) => block.blockId === blockId);
    const nextBlock = nextBlocks.find((block) => block.blockId === blockId);
    if (!oldBlock || oldBlock.level == null || !nextBlock || nextBlock.level == null) continue;

    // 内核单块升降级/改文本明确声明保留该标题身份（见 editor.ts convertBlock）。
    if (trustedIds?.has(blockId)) {
      retained.add(blockId);
      continue;
    }

    const positionStable = tr.mapping.maps.every((map) => {
      let changed = false;
      map.forEach((oldStart, oldEnd, newStart, newEnd) => {
        if (
          (oldStart <= oldBlock.from && oldBlock.from < oldEnd) ||
          (newStart <= nextBlock.from && nextBlock.from < newEnd)
        ) {
          changed = true;
        }
      });
      return !changed;
    });
    if (positionStable && tr.mapping.map(oldBlock.from, 1) === nextBlock.from)
      retained.add(blockId);
  }

  if (retained.size === folded.size && [...folded].every((id) => retained.has(id))) return folded;
  return retained;
}

/** 标记可信的单标题身份事务，供编辑器命令保留折叠状态。 */
export function trustFoldIdentity(tr: Transaction, blockId: string): void {
  tr.setMeta(FOLD_TRUSTED_IDS_META, new Set([blockId]));
}

/** 可折叠 = 有章节内容的顶层 H1–H6。 */
export function canFoldBlock(state: EditorState, blockId: string): boolean {
  const blocks = listTopLevelBlocks(state);
  const index = topLevelBlockIndexById(blocks, blockId);
  return index >= 0 && blocks[index]?.level != null && hasSectionContent(blocks, index);
}

export function isBlockFolded(state: EditorState, blockId: string): boolean {
  return foldPluginKey.getState(state)?.folded.has(blockId) ?? false;
}

/** 切换折叠；无章节内容、非标题或不存在时返回 false。 */
export function toggleBlockFold(view: EditorView, blockId: string): boolean {
  const state = view.state;
  if (!canFoldBlock(state, blockId)) return false;
  const tr = state.tr;
  if (!isBlockFolded(state, blockId)) {
    const blocks = listTopLevelBlocks(state);
    const index = topLevelBlockIndexById(blocks, blockId);
    const heading = blocks[index];
    const end = sectionEndIndex(blocks, index);
    const lastHidden = blocks[end - 1];
    if (heading && lastHidden) {
      const { from, to } = state.selection;
      if (from < lastHidden.to && to > heading.to) {
        const anchor = Math.min(heading.to - 1, tr.doc.content.size);
        tr.setSelection(TextSelection.create(tr.doc, anchor));
      }
    }
  }
  tr.setMeta(foldPluginKey, { type: 'toggle', blockId } satisfies FoldMeta);
  view.dispatch(tr);
  return true;
}

/** 页面重载/切换时清空临时折叠状态。 */
export function clearBlockFolds(view: EditorView): void {
  if ((foldPluginKey.getState(view.state)?.folded.size ?? 0) === 0) return;
  view.dispatch(view.state.tr.setMeta(foldPluginKey, { type: 'clear' } satisfies FoldMeta));
}

/** 展开当前编辑视图中的全部章节；仅改变 ProseMirror 插件视图状态。 */
export function expandAllBlockFolds(view: EditorView): number {
  const count = foldPluginKey.getState(view.state)?.folded.size ?? 0;
  clearBlockFolds(view);
  return count;
}

/**
 * 显式跳转到文档位置时只展开遮蔽该位置的祖先章节。
 * 目标标题自身的折叠区从其 nodeSize 之后开始，因此会保持折叠。
 */
export function revealBlockFoldAt(view: EditorView, pos: number): void {
  const folded = foldPluginKey.getState(view.state)?.folded ?? new Set<string>();
  if (folded.size === 0) return;
  const concealedBy = foldedSectionRanges(listTopLevelBlocks(view.state), folded).filter(
    (range) => pos >= range.from && pos < range.to,
  );
  if (concealedBy.length === 0) return;
  const next = new Set(folded);
  for (const range of concealedBy) next.delete(range.blockId);
  view.dispatch(
    view.state.tr.setMeta(foldPluginKey, { type: 'set', folded: next } satisfies FoldMeta),
  );
}

function createToggleButton(
  blockId: string,
  folded: boolean,
  getView: () => EditorView | null,
): HTMLButtonElement {
  const action = folded ? '展开章节' : '折叠章节';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'nexnote-fold-toggle';
  const icon = document.createElement('span');
  icon.className = 'nexnote-fold-toggle__icon';
  icon.textContent = '›';
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon);
  button.title = action;
  button.setAttribute('aria-label', action);
  button.setAttribute('aria-expanded', String(!folded));
  button.setAttribute('data-fold-state', folded ? 'collapsed' : 'expanded');
  button.setAttribute('data-fold-id', blockId);
  button.contentEditable = 'false';
  button.draggable = false;
  button.tabIndex = 0;

  let lastKeyToggleAt = 0;
  const toggle = (restoreKeyboardFocus = false) => {
    const view = getView();
    if (!view) return;
    if (restoreKeyboardFocus) pendingKeyboardFocus.set(view, blockId);
    if (!toggleBlockFold(view, blockId)) pendingKeyboardFocus.delete(view);
  };
  button.addEventListener('mousedown', (event) => {
    // 保留正文焦点、光标和选区；按钮仍可由 Tab 获得键盘焦点。
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    lastKeyToggleAt = Date.now();
    toggle(true);
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    // 键盘原生激活可能在 keydown 后再派发 detail=0 的 click，避免双切换。
    if (event.detail === 0 && Date.now() - lastKeyToggleAt < KEYBOARD_CLICK_DEDUPE_MS) return;
    toggle(false);
  });
  return button;
}

/** 为所有有内容的标题绘制 chevron，并隐藏所有折叠祖先覆盖的块。 */
function buildDecorations(
  state: EditorState,
  folded: ReadonlySet<string>,
  getView: () => EditorView | null,
): DecorationSet {
  const decorations: Decoration[] = [];
  const blocks = listTopLevelBlocks(state);
  const hidden = hiddenBlockIndexes(blocks, folded);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (hidden.has(i)) {
      decorations.push(
        Decoration.node(block.from, block.to, {
          class: 'nexnote-fold-hidden',
          'aria-hidden': 'true',
        }),
      );
    }
    if (!block.blockId || block.level == null || !hasSectionContent(blocks, i)) continue;

    const isFolded = folded.has(block.blockId);
    if (isFolded) {
      decorations.push(Decoration.node(block.from, block.to, { class: 'nexnote-folded' }));
    }
    const blockId = block.blockId;
    decorations.push(
      Decoration.widget(
        block.from + 1,
        () => {
          const button = createToggleButton(blockId, isFolded, getView);
          const view = getView();
          if (view && pendingKeyboardFocus.get(view) === blockId) {
            pendingKeyboardFocus.delete(view);
            // ProseMirror 会先把旧 widget 移除；新 widget 插入 DOM 后再承接焦点。
            queueMicrotask(() => {
              if (button.isConnected) button.focus({ preventScroll: true });
            });
          }
          return button;
        },
        {
          side: -1,
          key: `fold-${blockId}-${isFolded ? 'closed' : 'open'}`,
        },
      ),
    );
  }
  return DecorationSet.create(state.doc, decorations);
}

function blockIndexAtPosition(blocks: readonly TopLevelBlock[], pos: number): number {
  const containing = blocks.findIndex((block) => pos >= block.from && pos < block.to);
  if (containing >= 0) return containing;
  return blocks.findIndex((block) => block.from >= pos);
}

/** 上下方向键跨越折叠区，不把光标或键盘扩展选区送入不可见正文。 */
function skipHiddenWithArrow(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;

  const folded = foldPluginKey.getState(view.state)?.folded ?? new Set<string>();
  if (folded.size === 0) return false;
  const blocks = listTopLevelBlocks(view.state);
  const hidden = hiddenBlockIndexes(blocks, folded);
  const current = blockIndexAtPosition(blocks, view.state.selection.head);
  if (current < 0) return false;

  let target = -1;
  let bias: -1 | 1 = 1;
  const currentBlock = blocks[current]!;
  const currentNode = view.state.doc.nodeAt(currentBlock.from);
  const textStart = currentBlock.from + 1;
  const textEnd = Math.max(textStart, currentBlock.to - 1);
  const atTextEnd =
    view.state.selection.head >= textEnd || (currentNode?.textContent.length ?? 0) === 0;
  const atTextStart = view.state.selection.head <= textStart;
  if (event.key === 'ArrowDown' && atTextEnd && hidden.has(current + 1)) {
    target = current + 1;
    while (target < blocks.length && hidden.has(target)) target++;
    bias = 1;
  } else if (event.key === 'ArrowUp' && atTextStart && hidden.has(current - 1)) {
    target = current - 1;
    while (target >= 0 && hidden.has(target)) target--;
    bias = -1;
  }
  const block = blocks[target];
  if (!block) return false;

  if (event.shiftKey) {
    // ProseMirror 的文本选区是连续区间；跨到下一可见块必然把隐藏正文纳入复制。
    // 因此在隐藏边界消费 Shift+Arrow 并保持现有可见选区，而非制造含隐藏文本的范围。
    event.preventDefault();
    return true;
  }
  if (!view.state.selection.empty) return false;

  const boundary = bias > 0 ? block.from : block.to;
  const selection = TextSelection.near(view.state.doc.resolve(boundary), bias);
  event.preventDefault();
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
  return true;
}

/**
 * 可见区鼠标拖选若跨入折叠区，在第一个隐藏边界截断为可见侧选区。
 * Mod+A / `selectAll` 产生的全文选区明确豁免，仍覆盖完整文档。
 */
export function clampMouseSelection(view: EditorView): void {
  const { selection } = view.state;
  // 全文选区（Mod+A / editor.commands.selectAll）明确保持完整文档语义。
  if (selection.from === 0 && selection.to === view.state.doc.content.size) return;
  if (selection.empty) return;
  const folded = foldPluginKey.getState(view.state)?.folded ?? new Set<string>();
  const ranges = mergedHiddenRanges(listTopLevelBlocks(view.state), folded);
  if (ranges.length === 0) return;

  const forward = selection.anchor <= selection.head;
  // 从固定 anchor 朝 head 的方向找首次进入的合并隐藏区。嵌套折叠必须先合并，
  // 否则反向拖选会误取内层 range.to，并丢掉折叠区之后仍可见的正文选择。
  const crossed = forward
    ? ranges.find((range) => selection.anchor < range.to && selection.head > range.from)
    : [...ranges]
        .reverse()
        .find((range) => selection.head < range.to && selection.anchor > range.from);
  if (!crossed) return;

  const boundary = forward ? crossed.from : crossed.to;
  // 吸附到隐藏区外侧的最近合法文本位置，因此保留 anchor 至折叠边界之间的可见选区。
  const target = TextSelection.near(view.state.doc.resolve(boundary), forward ? -1 : 1).head;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, selection.anchor, target)),
  );
}

export const Fold = Extension.create({
  name: 'nexnoteFold',

  addProseMirrorPlugins() {
    // 每编辑器实例一份 view 引用（多面板共存时互不串扰）。
    let viewRef: EditorView | null = null;
    return [
      new Plugin<FoldPluginState>({
        key: foldPluginKey,
        state: {
          init: (): FoldPluginState => ({ folded: new Set<string>() }),
          apply(
            tr: Transaction,
            old: FoldPluginState,
            oldEditorState: EditorState,
          ): FoldPluginState {
            const meta = tr.getMeta(foldPluginKey) as FoldMeta | undefined;
            let folded = old.folded;
            if (meta?.type === 'clear') {
              folded = new Set<string>();
            } else if (meta?.type === 'set') {
              folded = meta.folded;
            } else if (meta?.type === 'toggle') {
              const next = new Set(folded);
              if (next.has(meta.blockId)) next.delete(meta.blockId);
              else next.add(meta.blockId);
              folded = next;
            }
            if (tr.docChanged) {
              folded = reconcileFoldedAfterDocChange(tr, oldEditorState, folded);
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
          handleKeyDown(view, event) {
            return skipHiddenWithArrow(view, event);
          },
        },
        view(editorView) {
          viewRef = editorView;
          let mouseSelecting = false;
          const onMouseDown = (event: MouseEvent) => {
            const target = event.target;
            mouseSelecting =
              event.button === 0 &&
              !(target instanceof Element && target.closest('.nexnote-fold-toggle'));
          };
          const onMouseUp = () => {
            if (!mouseSelecting) return;
            mouseSelecting = false;
            // PM 在 mouseup 后同步 DOM 选区；延后一拍读取最终 selection。
            queueMicrotask(() => {
              if (viewRef === editorView) clampMouseSelection(editorView);
            });
          };
          editorView.dom.addEventListener('mousedown', onMouseDown);
          document.addEventListener('mouseup', onMouseUp);
          return {
            destroy() {
              editorView.dom.removeEventListener('mousedown', onMouseDown);
              document.removeEventListener('mouseup', onMouseUp);
              if (viewRef === editorView) viewRef = null;
            },
          };
        },
      }),
    ];
  },
});
