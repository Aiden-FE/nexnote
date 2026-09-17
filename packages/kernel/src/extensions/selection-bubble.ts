import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

import { computeEditorActionContext, type EditorActionContext } from './action-context';
import {
  bindSelectionBubbleToolbarRoving,
  dispatchBubbleShortcut,
  disableSelectionBubbleToolbarTabStops,
  moveSelectionBubbleToolbarFocus,
  syncSelectionBubbleToolbarTabStop,
} from './selection-bubble-roving';

/**
 * 选区浮动工具栏（框架无关 DOM 实现）。
 *
 * 非折叠文本选区时，在选区上方居中浮现工具条；按钮来自配置（渲染层注入六个 AI 动作）。
 * - mousedown 拦截以保留选区；点击触发 onAction(id, ctx)（ctx.target = selection）
 * - 快捷键：mod(+alt)+<key> 且选区非折叠时触发同一动作
 * - 折叠选区 / 编辑器失焦 / 选区为空时隐藏
 */

export type BubbleIconName =
  'bold' | 'italic' | 'strike' | 'code' | 'link' | 'wikilink' | 'sparkles' | 'stop';

export interface BubbleAction {
  id: string;
  /** 共享可访问名称；菜单项也使用此文字。 */
  title: string;
  /** 纯图标动作的稳定图标语义，由 DOM/CSS 渲染，避免绑定 UI framework。 */
  icon?: BubbleIconName;
  hint?: string;
  disabled?: boolean | (() => boolean);
  disabledReason?: string | (() => string | undefined);
  /** 快捷键显示，如 '⌘⌥R'；与 shortcut 匹配时键盘触发。 */
  shortcutLabel?: string;
  shortcut?: { mod: boolean; alt?: boolean; shift?: boolean; key: string };
}

export interface BubbleAiMenuOptions {
  label?: string;
  actions: BubbleAction[];
}

export interface BubbleExtraControl {
  dom: HTMLElement;
  destroy?: () => void;
}

export interface SelectionBubbleOptions {
  actions: BubbleAction[];
  aiMenu?: BubbleAiMenuOptions;
  extraControl?: BubbleExtraControl;
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

export interface BubbleAiMenuView {
  dom: HTMLDivElement;
  close(options?: { restoreFocus?: boolean }): void;
  destroy(): void;
}

const resolveBoolean = (value: boolean | (() => boolean) | undefined): boolean =>
  typeof value === 'function' ? value() : (value ?? false);
const resolveText = (value: string | (() => string | undefined) | undefined): string | undefined =>
  typeof value === 'function' ? value() : value;

function bubbleTooltipText(action: BubbleAction): string {
  const reason = resolveText(action.disabledReason);
  const label = action.shortcutLabel
    ? `${action.title}（${action.shortcutLabel}）`
    : (action.hint ?? action.title);
  return reason ? `${label} — ${reason}` : label;
}

function createBubbleIcon(className: string, icon: BubbleIconName): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = `${className}__icon`;
  span.dataset.icon = icon;
  span.setAttribute('aria-hidden', 'true');
  return span;
}

export function attachBubbleTooltip(
  button: HTMLButtonElement,
  className: string,
  text: () => string,
): HTMLSpanElement {
  const tooltip = document.createElement('span');
  tooltip.className = `${className}__tooltip`;
  tooltip.dataset.bubbleTooltip = '';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.textContent = text();
  tooltip.hidden = true;
  button.append(tooltip);
  const show = () => {
    tooltip.textContent = text();
    tooltip.hidden = false;
  };
  const hide = () => {
    tooltip.hidden = true;
  };
  button.addEventListener('pointerenter', show);
  button.addEventListener('focus', show);
  button.addEventListener('pointerleave', hide);
  button.addEventListener('blur', hide);
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || tooltip.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    hide();
  });
  return tooltip;
}

/** Refresh dynamically-computed action accessibility state without rebuilding its DOM. */
export function refreshBubbleButton(button: HTMLButtonElement, action: BubbleAction): void {
  const disabled = resolveBoolean(action.disabled);
  const reason = resolveText(action.disabledReason);
  button.setAttribute('aria-label', reason ? `${action.title}（${reason}）` : action.title);
  button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
}

export function decorateBubbleButton(
  button: HTMLButtonElement,
  className: string,
  action: BubbleAction,
  options: { menuItem?: boolean; tooltip?: boolean } = {},
): void {
  refreshBubbleButton(button, action);
  if (action.icon) button.append(createBubbleIcon(className, action.icon));
  if (!action.icon || options.menuItem) {
    const label = document.createElement('span');
    label.className = `${className}__label`;
    label.textContent = action.title;
    button.append(label);
  }
  if (options.tooltip !== false)
    attachBubbleTooltip(button, className, () => bubbleTooltipText(action));
}

/** Shared AI dropdown for block and source editors. */
export function createBubbleAiMenu(
  className: string,
  options: BubbleAiMenuOptions,
  onTrigger: (id: string) => void,
  restoreEditorFocus?: () => void,
): BubbleAiMenuView {
  const wrapper = document.createElement('div');
  wrapper.className = `${className}__ai`;
  wrapper.dataset.aiDropdown = '';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = `${className}__action ${className}__ai-trigger`;
  trigger.dataset.bubbleAction = 'ai:menu';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', 'AI 菜单');
  trigger.append(createBubbleIcon(className, 'sparkles'));
  const triggerLabel = document.createElement('span');
  triggerLabel.className = `${className}__ai-label`;
  triggerLabel.textContent = options.label ?? 'AI';
  const chevron = document.createElement('span');
  chevron.className = `${className}__chevron`;
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '⌄';
  trigger.append(triggerLabel, chevron);
  const triggerTooltip = attachBubbleTooltip(trigger, className, () => 'AI 写作、询问与翻译');

  const menu = document.createElement('div');
  menu.className = `${className}__ai-menu`;
  menu.dataset.aiMenu = '';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'AI 操作');
  menu.hidden = true;
  menu.style.bottom = 'calc(100% + 4px)';
  menu.style.left = '0px';

  const items: HTMLButtonElement[] = [];
  for (const action of options.actions) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `${className}__ai-item`;
    item.dataset.aiMenuAction = action.id;
    item.setAttribute('role', 'menuitem');
    decorateBubbleButton(item, className, action, { menuItem: true, tooltip: false });
    item.tabIndex = -1;
    const hint = action.shortcutLabel ?? action.hint;
    if (hint) {
      const hintDom = document.createElement('span');
      hintDom.className = `${className}__shortcut`;
      hintDom.textContent = hint;
      item.append(hintDom);
    }
    item.addEventListener('mousedown', (event) => event.preventDefault());
    item.addEventListener('click', (event) => {
      event.preventDefault();
      if (resolveBoolean(action.disabled)) return;
      close({ restoreFocus: true });
      onTrigger(action.id);
      queueMicrotask(() => {
        const toolbar = wrapper.closest<HTMLElement>(
          '[data-selection-bubble], [data-source-selection-bubble]',
        );
        if (!toolbar || toolbar.style.display === 'none') restoreEditorFocus?.();
      });
    });
    items.push(item);
    menu.append(item);
  }

  const enabledItems = () => items.filter((item) => item.getAttribute('aria-disabled') !== 'true');
  const focusItem = (index: number) => {
    const enabled = enabledItems();
    enabled[(index + enabled.length) % enabled.length]?.focus();
  };
  const open = (focus: 'first' | 'last' = 'first') => {
    items.forEach((item, index) => refreshBubbleButton(item, options.actions[index]!));
    const enabled = enabledItems();
    if (enabled.length === 0) return;
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    menu.style.left = '0px';
    menu.style.right = '';
    const triggerRect = trigger.getBoundingClientRect();
    if (triggerRect.left + menu.offsetWidth > window.innerWidth - 8) {
      menu.style.left = '';
      menu.style.right = '0px';
    }
    focusItem(focus === 'first' ? 0 : enabled.length - 1);
  };
  const close: BubbleAiMenuView['close'] = (closeOptions) => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (closeOptions?.restoreFocus) {
      trigger.focus({ preventScroll: true });
      triggerTooltip.hidden = true;
    }
  };

  trigger.addEventListener('mousedown', (event) => event.preventDefault());
  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    if (menu.hidden) open();
    else close();
  });
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.hidden && !triggerTooltip.hidden) {
      event.preventDefault();
      event.stopPropagation();
      triggerTooltip.hidden = true;
      return;
    }
    if (event.key === 'Escape' && menu.hidden) return;
    if (!['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Escape'].includes(event.key)) return;
    event.stopPropagation();
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open('first');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      open('last');
    } else if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault();
      close();
    }
  });
  menu.addEventListener('keydown', (event) => {
    event.stopPropagation();
    const enabled = enabledItems();
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(current + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(current - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusItem(enabled.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close({ restoreFocus: true });
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      enabled[current]?.click();
    } else if (event.key === 'Tab') {
      close();
    }
  });
  wrapper.addEventListener('focusout', (event) => {
    const related = (event as FocusEvent).relatedTarget as Node | null;
    if (!related || !wrapper.contains(related)) close();
  });
  wrapper.append(trigger, menu);
  return { dom: wrapper, close, destroy: () => wrapper.remove() };
}

function createBubbleDom(
  className: string,
  actions: BubbleAction[],
  aiMenuOptions: BubbleAiMenuOptions | undefined,
  extraControl: BubbleExtraControl | undefined,
  onTrigger: (id: string) => void,
  onDismiss: (options?: { focusEditor?: boolean }) => void,
  restoreEditorFocus: () => void,
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
    decorateBubbleButton(btn, className, action);
    btn.addEventListener('mousedown', (e) => {
      // 阻止 mousedown 抢夺编辑器选区
      e.preventDefault();
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (resolveBoolean(action.disabled)) return;
      onTrigger(action.id);
    });
    dom.append(btn);
  }

  const aiMenu = aiMenuOptions
    ? createBubbleAiMenu(className, aiMenuOptions, onTrigger, restoreEditorFocus)
    : null;
  if (aiMenu) dom.append(aiMenu.dom);
  if (extraControl) dom.append(extraControl.dom);
  const disposeRoving = bindSelectionBubbleToolbarRoving(dom);
  dom.addEventListener('focusout', (event) => {
    const related = event.relatedTarget as Node | null;
    if (related && dom.contains(related)) return;
    onDismiss();
  });

  dom.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onDismiss({ focusEditor: true });
      return;
    }
    moveSelectionBubbleToolbarFocus(dom, event);
  });

  const refreshActions = () => {
    const actionById = new Map(actions.map((action) => [action.id, action]));
    for (const button of Array.from(
      dom.querySelectorAll<HTMLButtonElement>('[data-bubble-action]'),
    )) {
      const action = actionById.get(button.dataset.bubbleAction ?? '');
      if (action) refreshBubbleButton(button, action);
    }
  };
  const show: BubbleView['show'] = (coords) => {
    dom.style.display = 'flex';
    refreshActions();
    syncSelectionBubbleToolbarTabStop(dom);
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
    aiMenu?.close();
    disableSelectionBubbleToolbarTabStops(dom);
  };
  const destroy = () => {
    disposeRoving();
    aiMenu?.destroy();
    extraControl?.destroy?.();
    dom.remove();
  };
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
          let bubble: BubbleView | null = createBubbleDom(
            ext.options.className,
            ext.options.actions,
            ext.options.aiMenu,
            ext.options.extraControl,
            (id) => trigger(editorView, id),
            (options) => {
              manuallyDismissed = true;
              ext.storage.visible = false;
              bubble?.hide();
              if (options?.focusEditor) editorView.focus();
            },
            () => editorView.focus(),
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
            const visible = hasSel && text.trim().length > 0 && !manuallyDismissed;
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
            update(view, previousState) {
              if (!view.state.selection.eq(previousState.selection)) manuallyDismissed = false;
              sync(view);
            },
            destroy() {
              destroyView();
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
