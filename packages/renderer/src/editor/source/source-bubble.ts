import type { Extension } from '@codemirror/state';
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import {
  createSelectionToolbarHost,
  type SelectionToolbarHost,
  type BubbleAiMenuOptions,
  type BubbleExtraControl,
  type BubbleIconRenderer,
} from '@nexnote/kernel';
import type { BubbleAction } from '@nexnote/kernel';
import { AI_ACTION_PREFIX } from '../../features/ai/writing/actions';

/**
 * 源码模式（CodeMirror）划词浮动工具栏：复用内核 `createSelectionToolbarHost`。
 *
 * 宿主接管 DOM 构建 / 挂载（document.body + fixed + RAF 自愈）/ 定位 / 滚动监听 /
 * roving focus / AI 下拉 / 工具栏焦点语义，本文件仅负责把 CodeMirror 选区状态
 * 推给宿主：何时可见、视口锚点是什么、点击触发哪个动作。
 *
 * - coordsAtPos 只在 rAF 帧循环里读取（PM update() 内读取布局也会被拒）；
 *   宿主内部的 RAF 帧循环负责此处的「选区 → 视口坐标」换算。
 * - 块编辑模式（PM）的 selection bubble 共用同一外壳；视觉 / 键盘 / AI 下拉
 *   通过共享 CSS 类与同源 `defaultBubbleIconRenderer` 保持一致。
 * - 动作触发以触发时刻的 CodeMirror 选区为准（DEV-034 命名空间动作保留工具栏，
 *   其余动作沿用隐藏语义）。
 */

export type SourceBubbleAction = BubbleAction;

export interface SourceBubbleContext {
  /** 选区文本（未裁剪） */
  text: string;
  from: number;
  to: number;
  /** 选区起点视口坐标（写回 / fixed 浮层锚点） */
  coords: { top: number; left: number };
}

export interface SourceBubbleOptions {
  /** 平铺动作（格式化 + 双链） */
  actions: SourceBubbleAction[];
  /** AI 动作收口下拉（DEV-034；label 缺省 'AI'） */
  aiMenu?: BubbleAiMenuOptions;
  /** 附加控件（如生成中的停止按钮） */
  extraControl?: BubbleExtraControl;
  /** 图标渲染器（DEV-063；缺省走内核默认 renderer）。 */
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

const BUBBLE_CLASS = 'nexnote-selection-bubble';

export function sourceSelectionBubble(options: SourceBubbleOptions): Extension {
  return ViewPlugin.fromClass(
    class {
      private host: SelectionToolbarHost;
      private visible = false;
      private destroyed = false;

      constructor(readonly view: EditorView) {
        this.host = createSelectionToolbarHost({
          actions: options.actions,
          aiMenu: options.aiMenu,
          extraControl: options.extraControl,
          iconRenderer: options.iconRenderer,
          className: BUBBLE_CLASS,
          datasetFlag: 'sourceSelectionBubble',
          // CM：固定挂到 document.body，坐标以视口为参照，与历史 sourceSelectionBubble 行为一致。
          mount: null,
          coordinateSpace: 'viewport',
          // CM：除 AI 生成动作外都让位（停止控件必须始终可点）
          hideOnAction: (id) => !id.startsWith(AI_ACTION_PREFIX),
          onAction: (id) => this.emitAction(id),
          onToolbarEscape: () => {
            this.host.dismiss();
            this.visible = false;
            this.view.focus();
          },
          onToolbarFocusOut: () => {
            // 焦点真正离开工具栏（落到工具栏外）：与原 CM 行为一致。
            this.host.dismiss();
            this.visible = false;
          },
        });

        // 编辑器失焦（焦点彻底离开 cm-content + 工具栏）：dismiss 工具栏
        // 并把焦点归还 editor view。host 内部已处理工具栏 focusout。
        view.dom.addEventListener('focusout', this.onBlur);
        // Editor 上的 Escape 关闭（不与 CodeMirror 内置快捷键冲突）
        view.dom.addEventListener('keydown', this.onEditorKeyDown);
        // 滚动容器滚动后选区视口坐标变化：重新读 coords 并重定位。
        // document 捕获监听覆盖任意后代滚动容器（不依赖特定 scrollDOM 引用）。
        document.addEventListener('scroll', this.onScroll, true);
        // 初次同步
        this.sync();
      }

      private onScroll = () => {
        if (this.visible && !this.destroyed) this.scheduleCoordRefresh();
      }

      update(update: ViewUpdate) {
        if (update.selectionSet) this.host.resetDismiss();
        if (update.selectionSet || update.docChanged) this.sync();
      }

      destroy() {
        this.destroyed = true;
        if (this.rafId !== null) {
          cancelAnimationFrame(this.rafId);
          this.rafId = null;
        }
        document.removeEventListener('scroll', this.onScroll, true);
        this.host.destroy();
        this.view.dom.removeEventListener('focusout', this.onBlur);
        this.view.dom.removeEventListener('keydown', this.onEditorKeyDown);
      }

      private onBlur = (event: Event) => {
        const related = (event as FocusEvent).relatedTarget as Node | null;
        // 焦点进工具栏内部：保持可见
        if (related && this.host.dom.contains(related)) return;
        this.host.dismiss();
        this.visible = false;
      };

      private onEditorKeyDown = (event: KeyboardEvent) => {
        const eventFromBubble = this.host.dom.contains(event.target as Node | null);
        if (eventFromBubble) return;
        const shortcutActions = [...options.actions, ...(options.aiMenu?.actions ?? [])];
        // 复用内核快捷键分发；不再重复 matchesBubbleShortcut/dispatchBubbleShortcut 实现
        for (const action of shortcutActions) {
          const sc = action.shortcut;
          if (!sc) continue;
          const modOk = sc.mod ? event.metaKey || event.ctrlKey : true;
          const altOk = sc.alt ? event.altKey : !event.altKey;
          const shiftOk = sc.shift ? event.shiftKey : !event.shiftKey;
          if (
            modOk &&
            altOk &&
            shiftOk &&
            event.key.toLowerCase() === sc.key.toLowerCase()
          ) {
            // 命中即吞下事件（避免与编辑器自身快捷键冲突）；disabled 时仍 preventDefault 但不触发。
            event.preventDefault();
            const disabled =
              typeof action.disabled === 'function' ? action.disabled() : (action.disabled ?? false);
            if (disabled) return;
            this.emitAction(action.id);
            return;
          }
        }
        if (event.key === 'Escape' && this.visible) {
          event.preventDefault();
          this.host.dismiss();
          this.visible = false;
          return;
        }
      };

      private sync() {
        if (this.destroyed) return;
        if (options.isEnabled?.() === false) {
          this.host.dismiss();
          if (this.visible) options.onSelectionLost?.();
          this.visible = false;
          return;
        }
        const sel = this.view.state.selection.main;
        const text = sel.empty ? '' : this.view.state.sliceDoc(sel.from, sel.to);
        const wasVisible = this.visible;
        if (sel.empty || !text.trim()) {
          this.host.dismiss();
          if (wasVisible) options.onSelectionLost?.();
          this.visible = false;
          return;
        }
        // 立即让工具栏可见（display:flex），但 coordsAtPos 不能在 dispatch 同步期内调用；
        // rAF 推迟到事务提交后读布局并补定位。
        this.host.sync(true, null);
        this.scheduleCoordRefresh();
        this.visible = true;
      }

      private rafId: number | null = null;
      private scheduleCoordRefresh() {
        if (this.rafId !== null) return;
        this.rafId = requestAnimationFrame(() => {
          this.rafId = null;
          if (this.destroyed) return;
          const sel = this.view.state.selection.main;
          if (sel.empty) return;
          const coords = this.view.coordsAtPos(sel.from);
          if (!coords) {
            this.host.dismiss();
            return;
          }
          this.host.sync(true, { top: coords.top, left: coords.left });
        });
      }

      private emitAction(id: string) {
        const sel = this.view.state.selection.main;
        const text = sel.empty ? '' : this.view.state.sliceDoc(sel.from, sel.to);
        if (sel.empty || !text.trim()) return;
        const coords = this.view.coordsAtPos(sel.from);
        if (!coords) return;
        options.onAction(id, { text, from: sel.from, to: sel.to, coords });
      }
    },
  );
}
