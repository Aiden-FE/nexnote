import { syntaxTree } from '@codemirror/language';
import {
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Transaction,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  WidgetType,
  gutter,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

/**
 * Markdown 标题章节折叠（DEV-055，ADR-0013）。
 *
 * 折叠是 CodeMirror 视图状态：按源码内稳定的标题身份（整数 id，与文本/slug 无关）记录，
 * 不修改文档、undo 历史或保存语义。源码视图与分栏编辑侧共享同一编辑器实例，因此状态
 * 天然连续；预览与实时预览不装配本扩展，始终完整渲染。
 */

/** 源码标题：tab 生命周期内的临时身份，绝不写入 Markdown。 */
export interface SourceHeading {
  id: number;
  /** 标题首行行首（ATX 为 `#` 行，Setext 为文本首行）。 */
  from: number;
  /** 可见标题末行行尾（Setext 不含下划线行）。 */
  to: number;
  level: number;
  /** blockquote 内标题：参与目录但首期不折叠，避免跨引用边界。 */
  quoted: boolean;
  /** 章节边界：下一个同级或更高级标题（含引用标题）的 from，或文档末尾。 */
  end: number;
  /** 标题之后是否存在非空白章节内容；无内容则不提供 disclosure。 */
  content: boolean;
}

interface FoldState {
  headings: readonly SourceHeading[];
  folded: ReadonlySet<number>;
  decorations: DecorationSet;
  nextId: number;
}

const toggleFold = StateEffect.define<number>();
const clearFolds = StateEffect.define<void>();
const revealFoldAt = StateEffect.define<number>();
/** 键盘切换后等待 gutter 重建按钮承接焦点的标题 id。 */
const pendingFocus = new WeakMap<EditorView, number>();
/** 键盘激活后与原生 click 的去重窗口（毫秒）。 */
const KEYBOARD_CLICK_DEDUPE_MS = 500;

/**
 * 从完整 Markdown 语法树解析标题。fenced code、frontmatter、HTML 块里形似标题的行
 * 不是标题；ATX H1-H6 与 Setext H1/H2 均产出（Setext 边界取文本末行而非下划线行）。
 */
export function parseSourceHeadings(state: EditorState): SourceHeading[] {
  const headings: SourceHeading[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      const atx = /^ATXHeading([1-6])$/.exec(node.name);
      const setext = /^SetextHeading([12])$/.exec(node.name);
      if (!atx && !setext) return;
      let ancestor = node.node.parent;
      let quoted = false;
      while (ancestor) {
        if (ancestor.name === 'Blockquote') quoted = true;
        ancestor = ancestor.parent;
      }
      // The Setext node includes its underline. Only its final line belongs to the visible heading.
      const to = state.doc.lineAt(Math.max(node.from, node.to - 1)).to;
      headings.push({
        id: 0,
        from: state.doc.lineAt(node.from).from,
        to,
        level: Number((atx ?? setext)![1]),
        quoted,
        end: to,
        content: false,
      });
    },
  });
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!;
    if (heading.quoted) continue;
    const boundary = headings.find(
      (other, index) => index > i && !other.quoted && other.level <= heading.level,
    );
    heading.end = boundary?.from ?? state.doc.length;
    // Blank separators by themselves are not section content.
    heading.content = state.sliceDoc(heading.to, heading.end).trim().length > 0;
  }
  return headings;
}

/**
 * 文档事务后的身份调和：只有「旧行首映射后恰好命中唯一新标题」才保留折叠状态。
 * 整文档替换（外部重载/setText）、合并、多义位置等一律展开，绝不折叠错误章节。
 * 层级变化（#→##）行首不动，身份保留并按新层级立即重算边界。
 */
function reconcile(
  tr: Transaction,
  previous: FoldState,
  headings: readonly SourceHeading[],
): number {
  let nextId = previous.nextId;
  let replacedDocument = false;
  tr.changes.iterChangedRanges((from, to) => {
    if (from === 0 && to === tr.startState.doc.length) replacedDocument = true;
  }, true);
  const used = new Set<number>();
  if (!replacedDocument) {
    for (const old of previous.headings) {
      // 标题单行内的普通键入（改名、清空、增减 #）可靠保留身份；跨行替换、移动或
      // 合并无法证明仍是同一标题，安全展开而不是把状态套到错误章节。
      let ambiguous = false;
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        if (toA < old.from || fromA > old.to) return;
        if (fromA < old.from || toA > old.to || inserted.lines > 1) ambiguous = true;
      });
      if (ambiguous) continue;
      const mapped = tr.changes.mapPos(old.from, -1);
      const candidates = headings.filter((heading) => heading.from === mapped);
      if (candidates.length !== 1 || used.has(candidates[0]!.from)) continue;
      // Untouched later headings may shift through mapping. A changed heading is allowed only
      // through the deliberate single-line case above (rename or # count change).
      candidates[0]!.id = old.id;
      used.add(mapped);
    }
  }
  for (const heading of headings) if (!heading.id) heading.id = nextId++;
  return nextId;
}

/** 折叠产生的隐藏替换区（按标题分组；嵌套折叠时外层吸收内层，子状态保留待重开）。 */
function hiddenRanges(headings: readonly SourceHeading[], folded: ReadonlySet<number>) {
  const ranges: Array<{ id: number; from: number; to: number }> = [];
  for (const heading of headings) {
    if (!folded.has(heading.id) || !heading.content) continue;
    if (ranges.some((range) => heading.from >= range.from && heading.from < range.to)) continue;
    ranges.push({ id: heading.id, from: heading.to, to: heading.end });
  }
  return ranges;
}

/** 折叠占位符：非可选中文本，承载「章节已折叠」语义。 */
class FoldPlaceholder extends WidgetType {
  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-heading-fold-placeholder';
    span.textContent = '…';
    span.setAttribute('aria-label', '章节已折叠');
    return span;
  }
}

const foldPlaceholder = new FoldPlaceholder();

function decorationsFor(headings: readonly SourceHeading[], folded: ReadonlySet<number>) {
  return Decoration.set(
    hiddenRanges(headings, folded).map(({ from, to }) =>
      Decoration.replace({ widget: foldPlaceholder }).range(from, to),
    ),
    true,
  );
}

/** 折叠状态字段：不写文档、不进 undo 历史；解析失败 fail-open 全部展开。 */
export const sourceHeadingFoldField = StateField.define<FoldState>({
  create(state) {
    try {
      const headings = parseSourceHeadings(state);
      headings.forEach((heading, index) => (heading.id = index + 1));
      return {
        headings,
        folded: new Set(),
        decorations: Decoration.none,
        nextId: headings.length + 1,
      };
    } catch {
      // 初始解析失败同样 fail-open：编辑器仍可显示、编辑和保存原文。
      return { headings: [], folded: new Set(), decorations: Decoration.none, nextId: 1 };
    }
  },
  update(value, tr) {
    let headings = value.headings;
    let nextId = value.nextId;
    let folded = value.folded;
    if (tr.docChanged) {
      try {
        headings = parseSourceHeadings(tr.state);
        nextId = reconcile(tr, value, headings);
        const valid = new Set(headings.filter((h) => !h.quoted && h.content).map((h) => h.id));
        folded = new Set([...folded].filter((id) => valid.has(id)));
      } catch {
        // Parsing/rendering must never block editing or save. Uncertain identities fail open.
        headings = [];
        folded = new Set();
      }
    }
    for (const effect of tr.effects) {
      if (effect.is(clearFolds)) folded = new Set();
      if (effect.is(revealFoldAt)) {
        const covered = headings.filter(
          (heading) =>
            folded.has(heading.id) && effect.value > heading.to && effect.value < heading.end,
        );
        if (covered.length) {
          folded = new Set(folded);
          for (const heading of covered) (folded as Set<number>).delete(heading.id);
        }
      }
      if (effect.is(toggleFold)) {
        const heading = headings.find((h) => h.id === effect.value && !h.quoted && h.content);
        if (!heading) continue;
        folded = new Set(folded);
        if (folded.has(heading.id)) (folded as Set<number>).delete(heading.id);
        else (folded as Set<number>).add(heading.id);
      }
    }
    if (headings === value.headings && folded === value.folded) return value;
    try {
      return { headings, folded, nextId, decorations: decorationsFor(headings, folded) };
    } catch {
      return { headings, folded: new Set(), nextId, decorations: Decoration.none };
    }
  },
  provide: (field) => EditorView.decorations.from(field, (state) => state.decorations),
});

export function sourceFoldState(state: EditorState): FoldState | null {
  try {
    return state.field(sourceHeadingFoldField, false) ?? null;
  } catch {
    // 未装配扩展、测试替身或解析失败均按「无折叠」处理，不阻断编辑/导航。
    return null;
  }
}

/** 目录/锚点跳转：只展开遮蔽目标的祖先章节；目标自身折叠状态保持。 */
export function revealSourceHeadingAt(view: EditorView, pos: number): void {
  if (!sourceFoldState(view.state)?.folded.size) return;
  view.dispatch({ effects: revealFoldAt.of(pos) });
}

class DisclosureSpacer extends GutterMarker {
  override toDOM(): HTMLElement {
    const spacer = document.createElement('span');
    spacer.className = 'cm-heading-fold-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    spacer.textContent = '›';
    return spacer;
  }
}

/** gutter disclosure：低视觉权重 chevron，Tab 可达，Enter/Space 激活。 */
class Disclosure extends GutterMarker {
  constructor(
    readonly id: number,
    readonly folded: boolean,
  ) {
    super();
  }
  override eq(other: GutterMarker) {
    return other instanceof Disclosure && this.id === other.id && this.folded === other.folded;
  }
  override toDOM(view: EditorView) {
    const button = document.createElement('button');
    const action = this.folded ? '展开章节' : '折叠章节';
    button.type = 'button';
    button.className = 'cm-heading-fold-toggle';
    button.textContent = '›';
    button.title = action;
    button.setAttribute('aria-label', action);
    button.setAttribute('aria-expanded', String(!this.folded));
    button.setAttribute('data-fold-state', this.folded ? 'collapsed' : 'expanded');
    button.setAttribute('data-fold-id', String(this.id));
    button.tabIndex = 0;
    let lastKeyToggleAt = 0;
    const activate = (keyboard: boolean) => {
      if (keyboard) pendingFocus.set(view, this.id);
      const heading = sourceFoldState(view.state)?.headings.find((h) => h.id === this.id);
      if (!heading?.content) {
        pendingFocus.delete(view);
        return;
      }
      // 光标整体在可见区时保持不动；光标会落入隐藏章节时移回标题行末，避免悬空光标。
      const selection = view.state.selection.main;
      const collapsing = !sourceFoldState(view.state)?.folded.has(this.id);
      const fullDocumentSelection = selection.from === 0 && selection.to === view.state.doc.length;
      const intersectsHiddenSection = selection.from < heading.end && selection.to > heading.to;
      view.dispatch({
        effects: toggleFold.of(this.id),
        // Mod+A explicitly retains full-document semantics; all other selections that would
        // include/leave a hidden endpoint return to the visible heading boundary.
        ...(collapsing && intersectsHiddenSection && !fullDocumentSelection
          ? { selection: { anchor: heading.to } }
          : {}),
      });
    };
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      lastKeyToggleAt = Date.now();
      activate(true);
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.detail === 0 && Date.now() - lastKeyToggleAt < KEYBOARD_CLICK_DEDUPE_MS) return;
      activate(false);
    });
    if (pendingFocus.get(view) === this.id) {
      pendingFocus.delete(view);
      queueMicrotask(() => {
        if (button.isConnected) button.focus({ preventScroll: true });
      });
    }
    return button;
  }
}

/**
 * Markdown 源码/分栏编辑侧的标题章节折叠扩展。
 * 源码与分栏共享同一 CodeMirror 实例与状态字段，因此同一 tab 内切换视图折叠状态连续。
 */
export function sourceHeadingFolding(): Extension {
  const markers = ViewPlugin.fromClass(
    class {
      markers: RangeSet<GutterMarker> = RangeSet.empty;
      constructor(view: EditorView) {
        this.build(view);
      }
      update(update: ViewUpdate) {
        if (
          update.viewportChanged ||
          sourceFoldState(update.startState) !== sourceFoldState(update.state)
        )
          this.build(update.view);
      }
      build(view: EditorView) {
        const model = sourceFoldState(view.state);
        const builder = new RangeSetBuilder<GutterMarker>();
        for (const heading of model?.headings ?? []) {
          if (
            heading.quoted ||
            !heading.content ||
            heading.from < view.viewport.from ||
            heading.from > view.viewport.to
          )
            continue;
          if (
            model!.headings.some(
              (parent) =>
                model!.folded.has(parent.id) &&
                heading.from > parent.to &&
                heading.from < parent.end,
            )
          )
            continue;
          builder.add(
            heading.from,
            heading.from,
            new Disclosure(heading.id, model!.folded.has(heading.id)),
          );
        }
        this.markers = builder.finish();
      }
    },
  );
  return [
    sourceHeadingFoldField,
    EditorView.atomicRanges.of(
      (view) => sourceFoldState(view.state)?.decorations ?? Decoration.none,
    ),
    markers,
    gutter({
      class: 'cm-heading-fold-gutter',
      markers: (view) => view.plugin(markers)?.markers ?? RangeSet.empty,
      initialSpacer: () => new DisclosureSpacer(),
    }),
    keymap.of([
      {
        key: 'ArrowDown',
        run: (view) => skipFolded(view, 1, false),
        shift: (view) => skipFolded(view, 1, true),
      },
      {
        key: 'ArrowUp',
        run: (view) => skipFolded(view, -1, false),
        shift: (view) => skipFolded(view, -1, true),
      },
    ]),
    EditorView.domEventHandlers({
      mouseup: (_event, view) => {
        queueMicrotask(() => clampSourceMouseSelection(view));
        return false;
      },
    }),
  ];
}

/** 上下方向键在隐藏边界跳到折叠区另一侧，不把光标送入不可见正文。 */
function skipFolded(view: EditorView, direction: 1 | -1, shift: boolean): boolean {
  const model = sourceFoldState(view.state);
  if (!model?.folded.size) return false;
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const ranges = hiddenRanges(model.headings, model.folded);
  const boundary = direction === 1 ? line.to : line.from;
  if (head !== boundary) return false;
  const range = ranges.find(({ from, to }) =>
    direction === 1 ? from === boundary : to === boundary,
  );
  if (!range) return false;
  // 线性选区跨过隐藏区必然包含隐藏文本：消费 Shift+Arrow 并保持现有可见选区。
  if (shift) return true;
  if (!view.state.selection.main.empty) return false;
  const target = direction === 1 ? range.to : range.from;
  view.dispatch({ selection: { anchor: target }, scrollIntoView: true });
  return true;
}

/** Mouse dragging across a collapsed chapter stops at its first hidden boundary. Mod+A is exempt. */
export function clampSourceMouseSelection(view: EditorView): void {
  const selection = view.state.selection.main;
  if (selection.empty || (selection.from === 0 && selection.to === view.state.doc.length)) return;
  const model = sourceFoldState(view.state);
  if (!model?.folded.size) return;
  const ranges = hiddenRanges(model.headings, model.folded);
  const forward = selection.anchor <= selection.head;
  // anchor 必须位于所跨折叠边界的可见一侧；从隐藏区内起拖的选区不定义截断。
  const crossed = forward
    ? ranges.find(({ from, to }) => selection.anchor <= from && selection.head > to)
    : [...ranges].reverse().find(({ from, to }) => selection.anchor >= to && selection.head < from);
  if (!crossed) return;
  view.dispatch({
    selection: { anchor: selection.anchor, head: forward ? crossed.from : crossed.to },
  });
}

/** 外部重载/重开页面时清空临时折叠状态。 */
export function clearSourceHeadingFolds(view: EditorView): void {
  if (sourceFoldState(view.state)?.folded.size) view.dispatch({ effects: clearFolds.of() });
}
