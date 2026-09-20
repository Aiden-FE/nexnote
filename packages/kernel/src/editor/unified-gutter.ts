import type { EditorView } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/core';
import { collectFoldHeadings, type FoldHeadingDescriptor, toggleBlockFold } from '@nexnote/kernel';

export interface UnifiedGutterController {
  destroy(): void;
  /** 当前渲染的 chevron 数量，便于测试断言。 */
  readonly renderedToggles: number;
  /** 强制下一帧重排（测试钩子）。 */
  scheduleUpdate(): void;
  /** 同步执行一次布局（跳过一次微任务）。 */
  flushSync(): void;
}

/**
 * 宿主级统一 gutter overlay 控制器（DEV-061）。
 *
 * 折叠 chevron 不再嵌入标题内部 ProseMirror widget，而是在编辑器宿主
 * (`nexnote-editor-host`) 顶层加一个绝对定位的 overlay 容器，每个
 * 标题 chevron 是 overlay 内的 button；位置根据 ProseMirror `coordsAtPos`
 * 与 `scrollContainer.scrollTop` 重算。
 *
 * 拖拽手柄 wrapper（TipTap 自带）以同样方式挂入 host，所以两个 overlay
 * 共用相同的滚动与重定位时机。
 */
export function mountUnifiedGutter(host: HTMLElement, editor: Editor): UnifiedGutterController {
  const view: EditorView = editor.view;
  /**
   * 编辑器挂载点之内的可滚动容器：
   * - 真实渲染场景：`.nexnote-editor-scroll` 是 `overflow:auto`，包围 host；
   * - 测试场景：父级可能不是 overflow:auto，但 view.dom.parentElement 已是最接近的偏移元素。
   * 我们沿父链查找第一个可滚动祖先；找不到时回退到 view.dom 的 parentElement。
   */
  const resolveScrollContainer = (root: HTMLElement): HTMLElement => {
    let node: HTMLElement | null = root.parentElement;
    while (node && node !== document.body) {
      const style = window.getComputedStyle(node);
      if (/(auto|scroll|overlay)/.test(style.overflow + style.overflowY + style.overflowX)) {
        return node;
      }
      node = node.parentElement;
    }
    return root.parentElement ?? root;
  };
  const scrollContainer = resolveScrollContainer(host);
  const overlay = document.createElement('div');
  overlay.className = 'nexnote-fold-overlay';
  overlay.dataset.testid = 'fold-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  host.append(overlay);

  /** 当前所有按钮按 blockId 索引，方便重建焦点承接。 */
  const buttons = new Map<string, HTMLButtonElement>();

  /** 等待重建后承接焦点的 blockId（键盘 Enter/Space 切换后）。 */
  let pendingFocusBlockId: string | null = null;

  /** 上次记录的块 → DOM 位置缓存，避免无变化时反复 writeLayout。 */
  const lastLayoutKey = new Map<string, string>();

  let pending = false;
  let stale = false;

  const requestUpdate = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      if (stale) return;
      writeLayout();
    });
  };

  /**
   * 同步布局（测试与被宿主控制的初始化窗口使用）：
   * 跳过一次微任务，把首批 chevron 立刻挂进 DOM。
   */
  const flushSync = () => {
    pending = true;
    pending = false;
    if (!stale) writeLayout();
  };

  const writeLayout = () => {
    const headings = collectFoldHeadings(editor.state);
    const seen = new Set<string>();
    const hostRect = host.getBoundingClientRect();
    const scrollTop = scrollContainer.scrollTop;
    const root = view.dom;

    for (const heading of headings) {
      seen.add(heading.blockId);
      let button = buttons.get(heading.blockId);
      if (!button) {
        button = createToggle(heading);
        buttons.set(heading.blockId, button);
        overlay.append(button);
      }
      syncButton(button, heading);
      const node = root.querySelector<HTMLElement>(`[blockId="${cssEscape(heading.blockId)}"]`);
      const coords = node ? node.getBoundingClientRect() : fallbackCoords(view, heading);
      const layoutKey = `${coords.top.toFixed(1)}|${scrollTop}|${heading.folded}`;
      if (lastLayoutKey.get(heading.blockId) !== layoutKey) {
        // 顶对齐到该标题的可见 top；overlay 容器 `inset:0` 以 host 为坐标系。
        button.style.transform = `translate(0, ${Math.max(
          coords.top - hostRect.top + scrollTop,
          0,
        )}px)`;
        lastLayoutKey.set(heading.blockId, layoutKey);
      }
      // 视口外/已卸载：标记 stale，让 CSS 隐藏，避免占用 Tab 顺序。
      const viewport = (view as unknown as { viewport?: { from: number; to: number } }).viewport;
      const outOfView = viewport && (heading.from < viewport.from || heading.to > viewport.to);
      button.dataset.stale = String(Boolean(outOfView));
    }

    // 移除不再可折叠的标题按钮（文档结构变更后）。
    for (const [blockId, button] of buttons) {
      if (!seen.has(blockId)) {
        button.remove();
        buttons.delete(blockId);
        lastLayoutKey.delete(blockId);
      }
    }

    if (pendingFocusBlockId) {
      const target = buttons.get(pendingFocusBlockId);
      if (target && !target.dataset.stale) {
        pendingFocusBlockId = null;
        queueMicrotask(() => {
          if (target.isConnected) target.focus({ preventScroll: true });
        });
      }
    }
  };

  const createToggle = (heading: FoldHeadingDescriptor): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nexnote-fold-overlay__toggle';
    button.dataset.foldId = heading.blockId;
    button.dataset.foldState = heading.folded ? 'collapsed' : 'expanded';
    button.setAttribute('aria-label', heading.actionLabel);
    button.setAttribute('aria-expanded', String(!heading.folded));
    button.setAttribute('data-fold-id', heading.blockId);
    button.setAttribute('data-fold-action', heading.folded ? 'expand' : 'collapse');
    button.tabIndex = 0;
    const icon = document.createElement('span');
    icon.className = 'nexnote-fold-overlay__toggle__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '›';
    button.append(icon);
    let lastKeyAt = 0;
    button.addEventListener('mousedown', (event) => {
      // 让正文 selection 不被抢走；按钮自身 Tab 接收键盘焦点。
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      lastKeyAt = Date.now();
      pendingFocusBlockId = heading.blockId;
      toggleBlockFold(view, heading.blockId);
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.detail === 0 && Date.now() - lastKeyAt < 500) return;
      toggleBlockFold(view, heading.blockId);
    });
    return button;
  };

  const syncButton = (button: HTMLButtonElement, heading: FoldHeadingDescriptor) => {
    button.dataset.foldState = heading.folded ? 'collapsed' : 'expanded';
    button.setAttribute('aria-expanded', String(!heading.folded));
    button.setAttribute('aria-label', heading.actionLabel);
    button.setAttribute('data-fold-action', heading.folded ? 'expand' : 'collapse');
  };

  /** TipTap 没有 data-block-id 锚点时回退到 coordsAtPos。 */
  const fallbackCoords = (
    view: EditorView,
    heading: FoldHeadingDescriptor,
  ): { top: number; bottom: number; left: number; right: number } => {
    try {
      const coords = view.coordsAtPos(heading.from + 1);
      const viewportRect = scrollContainer.getBoundingClientRect();
      return {
        top: coords.top - viewportRect.top + scrollContainer.scrollTop,
        bottom: coords.bottom - viewportRect.top + scrollContainer.scrollTop,
        left: coords.left,
        right: coords.right,
      };
    } catch {
      return { top: 0, bottom: 0, left: 0, right: 0 };
    }
  };

  // CSS.escape polyfill happy-dom 缺失。
  const cssEscape =
    typeof window !== 'undefined' && typeof window.CSS?.escape === 'function'
      ? window.CSS.escape
      : (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);

  const onScroll = () => requestUpdate();
  const onUpdate = () => requestUpdate();
  const onResize = () => requestUpdate();
  const onSelectionUpdate = () => requestUpdate();

  scrollContainer.addEventListener('scroll', onScroll, { passive: true });
  // 折叠切换只改插件状态不改 doc：必须订阅 transaction（update 仅在 doc 变化时触发）。
  editor.on('transaction', onUpdate);
  editor.on('selectionUpdate', onSelectionUpdate);
  if (typeof window !== 'undefined') window.addEventListener('resize', onResize);

  requestUpdate();

  flushSync();
  return {
    get renderedToggles() {
      return buttons.size;
    },
    scheduleUpdate: requestUpdate,
    flushSync,
    destroy() {
      stale = true;
      scrollContainer.removeEventListener('scroll', onScroll);
      editor.off('transaction', onUpdate);
      editor.off('selectionUpdate', onSelectionUpdate);
      if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
      for (const button of buttons.values()) button.remove();
      buttons.clear();
      overlay.remove();
    },
  };
}
