import {
  createBubbleAiMenu,
  decorateBubbleButton,
  refreshBubbleButton,
  type BubbleAction,
  type BubbleAiMenuOptions,
  type BubbleExtraControl,
} from './selection-bubble-helpers';
import { defaultBubbleIconRenderer, type BubbleIconRenderer } from './selection-bubble-icons';
import {
  bindSelectionBubbleToolbarRoving,
  disableSelectionBubbleToolbarTabStops,
  moveSelectionBubbleToolbarFocus,
  syncSelectionBubbleToolbarTabStop,
} from './selection-bubble-roving';

/**
 * 划词工具栏宿主（DEV-ARCH-001）：块编辑（ProseMirror）与源码（CodeMirror）两种
 * 编辑器共用的「划词工具栏外壳」。宿主负责：
 *
 * - DOM 构建（动作按钮、AI 下拉、附加控件、roving focus、键盘可达性）
 * - 挂载（`mount` 给出宿主元素时挂宿主并按容器坐标定位；为 null 时挂
 *   document.body + position:fixed。React/编辑器宿主重建后由 `ensureMounted` 自愈）
 * - 定位（选区起点上方 8px，translate(-50%,-100%)，水平/垂直钳制在参照框内）
 * - 关闭语义（focusout 焦点真正离开、Escape 由编辑器侧主动通知）
 *
 * 定位驱动是同步的：编辑器侧在自身事务/update 时机调用 `sync(visible, coords)`；
 * 滚动与 rAF 重定位归编辑器侧所有（CodeMirror 禁止在 dispatch 期间读布局，
 * 由其适配器推迟到 rAF；ProseMirror 由 document 捕获阶段滚动监听驱动重 sync）。
 *
 * 宿主**不**感知编辑器类型：编辑器侧只负责把「当前是否可见」与「锚点视口坐标」
 * 推给宿主（`sync(visible, coords)`），由宿主决定要不要移动 DOM。
 *
 * 坐标约定：`coords.top` 是**选区首行可视顶边**（PM 由 `coordsAtPos(from).top`、
 * CM 由 `coordsAtPos(sel.from).top` 提供），工具栏在该点上方显示。
 */

export interface SelectionToolbarHostOptions {
  /** 平铺动作（格式化 / 双链 / 等）。 */
  actions: readonly BubbleAction[];
  /**
   * AI 下拉关闭后归还编辑器焦点的回调（DEV-034）：AI 菜单项通常把上下文交给
   * 对话 dock，此时工具栏可能已隐藏、焦点滞留；CM 路径传 `() => view.focus()`。
   */
  restoreEditorFocus?: () => void;
  /** AI 动作收口下拉（DEV-034；label 缺省 'AI'）。 */
  aiMenu?: BubbleAiMenuOptions;
  /** 附加控件（生成中的停止按钮由渲染层注入）。 */
  extraControl?: BubbleExtraControl;
  /** 图标渲染器（DEV-063；缺省走内核 lucide renderer）。 */
  iconRenderer?: BubbleIconRenderer;
  /** 根 DOM 上的 dataset 标记（PM 'selectionBubble' / CM 'sourceSelectionBubble'）。 */
  datasetFlag?: string;
  /** CSS 类前缀（缺省 'nexnote-selection-bubble'）。 */
  className?: string;
  /** 点击非 AI 动作后是否自动隐藏（CM 路径历史语义；PM 保留工具栏）。 */
  hideOnAction?: (id: string) => boolean;
  /** 焦点真正离开工具栏时（PM 常由编辑器 blur 接管；CM 内部处理）。 */
  onToolbarFocusOut?: () => void;
  /** Escape 落在工具栏内部时（由编辑器再分发前）。 */
  onToolbarEscape?: () => void;
  /**
   * 挂载目标元素。null 表示挂到 document.body。PM 路径一般传编辑器宿主（保证
   * `container.querySelector('[data-selection-bubble]')` 仍可命中既有测试与样式
   * 继承）；CM 路径固定传 null。
   */
  mount?: HTMLElement | null;
  /**
   * 坐标空间：`parent` 表示以 mount 元素的 getBoundingClientRect 为参照
   * （bubble `position: absolute`，top/left 是容器内坐标；这是 PM 历史行为）。
   * `viewport` 表示以窗口视口为参照（bubble `position: fixed`，自愈到 body）。
   * 缺省 `parent`。
   */
  coordinateSpace?: 'parent' | 'viewport';
  /** 动作触发回调（宿主不读取编辑器状态，由调用方拉取最新 selection/文本）。 */
  onAction(id: string): void;
}

export interface SelectionToolbarHost {
  /** 工具栏根元素（调用方一般不直接接触；暴露供测试断言）。 */
  readonly dom: HTMLDivElement;
  /**
   * 按当前编辑器选择状态推进一次宿主：
   * visible=true + coords → 展示/移动；visible=false → 隐藏并触发 dismiss 语义。
   * 与 ProseMirror `update()` / CodeMirror rAF 都对齐：只接受调用方显式给出的
   * 可见性，不读取编辑器自身状态。
   */
  sync(visible: boolean, coords: { top: number; left: number } | null): void;
  /** 主动关闭（标记 dismissed=true），由调用方触发或编辑器失焦。 */
  dismiss(): void;
  /** 仅关闭（不标记 dismissed）；下次 sync(visible=true) 可复活。 */
  hide(): void;
  /** 清空「已忽略」标志（编辑器选区变化时调用）。 */
  resetDismiss(): void;
  /** 隐藏并销毁：移除 DOM、停止 rAF、注销全局监听、销毁附加控件。 */
  destroy(): void;
}

/** 视口/容器定位：底边距锚点顶 8px，水平居中钳制在 frame 内。 */
function positionInFrame(
  coords: { top: number; left: number },
  frame: { left: number; right: number; top: number },
  width: number,
  height: number,
): { top: number; left: number } {
  const minLeft = frame.left + width / 2;
  const maxLeft = Math.max(minLeft, frame.right - width / 2);
  const left = Math.min(Math.max(coords.left, minLeft), maxLeft) - frame.left;
  const top = Math.max(coords.top - 8, frame.top + height) - frame.top;
  return { top, left };
}

function frameFor(
  hostEl: HTMLElement | null | undefined,
  mount: HTMLElement | null | undefined,
  space: 'parent' | 'viewport',
): { left: number; right: number; top: number } {
  if (space === 'viewport') {
    return { left: 0, right: window.innerWidth, top: 0 };
  }
  // 容器空间下，优先用 host 元素的真实 offsetParent（含块）作参照框；
  // offsetParent 缺失（无布局环境）时退回 mount 元素。避免 absolute top/left
  // 锚定在非包含块元素上时随文档长度漂移的历史缺陷。
  const frameEl = (hostEl?.offsetParent as HTMLElement | null) ?? mount ?? null;
  const rect =
    frameEl?.getBoundingClientRect?.() ??
    ({ left: 0, right: window.innerWidth, top: 0 } as DOMRect);
  return { left: rect.left, right: rect.right, top: rect.top };
}

export function createSelectionToolbarHost(
  options: SelectionToolbarHostOptions,
): SelectionToolbarHost {
  const className = options.className ?? 'nexnote-selection-bubble';
  const renderer = options.iconRenderer ?? defaultBubbleIconRenderer;
  const datasetFlag = options.datasetFlag ?? 'selectionBubble';
  const hideOnAction = options.hideOnAction ?? (() => false);
  const mountTarget = options.mount ?? null;
  const coordinateSpace = options.coordinateSpace ?? (mountTarget ? 'parent' : 'viewport');

  let visible = false;
  let dismissed = false;
  let destroyed = false;
  let lastCoords: { top: number; left: number } | null = null;

  const dom = document.createElement('div');
  dom.className = className;
  dom.dataset[datasetFlag] = '';
  dom.style.display = 'none';
  dom.style.position = coordinateSpace === 'viewport' ? 'fixed' : 'absolute';
  dom.style.zIndex = '45';
  dom.setAttribute('role', 'toolbar');
  dom.setAttribute('aria-label', '选区操作');

  for (const action of options.actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${className}__action`;
    btn.dataset.bubbleAction = action.id;
    decorateBubbleButton(btn, className, action, renderer);
    btn.addEventListener('mousedown', (event) => {
      // 阻止 mousedown 抢夺编辑器选区
      event.preventDefault();
    });
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const disabled =
        typeof action.disabled === 'function' ? action.disabled() : (action.disabled ?? false);
      if (disabled) return;
      if (hideOnAction(action.id)) hideDom();
      options.onAction(action.id);
    });
    dom.append(btn);
  }

  const aiMenu = options.aiMenu
    ? createBubbleAiMenu(
        className,
        options.aiMenu,
        renderer,
        (id) => {
          if (hideOnAction(id)) hideDom();
          options.onAction(id);
        },
        options.restoreEditorFocus,
      )
    : null;
  if (aiMenu) dom.append(aiMenu.dom);
  if (options.extraControl) dom.append(options.extraControl.dom);

  const disposeRoving = bindSelectionBubbleToolbarRoving(dom);

  dom.addEventListener('focusout', (event) => {
    const related = event.relatedTarget as Node | null;
    if (related && dom.contains(related)) return;
    options.onToolbarFocusOut?.();
  });
  dom.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      options.onToolbarEscape?.();
      return;
    }
    moveSelectionBubbleToolbarFocus(dom, event);
  });

  const refreshActions = () => {
    for (const action of options.actions) {
      const button = dom.querySelector<HTMLButtonElement>(
        `[data-bubble-action="${action.id}"]`,
      );
      if (button) refreshBubbleButton(button, action);
    }
  };

  const ensureMounted = () => {
    if (destroyed) return;
    // 编辑器宿主可能被 React 重建：挂点失效时回退 document.body，保证工具栏存续。
    const desiredParent = mountTarget ?? document.body;
    if (dom.ownerDocument !== document || dom.parentElement !== desiredParent) {
      desiredParent.append(dom);
    }
    dom.style.position = coordinateSpace === 'viewport' ? 'fixed' : 'absolute';
  };

  const positionToCoords = () => {
    if (!lastCoords) return;
    const frame = frameFor(dom, mountTarget, coordinateSpace);
    const pos = positionInFrame(lastCoords, frame, dom.offsetWidth, dom.offsetHeight);
    dom.style.top = `${pos.top}px`;
    dom.style.left = `${pos.left}px`;
    dom.style.transform = 'translate(-50%, -100%)';
  };

  const show = () => {
    ensureMounted();
    refreshActions();
    dom.style.display = 'flex';
    visible = true;
    syncSelectionBubbleToolbarTabStop(dom);
    positionToCoords();
  };

  const hideDom = () => {
    visible = false;
    aiMenu?.close();
    dom.style.display = 'none';
    disableSelectionBubbleToolbarTabStops(dom);
  };

  ensureMounted();

  return {
    dom,
    sync(nextVisible, coords) {
      if (destroyed) return;
      lastCoords = coords ?? lastCoords;
      if (!nextVisible || dismissed) {
        if (visible) hideDom();
        return;
      }
      if (!visible) show();
      else {
        // 已可见：刷新动作 aria 态、唯一 tabstop 与位置（ProseMirror `update` 期间多次调用）。
        ensureMounted();
        refreshActions();
        syncSelectionBubbleToolbarTabStop(dom);
        positionToCoords();
      }
    },
    dismiss() {
      dismissed = true;
      hideDom();
    },
    resetDismiss() {
      dismissed = false;
    },
    hide() {
      hideDom();
    },
    destroy() {
      destroyed = true;
      disposeRoving();
      aiMenu?.destroy();
      options.extraControl?.destroy?.();
      dom.remove();
    },
  };
}
