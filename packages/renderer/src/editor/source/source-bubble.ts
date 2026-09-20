import type { Extension } from '@codemirror/state';
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import {
  createBubbleAiMenu,
  decorateBubbleButton,
  bindSelectionBubbleToolbarRoving,
  dispatchBubbleShortcut,
  disableSelectionBubbleToolbarTabStops,
  moveSelectionBubbleToolbarFocus,
  refreshBubbleButton,
  syncSelectionBubbleToolbarTabStop,
  defaultBubbleIconRenderer,
  type BubbleAiMenuOptions,
  type BubbleAiMenuView,
  type BubbleExtraControl,
  type BubbleIconRenderer,
} from '@nexnote/kernel';
import { AI_ACTION_PREFIX } from '../../features/ai/writing/actions';
import type { BubbleAction } from '@nexnote/kernel';

/**
 * 源码模式（CodeMirror）划词浮动工具栏：与块编辑模式 selection bubble 一致的交互。
 *
 * - 非空选区时在选区起点上方浮现（coordsAtPos 只在 rAF 帧循环读取：
 *   update() 事务提交期内读取布局会被 CodeMirror 拒绝并销毁本插件）
 * - mousedown 拦截以保留选区；点击触发 onAction(id, ctx) 并隐藏
 * - 选区折叠/为空、编辑器失焦、Esc 时隐藏；滚动后按新视口坐标重算
 * - 复用 .nexnote-selection-bubble 样式（暗色经 CSS 变量自动适配）
 * - DEV-034：AI 动作经共享 AI 下拉收口（createBubbleAiMenu，与块编辑同一键盘语义），
 *   生成中的停止控件由渲染层经 extraControl 注入
 * - DEV-063：图标由内核共享 SVG icon renderer 提供（与 PM selection bubble 同一实例），
 *   保证两模式图标视觉一致
 */

export type SourceBubbleAction = BubbleAction;

export interface SourceBubbleContext {
  /** 选区文本（未裁剪） */
  text: string;
  from: number;
  to: number;
  /** 选区起点视口坐标（WritingAssistantLayer fixed 定位锚点） */
  coords: { top: number; left: number };
}

export interface SourceBubbleOptions {
  /** 平铺动作（格式化 + 双链） */
  actions: SourceBubbleAction[];
  /** AI 动作收口下拉（DEV-034；label 缺省 'AI'） */
  aiMenu?: BubbleAiMenuOptions;
  /** 附加控件（如生成中的停止按钮） */
  extraControl?: BubbleExtraControl;
  /**
   * 图标渲染器（DEV-063）：与块编辑模式 PM selection bubble 共用同一实例。
   * 缺省走内核默认 renderer（lucide-react 1.41 几何数据，与顶部工具栏同源）。
   */
  iconRenderer?: BubbleIconRenderer;
  /** 所属源码编辑器当前是否允许显示划词 UI（预览视图返回 false）。 */
  isEnabled?: () => boolean;
  /**
   * 选区消失（折叠/空文本）导致工具栏隐藏时回调一次。
   * 用于清理依附选区的只读浮层（DEV-041 划词翻译）；失焦/Esc 隐藏不触发。
   */
  onSelectionLost?: () => void;
  onAction(id: string, ctx: SourceBubbleContext): void;
}

/** 源码工具栏与块编辑共用同一 class 前缀（样式与下拉语义单点维护）。 */
const BUBBLE_CLASS = 'nexnote-selection-bubble';

/** 计算浮层在包含块内的位置：底边距选区起点 8px，水平（中心）钳制在包含块内。 */
export function bubblePositionInFrame(
  coords: { top: number; left: number },
  frame: { left: number; top: number; right: number },
  width: number,
  height: number,
): { top: number; left: number } {
  const minLeft = frame.left + width / 2;
  const maxLeft = Math.max(minLeft, frame.right - width / 2);
  const left = Math.min(Math.max(coords.left, minLeft), maxLeft);
  const top = Math.max(coords.top - 8, frame.top + height);
  return { top: top - frame.top, left: left - frame.left };
}

export function sourceSelectionBubble(options: SourceBubbleOptions): Extension {
  return ViewPlugin.fromClass(
    class {
      readonly dom: HTMLDivElement;
      private visible = false;
      private dismissed = false;
      private destroyed = false;
      private rafId: number | null = null;
      private readonly aiMenu: BubbleAiMenuView | null;
      private readonly disposeRoving: () => void;
      private readonly renderer: BubbleIconRenderer;

      constructor(readonly view: EditorView) {
        this.renderer = options.iconRenderer ?? defaultBubbleIconRenderer;
        this.dom = this.createDom();
        this.aiMenu = options.aiMenu
          ? createBubbleAiMenu(
              BUBBLE_CLASS,
              options.aiMenu,
              this.renderer,
              (id) => this.emitAction(id),
              () => this.view.focus(),
            )
          : null;
        if (this.aiMenu) this.dom.append(this.aiMenu.dom);
        if (options.extraControl) this.dom.append(options.extraControl.dom);
        this.disposeRoving = bindSelectionBubbleToolbarRoving(this.dom);
        this.dom.addEventListener('focusout', this.onBubbleBlur);
        // 固定挂载 document.body：React 重建任何编辑器容器都不影响工具栏存续。
        this.dom.style.position = 'fixed';
        document.body.append(this.dom);
        // focusout 冒泡：焦点从 cm-content 离开时可捕获；relatedTarget 在 bubble 内则保持
        view.dom.addEventListener('focusout', this.onBlur);
        // scroll 不冒泡但在捕获阶段经过祖先链：覆盖任意后代滚动容器
        document.addEventListener('scroll', this.onScroll, true);
        this.sync();
      }

      update(update: ViewUpdate) {
        if (update.selectionSet) this.dismissed = false;
        if (update.selectionSet || update.docChanged) this.sync();
      }

      destroy() {
        this.destroyed = true;
        this.stopLoop();
        this.aiMenu?.destroy();
        options.extraControl?.destroy?.();
        document.removeEventListener('scroll', this.onScroll, true);
        this.view.dom.removeEventListener('focusout', this.onBlur);
        this.view.dom.removeEventListener('keydown', this.onKeyDown);
        this.dom.removeEventListener('keydown', this.onToolbarKeyDown);
        this.dom.removeEventListener('focusout', this.onBubbleBlur);
        this.disposeRoving();
        this.dom.remove();
      }

      private onScroll = () => {
        if (this.visible) this.sync();
      };

      private onBlur = (event: Event) => {
        // relatedTarget 在 bubble 内：焦点移到工具栏按钮上，保持可见
        const related = (event as FocusEvent).relatedTarget as Node | null;
        if (related && this.dom.contains(related)) return;
        this.dismiss();
      };

      private onBubbleBlur = (event: FocusEvent) => {
        const related = event.relatedTarget as Node | null;
        if (related && this.dom.contains(related)) return;
        this.dismiss();
      };

      /** Escape 关闭（仅 bubble 可见时拦截，不吞编辑器其他 Escape 语义）。 */
      private onKeyDown = (event: KeyboardEvent) => {
        const eventFromBubble = this.dom.contains(event.target as Node | null);
        if (eventFromBubble) return false;
        const shortcutActions = [...options.actions, ...(options.aiMenu?.actions ?? [])];
        if (dispatchBubbleShortcut(event, shortcutActions, (id) => this.emitAction(id)))
          return true;
        if (event.key === 'Escape' && this.visible) {
          event.preventDefault();
          this.dismiss();
          return true;
        }
        return false;
      };

      private onToolbarKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          this.dismiss();
          this.view.focus();
          return;
        }
        moveSelectionBubbleToolbarFocus(this.dom, event);
      };

      /** 可见期间每帧自愈：任何外部容器重建（含 document.body 被替换）后立即重挂。 */
      private ensureMounted(): void {
        if (this.dom.ownerDocument !== document || this.dom.parentElement !== document.body) {
          this.dom.style.position = 'fixed';
          document.body.append(this.dom);
        }
      }

      private startLoop(): void {
        if (this.rafId !== null) return;
        const tick = () => {
          this.rafId = null;
          if (this.destroyed || !this.visible) return;
          this.ensureMounted();
          this.positionToSelection();
          this.rafId = requestAnimationFrame(tick);
        };
        this.rafId = requestAnimationFrame(tick);
      }

      private stopLoop(): void {
        if (this.rafId !== null) {
          cancelAnimationFrame(this.rafId);
          this.rafId = null;
        }
      }

      private positionToSelection(): void {
        const sel = this.view.state.selection.main;
        const coords = this.view.coordsAtPos(sel.from);
        if (!coords) {
          this.hide();
          return;
        }
        const pos = bubblePositionInFrame(
          coords,
          { left: 0, top: 0, right: window.innerWidth },
          this.dom.offsetWidth,
          this.dom.offsetHeight,
        );
        this.dom.style.top = `${pos.top}px`;
        this.dom.style.left = `${pos.left}px`;
        this.dom.style.transform = 'translate(-50%, -100%)';
      }

      private sync(): void {
        this.ensureMounted();
        const sel = this.view.state.selection.main;
        const text = sel.empty ? '' : this.view.state.sliceDoc(sel.from, sel.to);
        if (options.isEnabled?.() === false || sel.empty || !text.trim()) {
          const wasVisible = this.visible;
          this.hide();
          disableSelectionBubbleToolbarTabStops(this.dom);
          if (wasVisible) options.onSelectionLost?.();
          return;
        }
        if (this.dismissed) return;
        for (const action of options.actions) {
          const button = this.dom.querySelector<HTMLButtonElement>(
            `[data-bubble-action="${action.id}"]`,
          );
          if (button) refreshBubbleButton(button, action);
        }
        this.dom.style.display = 'flex';
        this.visible = true;
        syncSelectionBubbleToolbarTabStop(this.dom);
        // 定位只能发生在 rAF 帧循环里：coordsAtPos 属于布局读取，
        // CodeMirror 在插件 update()（事务提交中）调用会抛
        // "Reading the editor layout isn't allowed during an update"，
        // 触发插件被销毁——工具栏自此永久消失。
        this.startLoop();
      }

      /**
       * 触发动作：以触发时刻的真实选区为准（菜单打开期间选区可能变化）。
       *
       * DEV-034：AI 写作动作（ai: 命名空间）保留工具栏——生成中工具栏里的停止控件
       * 必须始终可点（收起后要重新划词才能停止）。其余动作（格式化/双链/询问 AI）
       * 沿用收起语义：写回或把上下文交给对话 dock 后工具栏让位。
       */
      private emitAction(id: string): void {
        const sel = this.view.state.selection.main;
        const text = sel.empty ? '' : this.view.state.sliceDoc(sel.from, sel.to);
        if (sel.empty || !text.trim()) return;
        const coords = this.view.coordsAtPos(sel.from);
        if (!coords) return;
        if (!id.startsWith(AI_ACTION_PREFIX)) this.hide();
        options.onAction(id, { text, from: sel.from, to: sel.to, coords });
      }

      private dismiss(): void {
        this.dismissed = true;
        this.hide();
      }

      private hide(): void {
        this.visible = false;
        this.stopLoop();
        this.aiMenu?.close();
        this.dom.style.display = 'none';
        disableSelectionBubbleToolbarTabStops(this.dom);
      }

      private createDom(): HTMLDivElement {
        const dom = document.createElement('div');
        dom.className = BUBBLE_CLASS;
        dom.dataset.sourceSelectionBubble = '';
        dom.style.display = 'none';
        dom.setAttribute('role', 'toolbar');
        dom.setAttribute('aria-label', '选区操作');
        for (const action of options.actions) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `${BUBBLE_CLASS}__action`;
          btn.dataset.bubbleAction = action.id;
          decorateBubbleButton(btn, BUBBLE_CLASS, action, this.renderer);
          btn.addEventListener('mousedown', (e) => {
            // 阻止 mousedown 抢夺编辑器选区
            e.preventDefault();
          });
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            const nowDisabled =
              typeof action.disabled === 'function'
                ? action.disabled()
                : (action.disabled ?? false);
            if (nowDisabled) return;
            this.emitAction(action.id);
          });
          dom.append(btn);
        }
        // Esc 关闭：经 keydown 挂在编辑器 DOM 上（ViewPlugin 不提供 keymap）
        this.view.dom.addEventListener('keydown', this.onKeyDown);
        dom.addEventListener('keydown', this.onToolbarKeyDown);
        return dom;
      }
    },
  );
}