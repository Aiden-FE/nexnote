import type { Extension } from '@codemirror/state';
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

/**
 * 源码模式（CodeMirror）划词浮动工具栏：与块编辑模式 selection bubble 一致的交互。
 *
 * - 非空选区时在选区起点上方浮现（coordsAtPos 视口坐标 → 包含块内坐标）
 * - mousedown 拦截以保留选区；点击触发 onAction(id, ctx) 并隐藏
 * - 选区折叠/为空、编辑器失焦、Esc 时隐藏；滚动后按新视口坐标重算
 * - 复用 .nexnote-selection-bubble 样式（暗色经 CSS 变量自动适配）
 */

export interface SourceBubbleAction {
  id: string;
  title: string;
}

export interface SourceBubbleContext {
  /** 选区文本（未裁剪） */
  text: string;
  from: number;
  to: number;
  /** 选区起点视口坐标（WritingAssistantLayer fixed 定位锚点） */
  coords: { top: number; left: number };
}

export interface SourceBubbleOptions {
  actions: SourceBubbleAction[];
  onAction(id: string, ctx: SourceBubbleContext): void;
}

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
      private destroyed = false;
      private rafId: number | null = null;

      constructor(readonly view: EditorView) {
        this.dom = this.createDom();
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
        if (update.selectionSet || update.docChanged) this.sync();
      }

      destroy() {
        this.destroyed = true;
        this.stopLoop();
        document.removeEventListener('scroll', this.onScroll, true);
        this.view.dom.removeEventListener('focusout', this.onBlur);
        this.view.dom.removeEventListener('keydown', this.onKeyDown);
        this.dom.remove();
      }

      private onScroll = () => {
        if (this.visible) this.sync();
      };

      private onBlur = (event: Event) => {
        // relatedTarget 在 bubble 内：焦点移到工具栏按钮上，保持可见
        const related = (event as FocusEvent).relatedTarget as Node | null;
        if (related && this.dom.contains(related)) return;
        this.hide();
      };

      /** Escape 关闭（仅 bubble 可见时拦截，不吞编辑器其他 Escape 语义）。 */
      private onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && this.visible) {
          event.preventDefault();
          this.hide();
          return true;
        }
        return false;
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
        if (sel.empty || !text.trim()) {
          this.hide();
          return;
        }
        this.dom.style.display = 'flex';
        this.visible = true;
        this.positionToSelection();
        this.startLoop();
      }

      private hide(): void {
        this.visible = false;
        this.stopLoop();
        this.dom.style.display = 'none';
      }

      private createDom(): HTMLDivElement {
        const dom = document.createElement('div');
        dom.className = 'nexnote-selection-bubble';
        dom.dataset.sourceSelectionBubble = '';
        dom.style.display = 'none';
        dom.setAttribute('role', 'toolbar');
        dom.setAttribute('aria-label', '选区操作');
        for (const action of options.actions) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'nexnote-selection-bubble__action';
          btn.dataset.bubbleAction = action.id;
          btn.textContent = action.title;
          btn.addEventListener('mousedown', (e) => {
            // 阻止 mousedown 抢夺编辑器选区
            e.preventDefault();
          });
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            const sel = this.view.state.selection.main;
            const text = sel.empty ? '' : this.view.state.sliceDoc(sel.from, sel.to);
            if (sel.empty || !text.trim()) return;
            const coords = this.view.coordsAtPos(sel.from);
            if (!coords) return;
            this.hide();
            options.onAction(action.id, { text, from: sel.from, to: sel.to, coords });
          });
          dom.append(btn);
        }
        // Esc 关闭：经 keydown 挂在编辑器 DOM 上（ViewPlugin 不提供 keymap）
        this.view.dom.addEventListener('keydown', this.onKeyDown);
        return dom;
      }
    },
  );
}
