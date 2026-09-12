import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

import { computeEditorActionContext, type EditorActionContext } from './action-context';

/**
 * 选区浮动工具栏（框架无关 DOM 实现）。
 *
 * 非折叠文本选区时，在选区上方居中浮现工具条；按钮来自配置（渲染层注入六个 AI 动作）。
 * - mousedown 拦截以保留选区；点击触发 onAction(id, ctx)（ctx.target = selection）
 * - 快捷键：mod(+alt)+<key> 且选区非折叠时触发同一动作
 * - 折叠选区 / 编辑器失焦 / 选区为空时隐藏
 */

export interface BubbleAction {
  id: string;
  title: string;
  hint?: string;
  /** 快捷键显示，如 '⌘⌥R'；与 shortcut 匹配时键盘触发。 */
  shortcutLabel?: string;
  shortcut?: { mod: boolean; alt?: boolean; shift?: boolean; key: string };
}

export interface SelectionBubbleOptions {
  actions: BubbleAction[];
  onAction: (id: string, ctx: EditorActionContext) => void;
  className: string;
}

export const selectionBubblePluginKey = new PluginKey<{ visible: boolean }>(
  'nexnoteSelectionBubble',
);

interface BubbleView {
  dom: HTMLDivElement;
  show(coords: { top: number; left: number }): void;
  hide(): void;
  destroy(): void;
}

function createBubbleDom(
  className: string,
  actions: BubbleAction[],
  onTrigger: (id: string) => void,
): BubbleView {
  const dom = document.createElement('div');
  dom.className = className;
  dom.dataset.selectionBubble = '';
  dom.style.display = 'none';
  dom.style.position = 'absolute';
  dom.style.zIndex = '45';
  dom.setAttribute('role', 'toolbar');
  dom.setAttribute('aria-label', '选区操作');

  for (const action of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${className}__action`;
    btn.dataset.bubbleAction = action.id;
    btn.title = action.shortcutLabel ? `${action.title}（${action.shortcutLabel}）` : action.title;
    btn.textContent = action.title;
    btn.addEventListener('mousedown', (e) => {
      // 阻止 mousedown 抢夺编辑器选区
      e.preventDefault();
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      onTrigger(action.id);
    });
    dom.append(btn);
  }

  const show: BubbleView['show'] = (coords) => {
    dom.style.display = 'flex';
    // 坐标以实际包含块（offsetParent）为参照：锚点容器（parentElement）与包含块
    // 不一致时（如宿主未定位），absolute 的 top/left 相对包含块解析，
    // 按锚点换算会随文档长度漂移；offsetParent 缺失时退回锚点矩形。
    const frame =
      (dom.offsetParent as HTMLElement | null)?.getBoundingClientRect() ??
      dom.parentElement?.getBoundingClientRect();
    const frameLeft = frame?.left ?? 0;
    const frameTop = frame?.top ?? 0;
    const frameRight = frame?.right ?? frameLeft;
    const width = dom.offsetWidth;
    const height = dom.offsetHeight;
    const minLeft = frameLeft + width / 2;
    const maxLeft = Math.max(minLeft, frameRight - width / 2);
    const left = Math.min(Math.max(coords.left, minLeft), maxLeft);
    const top = Math.max(coords.top - 8, frameTop + height);
    dom.style.top = `${top - frameTop}px`;
    dom.style.left = `${left - frameLeft}px`;
    dom.style.transform = 'translate(-50%, -100%)';
  };
  const hide = () => {
    dom.style.display = 'none';
  };
  const destroy = () => dom.remove();
  return { dom, show, hide, destroy };
}

export const SelectionBubble = Extension.create<SelectionBubbleOptions, { visible: boolean }>({
  name: 'nexnoteSelectionBubble',

  addOptions() {
    return {
      actions: [],
      onAction: () => undefined,
      className: 'nexnote-selection-bubble',
    };
  },

  addStorage() {
    return { visible: false };
  },

  addProseMirrorPlugins() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const ext = this;

    const matchesShortcut = (event: KeyboardEvent, action: BubbleAction): boolean => {
      const sc = action.shortcut;
      if (!sc) return false;
      const modOk = sc.mod ? event.metaKey || event.ctrlKey : true;
      const altOk = sc.alt ? event.altKey : !event.altKey;
      const shiftOk = sc.shift ? event.shiftKey : !event.shiftKey;
      return modOk && altOk && shiftOk && event.key.toLowerCase() === sc.key.toLowerCase();
    };

    const trigger = (view: EditorView, id: string) => {
      const ctx = computeEditorActionContext(view, 'selection');
      if (ctx.target !== 'selection' || ctx.text.trim().length === 0) return;
      ext.options.onAction(id, ctx);
    };

    return [
      new Plugin({
        key: selectionBubblePluginKey,
        view(editorView) {
          let bubble: BubbleView | null = createBubbleDom(
            ext.options.className,
            ext.options.actions,
            (id) => trigger(editorView, id),
          );
          const host = editorView.dom.parentElement;
          if (host && bubble) host.append(bubble.dom);

          // 滚动容器滚动后选区视口坐标变化：重算位置，保证 bubble 始终贴住选区。
          // scroll 事件不冒泡但在捕获阶段会经过祖先链，document 捕获监听
          // 可覆盖任意后代滚动容器（不依赖特定 scrollDOM 引用）。
          const onScroll = () => {
            if (bubble && ext.storage.visible) sync(editorView);
          };
          document.addEventListener('scroll', onScroll, true);

          const destroyView = () => {
            document.removeEventListener('scroll', onScroll, true);
            bubble?.destroy();
            bubble = null;
          };

          const sync = (view: EditorView) => {
            const { selection } = view.state;
            const hasSel = !selection.empty && selection.from !== selection.to;
            let text = '';
            if (hasSel)
              text = view.state.doc.textBetween(selection.from, selection.to, '\n', '\ufffc');
            const visible = hasSel && text.trim().length > 0;
            ext.storage.visible = visible;
            if (!bubble) return;
            if (visible) {
              const ctx = computeEditorActionContext(view, 'selection');
              bubble.show(ctx.coords);
            } else {
              bubble.hide();
            }
          };

          return {
            update(view) {
              sync(view);
            },
            destroy() {
              destroyView();
            },
          };
        },
        props: {
          handleKeyDown(view, event) {
            if (view.state.selection.empty) return false;
            for (const action of ext.options.actions) {
              if (matchesShortcut(event, action)) {
                event.preventDefault();
                trigger(view, action.id);
                return true;
              }
            }
            return false;
          },
          handleDOMEvents: {
            blur(view, event) {
              // relatedTarget 在 bubble DOM 内：焦点移到工具栏按钮上，保持可见
              const bubbleDom =
                view.dom.parentElement?.querySelector<HTMLElement>('[data-selection-bubble]');
              const related = event.relatedTarget as Node | null;
              if (bubbleDom && related && bubbleDom.contains(related)) return false;
              ext.storage.visible = false;
              if (bubbleDom) bubbleDom.style.display = 'none';
              return false;
            },
            focusout(view, event) {
              // 焦点完全离开编辑器+气泡（relatedTarget 不在编辑器内也不在气泡内），隐藏气泡
              const bubbleDom =
                view.dom.parentElement?.querySelector<HTMLElement>('[data-selection-bubble]');
              const related = event.relatedTarget as Node | null;
              const leavingEditor = view.dom.contains(event.target as Node);
              const goingIntoBubble = bubbleDom && related && bubbleDom.contains(related);
              const goingIntoEditor = related && view.dom.contains(related);
              if (leavingEditor && !goingIntoBubble && !goingIntoEditor) {
                ext.storage.visible = false;
                if (bubbleDom) bubbleDom.style.display = 'none';
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});
