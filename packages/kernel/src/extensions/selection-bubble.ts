import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

import { computeEditorActionContext, type EditorActionContext } from './action-context';
import {
  createSelectionToolbarHost,
  type SelectionToolbarHost,
} from './selection-toolbar-host';
import { dispatchBubbleShortcut } from './selection-bubble-roving';

export {
  createBubbleAiMenu,
  attachBubbleTooltip,
  decorateBubbleButton,
  refreshBubbleButton,
  bubbleTooltipText,
} from './selection-bubble-helpers';
export type { BubbleAction, BubbleAiMenuOptions, BubbleAiMenuView, BubbleExtraControl } from './selection-bubble-helpers';
export type { BubbleIconName, BubbleIconRenderer } from './selection-bubble-icons';

export interface SelectionBubbleOptions {
  actions: import('./selection-bubble-helpers').BubbleAction[];
  aiMenu?: import('./selection-bubble-helpers').BubbleAiMenuOptions;
  extraControl?: import('./selection-bubble-helpers').BubbleExtraControl;
  /** 图标渲染器（DEV-063）：语义名解析为 SVG 节点，缺省走 lucide renderer。 */
  iconRenderer?: import('./selection-bubble-icons').BubbleIconRenderer;
  onAction: (id: string, ctx: EditorActionContext) => void;
  className?: string;
}

export const selectionBubblePluginKey = new PluginKey<{ visible: boolean }>(
  'nexnoteSelectionBubble',
);

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

    const trigger = (view: EditorView, id: string) => {
      const ctx = computeEditorActionContext(view, 'selection');
      if (ctx.target !== 'selection' || ctx.text.trim().length === 0) return;
      ext.options.onAction(id, ctx);
    };

    return [
      new Plugin({
        key: selectionBubblePluginKey,
        view(editorView) {
          let manuallyDismissed = false;
          let host: SelectionToolbarHost | null = createSelectionToolbarHost({
            actions: ext.options.actions,
            aiMenu: ext.options.aiMenu,
            extraControl: ext.options.extraControl,
            iconRenderer: ext.options.iconRenderer,
            className: ext.options.className,
            datasetFlag: 'selectionBubble',
            // PM：挂到编辑器宿主 DOM，坐标以容器为参照（与历史行为一致，
            // 保留既有 container.querySelector('[data-selection-bubble]') 测试）。
            mount: editorView.dom.parentElement,
            coordinateSpace: 'parent',
            // PM：动作触发后保留工具栏（AI 生成中的停止控件必须保持可点）
            hideOnAction: () => false,
            onAction(id) {
              trigger(editorView, id);
            },
            onToolbarFocusOut() {
              // 焦点真正离开工具栏（落到工具栏外）：与原 PM 行为一致，
              // 通过 host 隐藏 + 设置 manuallyDismissed 防止下次 sync 复活。
              manuallyDismissed = true;
              ext.storage.visible = false;
              host?.hide();
            },
            onToolbarEscape() {
              manuallyDismissed = true;
              ext.storage.visible = false;
              host?.hide();
              editorView.focus();
            },
          });

          const sync = (view: EditorView) => {
            if (manuallyDismissed) return;
            const { selection } = view.state;
            const hasSel = !selection.empty && selection.from !== selection.to;
            let text = '';
            if (hasSel)
              text = view.state.doc.textBetween(selection.from, selection.to, '\n', '\ufffc');
            const visible = hasSel && text.trim().length > 0;
            ext.storage.visible = visible;
            if (!host) return;
            if (visible) {
              const ctx = computeEditorActionContext(view, 'selection');
              host.sync(true, ctx.coords);
            } else {
              host.sync(false, null);
            }
          };

          // 滚动容器滚动后选区视口坐标变化：重算位置，保证 bubble 始终贴住选区。
          // document 捕获监听覆盖任意后代滚动容器（不依赖特定 scrollDOM 引用）。
          const onScroll = () => {
            if (host && ext.storage.visible) sync(editorView);
          };
          document.addEventListener('scroll', onScroll, true);

          return {
            update(view, previousState) {
              if (!view.state.selection.eq(previousState.selection)) {
                manuallyDismissed = false;
                host?.resetDismiss();
              }
              sync(view);
            },
            destroy() {
              document.removeEventListener('scroll', onScroll, true);
              host?.destroy();
              host = null;
            },
          };
        },
        props: {
          handleKeyDown(view, event) {
            const bubbleDom =
              view.dom.parentElement?.querySelector<HTMLElement>('[data-selection-bubble]');
            const eventFromBubble = bubbleDom?.contains(event.target as Node | null) ?? false;
            if (event.key === 'Escape' && ext.storage.visible && !eventFromBubble) {
              event.preventDefault();
              ext.storage.visible = false;
              if (bubbleDom) bubbleDom.style.display = 'none';
              return true;
            }
            if (view.state.selection.empty) return false;
            const shortcutActions = [
              ...ext.options.actions,
              ...(ext.options.aiMenu?.actions ?? []),
            ];
            return dispatchBubbleShortcut(event, shortcutActions, (id) => trigger(view, id));
          },
          handleDOMEvents: {
            blur(view, event) {
              const bubbleDom =
                view.dom.parentElement?.querySelector<HTMLElement>('[data-selection-bubble]');
              const related = event.relatedTarget as Node | null;
              if (bubbleDom && related && bubbleDom.contains(related)) return false;
              ext.storage.visible = false;
              if (bubbleDom) bubbleDom.style.display = 'none';
              return false;
            },
            focusout(view, event) {
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
