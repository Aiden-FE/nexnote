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
 *
 * 折叠控件（chevron）从标题内部 ProseMirror widget 迁移为宿主级 overlay
 * （DEV-061）；视图层通过 {@link collectFoldHeadings} 取标题位置/折叠态，
 * 通过 {@link foldPluginKey} 订阅插件状态变化以重定位 overlay。
 *
 * 折叠标题行尾的 `…` 展开按钮（行尾省略号）与悬停 ghost preview 由此插件的
 * ProseMirror widget 装饰提供：折叠态常显差别不再依赖标题整体透明度（DEV-064
 * 移除 `.nexnote-folded opacity 0.88`），折叠 / 展开的可辨性由 gutter chevron
 * 方向 + 行尾可点击 `…` 承担。
 */

export interface FoldPluginState {
  folded: ReadonlySet<string>;
  /** 当前悬停的折叠标题 blockId；null 表示无悬停。Ghost preview 仅对悬停目标显示。 */
  ghost: string | null;
}

export const foldPluginKey = new PluginKey<FoldPluginState>('nexnoteFold');

/**
 * 内核单块升降级事务携带的可信 blockId（见 editor.ts convertBlock）：
 * 同一节点改 attrs 时身份确定，折叠状态允许保留并按新层级重算。
 */
const FOLD_TRUSTED_IDS_META = 'nexnoteFoldTrustedIds';

type FoldMeta =
  | { type: 'toggle'; blockId: string }
  | { type: 'clear' }
  | { type: 'set'; folded: ReadonlySet<string> }
  | { type: 'setFold'; blockId: string; folded: boolean }
  | { type: 'foldToLevel'; level: number }
  | { type: 'ghost'; blockId: string | null };

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

/**
 * 当前光标所在的最深可折叠标题 blockId；光标在不可折叠标题中时回退到祖先标题；
 * 光标位于首标题之前或未在任何章节内时返回 null。
 */
export function currentSectionBlockId(state: EditorState): string | null {
  const blocks = listTopLevelBlocks(state);
  const pos = state.selection.head;
  let bestIndex = -1;
  let bestLevel = -Infinity;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.level == null || !b.blockId || !hasSectionContent(blocks, i)) continue;
    const end = sectionEndIndex(blocks, i);
    const sectionTo = blocks[end - 1]!.to;
    if (pos >= b.from && pos <= sectionTo) {
      if (b.level >= bestLevel) {
        bestIndex = i;
        bestLevel = b.level;
      }
    }
  }
  return bestIndex >= 0 ? blocks[bestIndex]!.blockId : null;
}

/** 取折叠章节内容的纯文本预览（首约 80 字符）。空字符串表示无内容或未折叠。 */
function sectionPreviewText(
  state: EditorState,
  blocks: readonly TopLevelBlock[],
  headingIndex: number,
  max = 80,
): string {
  const end = sectionEndIndex(blocks, headingIndex);
  const parts: string[] = [];
  for (let i = headingIndex + 1; i < end && parts.length < 4; i++) {
    const node = state.doc.nodeAt(blocks[i]!.from);
    if (!node) continue;
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    if (text) parts.push(text);
  }
  const joined = parts.join(' · ');
  return joined.length > max ? `${joined.slice(0, max)}…` : joined;
}

/**
 * 折叠指定 blockId 标题（幂等）。无章节内容或不存在时返回 false。
 * 折叠前若光标落在即将隐藏的章节内，安全移回标题行尾。
 */
export function foldBlockSection(view: EditorView, blockId: string): boolean {
  if (!canFoldBlock(view.state, blockId)) return false;
  if (isBlockFolded(view.state, blockId)) return false;
  return toggleBlockFold(view, blockId);
}

/** 展开指定 blockId 标题（幂等）。无章节内容或不存在时返回 false。 */
export function expandBlockSection(view: EditorView, blockId: string): boolean {
  if (!canFoldBlock(view.state, blockId)) return false;
  if (!isBlockFolded(view.state, blockId)) return false;
  return toggleBlockFold(view, blockId);
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

/**
 * 折叠到指定层级：把所有 `level <= level` 且有章节内容的标题折叠，
 * 其余清空展开。同时把落在新隐藏区里的选区安全移回所属标题行尾。
 */
export function foldBlocksToLevel(view: EditorView, level: number): number {
  const blocks = listTopLevelBlocks(view.state);
  const target = new Set<string>();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (!b.blockId || b.level == null || b.level > level) continue;
    if (!hasSectionContent(blocks, i)) continue;
    target.add(b.blockId);
  }
  const foldedRanges = foldedSectionRanges(blocks, target);
  const tr = view.state.tr;
  let selection = view.state.selection;
  for (const range of foldedRanges) {
    if (selection.from < range.to && selection.to > range.from) {
      const heading = blocks[range.headingIndex]!;
      const anchor = Math.min(heading.to - 1, tr.doc.content.size);
      selection = TextSelection.create(tr.doc, anchor);
      break;
    }
  }
  if (selection !== view.state.selection) tr.setSelection(selection);
  tr.setMeta(foldPluginKey, { type: 'set', folded: target } satisfies FoldMeta);
  view.dispatch(tr);
  return target.size;
}

/** 顶层标题位置描述（渲染层 overlay 据此放置 chevron）。 */
export interface FoldHeadingDescriptor {
  blockId: string;
  level: number;
  /** 标题块文档位置。 */
  from: number;
  to: number;
  /** 标题当前是否处于折叠态。 */
  folded: boolean;
  /** 折叠/展开章节的中文标签，供 accessible name 使用。 */
  actionLabel: string;
}

/**
 * 取当前文档中所有可折叠标题的描述（稳定数组，可直接订阅 foldPluginKey 重算）。
 * 渲染层宿主 overlay 用此数组定位 chevron DOM，避免在标题内部嵌入 widget。
 */
export function collectFoldHeadings(state: EditorState): FoldHeadingDescriptor[] {
  const blocks = listTopLevelBlocks(state);
  const folded = foldPluginKey.getState(state)?.folded ?? new Set<string>();
  const out: FoldHeadingDescriptor[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (!block.blockId || block.level == null || !hasSectionContent(blocks, i)) continue;
    const isFolded = folded.has(block.blockId);
    out.push({
      blockId: block.blockId,
      level: block.level,
      from: block.from,
      to: block.to,
      folded: isFolded,
      actionLabel: isFolded ? '展开章节' : '折叠章节',
    });
  }
  return out;
}

/**
 * 折叠标题行尾装饰：行尾可点击 `…` 省略号 +（悬停时）内联 ghost preview。
 *
 * - 折叠态下渲染 widget；点击省略号或 ghost preview 调用 toggleBlockFold 展开。
 * - 悬停状态由 foldPluginState.ghost 提供；其变化由插件 view() 的 mouseover/mouseout
 *   监听派发，并仅对当前 fold.ghost 命中的标题渲染 ghost 文本。
 * - DEV-064：折叠/展开的常显差别由此装饰与宿主 overlay chevron 共同承担，
 *   标题节点不再附加 opacity 样式。
 */
function buildTailWidget(state: EditorState, block: TopLevelBlock, ghost: string | null) {
  const blocks = listTopLevelBlocks(state);
  const headingIndex = topLevelBlockIndexById(blocks, block.blockId!);
  const preview =
    ghost === block.blockId && headingIndex >= 0
      ? sectionPreviewText(state, blocks, headingIndex)
      : '';
  return (view: EditorView): HTMLElement => {
    const wrap = document.createElement('span');
    wrap.className = 'nexnote-fold-tail';
    wrap.contentEditable = 'false';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nexnote-fold-ellipsis';
    button.textContent = '…';
    button.title = '展开章节';
    button.setAttribute('aria-label', '展开章节');
    button.tabIndex = -1;
    button.setAttribute('data-fold-ellipsis', block.blockId ?? '');
    const onPress = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (block.blockId) toggleBlockFold(view, block.blockId);
    };
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener('click', onPress);
    wrap.append(button);
    if (preview) {
      const ghostNode = document.createElement('span');
      ghostNode.className = 'nexnote-fold-ghost';
      ghostNode.textContent = preview;
      ghostNode.setAttribute('aria-hidden', 'true');
      ghostNode.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      ghostNode.addEventListener('click', onPress);
      wrap.append(ghostNode);
    }
    return wrap;
  };
}

/**
 * 顶层标题层级描述（DEV-061：渲染层即便内容长度变化也能稳定定位 chevron 列）。
 * 不渲染按钮，仅为 ProseMirror 节点附加 aria 标签/语义锚点，便于 overlay 锚定。
 */
function buildDecorations(state: EditorState, folded: ReadonlySet<string>): DecorationSet {
  const decorations: Decoration[] = [];
  const blocks = listTopLevelBlocks(state);
  const hidden = hiddenBlockIndexes(blocks, folded);
  const ghost = foldPluginKey.getState(state)?.ghost ?? null;

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
    if (
      !block.blockId ||
      block.level == null ||
      !hasSectionContent(blocks, i) ||
      !folded.has(block.blockId)
    ) {
      continue;
    }
    // 节点层 `nexnote-folded` 类仅作为状态 / 辅助选择器锚点；可视差别由行尾省略号与
    // gutter chevron 共同承担，DEV-064 已移除对应的 opacity 规则。
    decorations.push(Decoration.node(block.from, block.to, { class: 'nexnote-folded' }));
    const tailPos = Math.max(block.from + 1, block.to - 1);
    decorations.push(
      Decoration.widget(tailPos, buildTailWidget(state, block, ghost), {
        side: 1,
        ignoreSelection: true,
        // key 稳定时 ProseMirror 复用 widget DOM，避免悬停 ghost 重建打断 mouseout。
        key: `fold-tail-${block.blockId}${ghost === block.blockId ? ':ghost' : ''}`,
      }),
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

/** 块菜单"折叠章节 / 展开章节"动作的可选切换入口（位于块菜单面板）。 */
export function toggleFoldActionLabel(state: EditorState, blockId: string): string {
  if (!canFoldBlock(state, blockId)) return '该标题无可折叠章节';
  return isBlockFolded(state, blockId) ? '展开章节' : '折叠章节';
}

/** 代理：把块菜单/键盘触发的切换请求转交给当前视图。 */
export function toggleFoldById(view: EditorView, blockId: string): boolean {
  return toggleBlockFold(view, blockId);
}

function clampGhost(folded: ReadonlySet<string>, ghost: string | null): string | null {
  if (ghost == null) return null;
  return folded.has(ghost) ? ghost : null;
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

export const Fold = Extension.create({
  name: 'nexnoteFold',

  addProseMirrorPlugins() {
    // 每编辑器实例一份 view 引用（多面板共存时互不串扰）。
    let viewRef: EditorView | null = null;
    return [
      new Plugin<FoldPluginState>({
        key: foldPluginKey,
        state: {
          init: (): FoldPluginState => ({ folded: new Set<string>(), ghost: null }),
          apply(
            tr: Transaction,
            old: FoldPluginState,
            oldEditorState: EditorState,
          ): FoldPluginState {
            const meta = tr.getMeta(foldPluginKey) as FoldMeta | undefined;
            let folded = old.folded;
            let ghost = old.ghost;
            if (meta?.type === 'clear') {
              folded = new Set<string>();
            } else if (meta?.type === 'set') {
              folded = meta.folded;
            } else if (meta?.type === 'toggle') {
              const next = new Set(folded);
              if (next.has(meta.blockId)) next.delete(meta.blockId);
              else next.add(meta.blockId);
              folded = next;
            } else if (meta?.type === 'setFold') {
              const next = new Set(folded);
              if (meta.folded) next.add(meta.blockId);
              else next.delete(meta.blockId);
              folded = next;
            } else if (meta?.type === 'foldToLevel') {
              const blocks = listTopLevelBlocksFromDoc(tr.doc);
              const next = new Set<string>();
              for (let i = 0; i < blocks.length; i++) {
                const b = blocks[i]!;
                if (!b.blockId || b.level == null || b.level > meta.level) continue;
                const end = sectionEndIndex(blocks, i);
                if (end <= i + 1) continue;
                next.add(b.blockId);
              }
              folded = next;
            } else if (meta?.type === 'ghost') {
              ghost = meta.blockId;
            }
            if (tr.docChanged) {
              folded = reconcileFoldedAfterDocChange(tr, oldEditorState, folded);
            }
            ghost = clampGhost(folded, ghost);
            if (folded === old.folded && ghost === old.ghost) return old;
            return { folded, ghost };
          },
        },
        props: {
          decorations(state) {
            return buildDecorations(
              state,
              foldPluginKey.getState(state)?.folded ?? new Set<string>(),
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
              // 标题内部不再有 widget；命中 overlay 按钮（位于宿主 gutter）时仍允许拖选，
              // 由 overlay 自身的 click 监听消费，不在这里拦截。
              !(target instanceof Element && target.closest('.nexnote-fold-overlay__toggle'));
          };
          const onMouseUp = () => {
            if (!mouseSelecting) return;
            mouseSelecting = false;
            // PM 在 mouseup 后同步 DOM 选区；延后一拍读取最终 selection。
            queueMicrotask(() => {
              if (viewRef === editorView) clampMouseSelection(editorView);
            });
          };
          const dispatchGhost = (blockId: string | null) => {
            const current = foldPluginKey.getState(editorView.state);
            if (!current || current.ghost === blockId) return;
            editorView.dispatch(
              editorView.state.tr.setMeta(foldPluginKey, {
                type: 'ghost',
                blockId,
              } satisfies FoldMeta),
            );
          };
          const onMouseOver = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const heading = target.closest('[blockId]');
            if (!heading) {
              dispatchGhost(null);
              return;
            }
            const blockId = heading.getAttribute('blockId');
            if (!blockId) return;
            const state = foldPluginKey.getState(editorView.state);
            if (!state || !state.folded.has(blockId)) {
              dispatchGhost(null);
              return;
            }
            dispatchGhost(blockId);
          };
          const onMouseOut = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const heading = target.closest('[blockId]');
            if (!heading) return;
            const related = event.relatedTarget as Element | null;
            if (related && heading.contains(related)) return;
            const blockId = heading.getAttribute('blockId');
            if (!blockId) return;
            const state = foldPluginKey.getState(editorView.state);
            if (state?.ghost === blockId) dispatchGhost(null);
          };
          editorView.dom.addEventListener('mousedown', onMouseDown);
          document.addEventListener('mouseup', onMouseUp);
          editorView.dom.addEventListener('mouseover', onMouseOver);
          editorView.dom.addEventListener('mouseout', onMouseOut);
          return {
            destroy() {
              editorView.dom.removeEventListener('mousedown', onMouseDown);
              document.removeEventListener('mouseup', onMouseUp);
              editorView.dom.removeEventListener('mouseover', onMouseOver);
              editorView.dom.removeEventListener('mouseout', onMouseOut);
              if (viewRef === editorView) viewRef = null;
            },
          };
        },
      }),
    ];
  },
});
