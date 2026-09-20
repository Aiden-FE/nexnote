import { ensureSyntaxTree } from '@codemirror/language';
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
 * Markdown 标题章节折叠（DEV-055，ADR-0013；DEV-064 ghost preview + 可点击省略号）。
 *
 * 折叠是 CodeMirror 视图状态：按源码内稳定的标题身份（整数 id，与文本/slug 无关）记录，
 * 不修改文档、undo 历史或保存语义。源码视图与分栏编辑侧共享同一编辑器实例，因此状态
 * 天然连续；预览与实时预览不装配本扩展，始终完整渲染。
 *
 * DEV-064：折叠标题的章节占位从静态 `…` 升级为可点击 `…` 按钮；悬停折叠标题时占位
 * 旁追加淡色 ghost preview，点击 ghost / `…` 均可展开当前章节。折叠 / 展开的可辨
 * 差别不再依赖 `cm-heading-fold-placeholder` 字体颜色的灰度差（移除透明度类比：块编辑
 * 端 `.nexnote-folded` 不再降不透明度，源码端始终呈现 placeholder 字符），由 gutter
 * chevron + 行尾可点击 `…` 共同承担。
 */

/** 源码标题：tab 生命周期内的临时身份，绝不写入 Markdown。 */
export interface SourceHeading {
  id: number;
  /** 标题首行行首（ATX 为 `#` 行，Setext 为文本首行）。 */
  from: number;
  /** 折叠正文的起点（Setext 越过 underline 行；标题与 underline 均保持可见）。 */
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
  /** 当前悬停的折叠标题 id；null 表示无悬停。 */
  hovered: number | null;
}

const toggleFold = StateEffect.define<number>();
const clearFolds = StateEffect.define<void>();
const revealFoldAt = StateEffect.define<number>();
const foldToLevel = StateEffect.define<number>();
const setHover = StateEffect.define<number | null>();
/** 键盘切换后等待 gutter 重建按钮承接焦点的标题 id。 */
const pendingFocus = new WeakMap<EditorView, number>();
/** 键盘激活后与原生 click 的去重窗口（毫秒）。 */
const KEYBOARD_CLICK_DEDUPE_MS = 500;
/** 等待 Lezer 完整解析全文的上限；超时即 fail-open，不使用不完整树计算范围。 */
const FULL_PARSE_TIMEOUT_MS = 100;
/** Ghost preview 截取的纯文本最大字符数。 */
const GHOST_PREVIEW_MAX = 80;

/**
 * 从完整 Markdown 语法树解析标题。fenced code、frontmatter、HTML 块里形似标题的行
 * 不是标题；ATX H1-H6 与 Setext H1/H2 均产出（Setext 正文边界越过 underline 行）。
 *
 * CodeMirror 的 `syntaxTree` 可以是 viewport 外尚未完成的增量树。这里强制等待覆盖全文的
 * tree；超时或未完成时返回空列表，令折叠 fail-open，而不是据半棵树隐藏错误章节。
 */
export function parseSourceHeadings(
  state: EditorState,
  ensureTree: typeof ensureSyntaxTree = ensureSyntaxTree,
): SourceHeading[] {
  const tree = ensureTree(state, state.doc.length, FULL_PARSE_TIMEOUT_MS);
  if (!tree || tree.length < state.doc.length) return [];
  const headings: SourceHeading[] = [];
  tree.iterate({
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
      // Setext 语法树节点包含文本与 underline：两行都是标题本身，折叠正文必须从
      // underline 行之后开始，避免把 `===` / `---` 作为章节内容隐藏或误判为可折叠。
      const to = node.to;
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

/** 章节隐藏区纯文本预览（首约 80 字符），用于悬停 ghost。 */
function previewFor(state: EditorState, heading: SourceHeading): string {
  const raw = state.sliceDoc(heading.to, Math.min(heading.end, heading.to + GHOST_PREVIEW_MAX * 4));
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  return collapsed.length > GHOST_PREVIEW_MAX
    ? `${collapsed.slice(0, GHOST_PREVIEW_MAX)}…`
    : collapsed;
}

/**
 * 折叠占位符 + 行尾 ghost preview。
 *
 * DEV-055 占位是静态 `…` 字符；DEV-064 升级为可点击 button。悬停同一标题时，
 * button 旁追加淡色 ghost preview（aria-hidden），点击 ghost 或 `…` 均可展开。
 */
class FoldPlaceholder extends WidgetType {
  constructor(
    readonly id: number,
    readonly ghost: string,
    readonly expandedLabel: string,
  ) {
    super();
  }
  override eq(other: WidgetType): boolean {
    return (
      other instanceof FoldPlaceholder &&
      other.id === this.id &&
      other.ghost === this.ghost &&
      other.expandedLabel === this.expandedLabel
    );
  }
  override toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-heading-fold-tail';
    wrap.contentEditable = 'false';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-heading-fold-placeholder';
    button.textContent = '…';
    button.title = '展开章节';
    button.setAttribute('aria-label', '展开章节');
    button.setAttribute('data-fold-ellipsis', String(this.id));
    button.tabIndex = -1;
    const onPress = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleSourceHeadingFold(view, this.id);
    };
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener('click', onPress);
    wrap.append(button);
    if (this.ghost) {
      const ghostNode = document.createElement('span');
      ghostNode.className = 'cm-heading-fold-ghost';
      ghostNode.textContent = this.ghost;
      ghostNode.setAttribute('aria-hidden', 'true');
      ghostNode.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      ghostNode.addEventListener('click', onPress);
      wrap.append(ghostNode);
    }
    if (this.expandedLabel) {
      wrap.setAttribute('aria-expanded', 'false');
      wrap.setAttribute('aria-label', this.expandedLabel);
    }
    return wrap;
  }
}

function decorationsFor(
  state: EditorState,
  headings: readonly SourceHeading[],
  folded: ReadonlySet<number>,
  hovered: number | null,
): DecorationSet {
  return Decoration.set(
    hiddenRanges(headings, folded).map(({ id, from, to }) => {
      const heading = headings.find((candidate) => candidate.id === id);
      const ghostText =
        heading && hovered === id && folded.has(id) ? previewFor(state, heading) : '';
      return Decoration.replace({
        widget: new FoldPlaceholder(id, ghostText, '展开章节'),
      }).range(from, to);
    }),
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
        hovered: null,
      };
    } catch {
      // 初始解析失败同样 fail-open：编辑器仍可显示、编辑和保存原文。
      return {
        headings: [],
        folded: new Set(),
        decorations: Decoration.none,
        nextId: 1,
        hovered: null,
      };
    }
  },
  update(value, tr) {
    let headings = value.headings;
    let nextId = value.nextId;
    let folded = value.folded;
    let hovered = value.hovered;
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
      if (effect.is(foldToLevel)) {
        const next = new Set<number>();
        for (const heading of headings) {
          if (heading.quoted || !heading.content) continue;
          if (heading.level <= effect.value) next.add(heading.id);
        }
        folded = next;
      }
      if (effect.is(setHover)) {
        hovered = effect.value;
      }
    }
    // 悬停目标折叠 / 身份失效时清空悬停，避免 ghost 漂浮于不存在的章节之上。
    if (hovered != null && !folded.has(hovered)) hovered = null;
    if (headings === value.headings && folded === value.folded && hovered === value.hovered)
      return value;
    try {
      return {
        headings,
        folded,
        nextId,
        hovered,
        decorations: decorationsFor(tr.state, headings, folded, hovered),
      };
    } catch {
      return {
        headings,
        folded: new Set(),
        nextId,
        hovered: null,
        decorations: Decoration.none,
      };
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
export function revealSourceHeadingAt(view: EditorView, pos: number): number {
  const model = sourceFoldState(view.state);
  if (!model?.folded.size) return 0;
  const count = model.headings.filter(
    (heading) => model.folded.has(heading.id) && pos > heading.to && pos < heading.end,
  ).length;
  if (count > 0) view.dispatch({ effects: revealFoldAt.of(pos) });
  return count;
}

/** 展开当前 CodeMirror 编辑视图的全部章节；不修改文档或 undo 历史。 */
export function expandAllSourceHeadingFolds(view: EditorView): number {
  const count = sourceFoldState(view.state)?.folded.size ?? 0;
  clearSourceHeadingFolds(view);
  return count;
}

/**
 * 把所有 `level <= level` 且有内容的标题折叠；其余章节保持 / 进入展开。
 * 选区若落入新隐藏区，安全移回所属标题行末（与 toggleSourceHeadingFold 同语义）。
 */
export function foldSourceHeadingsToLevel(view: EditorView, level: number): number {
  const model = sourceFoldState(view.state);
  if (!model) return 0;
  const targetIds = new Set<number>();
  for (const heading of model.headings) {
    if (heading.quoted || !heading.content) continue;
    if (heading.level <= level) targetIds.add(heading.id);
  }
  const selection = view.state.selection.main;
  const fullDocumentSelection = selection.from === 0 && selection.to === view.state.doc.length;
  let updatedSelection: { anchor: number } | undefined;
  if (!fullDocumentSelection) {
    for (const heading of model.headings) {
      if (!targetIds.has(heading.id)) continue;
      if (selection.from < heading.end && selection.to > heading.to) {
        updatedSelection = { anchor: heading.to };
        break;
      }
    }
  }
  view.dispatch({
    effects: foldToLevel.of(level),
    ...(updatedSelection ? { selection: updatedSelection } : {}),
  });
  return targetIds.size;
}

/**
 * 当前光标所在的最深可折叠（unquoted + content）标题 id；光标不在任何章节内时返回 null。
 */
export function currentSourceHeadingId(state: EditorState): number | null {
  const model = sourceFoldState(state);
  if (!model) return null;
  const pos = state.selection.main.head;
  let best: SourceHeading | null = null;
  for (const heading of model.headings) {
    if (heading.quoted || !heading.content) continue;
    if (pos >= heading.from && pos <= heading.end) {
      if (!best || heading.level >= best.level) best = heading;
    }
  }
  return best?.id ?? null;
}

/** 对外暴露的标题切换入口（块编辑 `toggleBlockFold` 的对位 API）。 */
export function toggleSourceHeadingFoldById(view: EditorView, id: number): boolean {
  const model = sourceFoldState(view.state);
  const heading = model?.headings.find((candidate) => candidate.id === id && candidate.content);
  if (!heading || heading.quoted) return false;
  toggleSourceHeadingFold(view, id);
  return true;
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

/**
 * CodeMirror 将整个 `.cm-gutters` 从 accessibility tree 隐藏，因此此 marker 只承担
 * 视觉与鼠标命中；真正可访问的 button 由 editor root 的 sibling overlay 提供。
 */
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
  override toDOM(): HTMLElement {
    const icon = document.createElement('span');
    icon.className = 'cm-heading-fold-gutter-icon';
    icon.textContent = '›';
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('data-fold-state', this.folded ? 'collapsed' : 'expanded');
    icon.setAttribute('data-fold-id', String(this.id));
    return icon;
  }
}

function headingIsVisibleControl(model: FoldState, heading: SourceHeading): boolean {
  return (
    !heading.quoted &&
    heading.content &&
    !model.headings.some(
      (parent) =>
        model.folded.has(parent.id) && heading.from > parent.to && heading.from < parent.end,
    )
  );
}

function toggleSourceHeadingFold(view: EditorView, id: number, restoreKeyboardFocus = false): void {
  if (restoreKeyboardFocus) pendingFocus.set(view, id);
  const model = sourceFoldState(view.state);
  const heading = model?.headings.find((candidate) => candidate.id === id && candidate.content);
  if (!heading || heading.quoted) {
    pendingFocus.delete(view);
    return;
  }
  // 光标整体在可见区时保持不动；光标会落入隐藏章节时移回标题行末，避免悬空光标。
  const selection = view.state.selection.main;
  const collapsing = !model!.folded.has(id);
  const fullDocumentSelection = selection.from === 0 && selection.to === view.state.doc.length;
  const intersectsHiddenSection = selection.from < heading.end && selection.to > heading.to;
  view.dispatch({
    effects: toggleFold.of(id),
    ...(collapsing && intersectsHiddenSection && !fullDocumentSelection
      ? { selection: { anchor: heading.to } }
      : {}),
  });
}

/** Accessible control deliberately lives outside CodeMirror's aria-hidden gutter subtree. */
function createAccessibleDisclosure(
  view: EditorView,
  id: number,
  folded: boolean,
): HTMLButtonElement {
  const button = document.createElement('button');
  const action = folded ? '展开章节' : '折叠章节';
  button.type = 'button';
  button.className = 'cm-heading-fold-toggle';
  button.textContent = '›';
  button.title = action;
  button.setAttribute('aria-label', action);
  button.setAttribute('aria-expanded', String(!folded));
  button.setAttribute('data-fold-state', folded ? 'collapsed' : 'expanded');
  button.setAttribute('data-fold-id', String(id));
  button.tabIndex = 0;
  let lastKeyToggleAt = 0;
  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    lastKeyToggleAt = Date.now();
    toggleSourceHeadingFold(view, id, true);
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.detail === 0 && Date.now() - lastKeyToggleAt < KEYBOARD_CLICK_DEDUPE_MS) return;
    toggleSourceHeadingFold(view, id);
  });
  return button;
}

function updateAccessibleDisclosure(button: HTMLButtonElement, folded: boolean): void {
  const action = folded ? '展开章节' : '折叠章节';
  button.title = action;
  button.setAttribute('aria-label', action);
  button.setAttribute('aria-expanded', String(!folded));
  button.setAttribute('data-fold-state', folded ? 'collapsed' : 'expanded');
}

/** 将可访问 controls 绝对定位到 gutter 上，既保留视觉入口又不违反 CodeMirror aria 边界。 */
class AccessibleDisclosureOverlay {
  readonly dom = document.createElement('div');
  /** 按临时 heading identity 复用节点，滚动与测量不会破坏 Tab 焦点。 */
  readonly buttons = new Map<number, HTMLButtonElement>();

  constructor(readonly view: EditorView) {
    this.dom.className = 'cm-heading-fold-accessible-controls';
    this.dom.setAttribute('data-testid', 'source-heading-fold-controls');
    view.dom.append(this.dom);
    this.sync();
  }

  update(update: ViewUpdate): void {
    if (
      update.viewportChanged ||
      update.geometryChanged ||
      sourceFoldState(update.startState) !== sourceFoldState(update.state)
    )
      this.sync();
  }

  sync(): void {
    const model = sourceFoldState(this.view.state);
    if (!model) {
      for (const button of this.buttons.values()) button.remove();
      this.buttons.clear();
      return;
    }
    const visible = model.headings.filter(
      (heading) =>
        headingIsVisibleControl(model, heading) &&
        heading.from >= this.view.viewport.from &&
        heading.from <= this.view.viewport.to,
    );
    const valid = new Map(
      model.headings
        .filter((heading) => headingIsVisibleControl(model, heading))
        .map((heading) => [heading.id, heading]),
    );
    const visibleIds = new Set(visible.map((heading) => heading.id));
    for (const [id, button] of this.buttons) {
      const heading = valid.get(id);
      if (!heading) {
        button.remove();
        this.buttons.delete(id);
        continue;
      }
      updateAccessibleDisclosure(button, model.folded.has(id));
      if (visibleIds.has(id) || document.activeElement === button) continue;
      button.remove();
      this.buttons.delete(id);
    }
    for (const heading of visible) {
      let button = this.buttons.get(heading.id);
      if (!button) {
        button = createAccessibleDisclosure(this.view, heading.id, model.folded.has(heading.id));
        this.buttons.set(heading.id, button);
        this.dom.append(button);
      } else {
        updateAccessibleDisclosure(button, model.folded.has(heading.id));
      }
      if (pendingFocus.get(this.view) === heading.id) {
        pendingFocus.delete(this.view);
        queueMicrotask(() => {
          if (button.isConnected) button.focus({ preventScroll: true });
        });
      }
    }
    // CodeMirror forbids layout reads during plugin construction/update. A stable request key
    // coalesces repeated scroll/update syncs to one measure per frame.
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const root = view.dom.getBoundingClientRect();
        const gutter = view.dom.querySelector<HTMLElement>('.cm-heading-fold-gutter');
        const gutterBox = gutter?.getBoundingClientRect();
        const current = sourceFoldState(view.state);
        return (current?.headings ?? [])
          .filter(
            (heading) =>
              current !== null &&
              headingIsVisibleControl(current, heading) &&
              heading.from >= view.viewport.from &&
              heading.from <= view.viewport.to,
          )
          .map((heading) => {
            const coords = view.coordsAtPos(heading.from);
            return {
              id: heading.id,
              left: Math.max(0, (gutterBox?.left ?? root.left) - root.left),
              top: (coords?.top ?? root.top + view.lineBlockAt(heading.from).top) - root.top,
            };
          });
      },
      write: (positions) => {
        for (const position of positions) {
          const button = this.buttons.get(position.id);
          if (!button) continue;
          button.style.left = `${position.left}px`;
          button.style.top = `${position.top}px`;
        }
      },
    });
  }

  destroy(): void {
    this.buttons.clear();
    this.dom.remove();
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
            !headingIsVisibleControl(model!, heading) ||
            heading.from < view.viewport.from ||
            heading.from > view.viewport.to
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
    ViewPlugin.fromClass(AccessibleDisclosureOverlay, {
      eventHandlers: {
        scroll(event) {
          if (event.target === this.view.scrollDOM) this.sync();
          return false;
        },
      },
    }),
    gutter({
      class: 'cm-heading-fold-gutter',
      markers: (view) => view.plugin(markers)?.markers ?? RangeSet.empty,
      initialSpacer: () => new DisclosureSpacer(),
      domEventHandlers: {
        click(view, line, event) {
          const model = sourceFoldState(view.state);
          const heading = model?.headings.find((candidate) => candidate.from === line.from);
          if (!model || !heading || !headingIsVisibleControl(model, heading)) return false;
          event.preventDefault();
          toggleSourceHeadingFold(view, heading.id);
          return true;
        },
      },
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
      // DEV-064：悬停折叠标题时驱动 foldState.hovered，触发 ghost preview。
      // happy-dom 等无 layout 的环境 posAtCoords 返回 null，测试通过显式
      // previewSourceFoldHover(view, id) 直接触发。
      mousemove(event, view) {
        const model = sourceFoldState(view.state);
        if (!model) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        let nextId: number | null = null;
        if (pos != null) {
          const heading = model.headings.find(
            (candidate) =>
              model.folded.has(candidate.id) && pos >= candidate.from && pos <= candidate.to,
          );
          nextId = heading?.id ?? null;
        }
        if (nextId !== model.hovered) {
          view.dispatch({ effects: setHover.of(nextId) });
        }
        return false;
      },
      mouseleave(_event, view) {
        const model = sourceFoldState(view.state);
        if (model && model.hovered != null) {
          view.dispatch({ effects: setHover.of(null) });
        }
        return false;
      },
    }),
  ];
}

/**
 * DEV-064：测试 / 自动化入口，无 layout 也能驱动 ghost preview。
 * 真实鼠标交互由 `mousemove` 事件处理器维护。
 */
export function previewSourceFoldHover(view: EditorView, id: number | null): void {
  const model = sourceFoldState(view.state);
  if (!model) return;
  if (id != null) {
    const heading = model.headings.find((candidate) => candidate.id === id);
    if (!heading || heading.quoted || !heading.content || !model.folded.has(id)) {
      if (model.hovered !== null) view.dispatch({ effects: setHover.of(null) });
      return;
    }
  }
  if (model.hovered !== id) view.dispatch({ effects: setHover.of(id) });
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
