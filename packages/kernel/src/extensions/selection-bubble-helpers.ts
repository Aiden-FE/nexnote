/**
 * 划词工具栏共享 DOM 构造（DEV-ARCH-001）：块编辑（PM）与源码（CM）两条
 * 编辑器路径共用的按钮装饰、Tooltip 与 AI 下拉菜单。
 *
 * 只持有「从 BubbleAction 描述构造安全 DOM」的逻辑；挂载、定位与可见性归
 * `selection-toolbar-host.ts`，编辑器状态翻译归两侧适配器。
 */

import type { BubbleIconName, BubbleIconRenderer } from './selection-bubble-icons';
import { tCurrent } from '@nexnote/shared';
import { resolveMenuTitle } from './menu-title';

export type { BubbleIconRenderer } from './selection-bubble-icons';

export interface BubbleAiMenuOptions {
  label?: string;
  actions: BubbleAction[];
}

export interface BubbleAction {
  id: string;
  /** App-owned items use catalog keys; plugin contributions may provide source text. */
  titleKey?: string;
  /** Plugin-defined titles are content contributed by the plugin, not app UI copy. */
  titleText?: string;
  /** @deprecated use `titleText` (source text) or `titleKey` (app copy). */
  title?: string;
  /** 纯图标动作的稳定图标语义，由 DOM/CSS 渲染，避免绑定 UI framework。 */
  icon?: BubbleIconName;
  hint?: string;
  disabled?: boolean | (() => boolean);
  disabledReason?: string | (() => string | undefined);
  /** 快捷键显示，如 '⌘⌥R'；与 shortcut 匹配时键盘触发。 */
  shortcutLabel?: string;
  shortcut?: { mod: boolean; alt?: boolean; shift?: boolean; key: string };
}

const resolveBoolean = (value: boolean | (() => boolean) | undefined): boolean =>
  typeof value === 'function' ? value() : (value ?? false);
const resolveText = (value: string | (() => string | undefined) | undefined): string | undefined =>
  typeof value === 'function' ? value() : value;

/** 动作显示名：与应用自有 key / 插件原文共用同一解析规则（ADR-0023）。 */
const bubbleActionTitle = (action: BubbleAction): string => resolveMenuTitle(action);

export function bubbleTooltipText(action: BubbleAction): string {
  const reason = resolveText(action.disabledReason);
  const title = bubbleActionTitle(action);
  const label = action.shortcutLabel
    ? tCurrent('common.withParenthetical', {
        text: title,
        detail: action.shortcutLabel,
      })
    : (action.hint ?? title);
  return reason ? `${label} — ${reason}` : label;
}

/**
 * 创建图标容器（DEV-063）。
 * - 优先调用 `renderer` 解析语义名为 SVG；命中后 SVG 直接挂载。
 * - renderer 未命中（如 wikilink 没有 lucide 对应）回退到紧凑文字表达，保留 data-icon 语义。
 * - 永不设置 innerHTML；只通过 document.createElementNS / setAttribute / textContent。
 */
function createBubbleIcon(
  className: string,
  icon: BubbleIconName | 'chevron-down',
  renderer: BubbleIconRenderer,
): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = `${className}__icon`;
  span.dataset.icon = icon;
  span.setAttribute('aria-hidden', 'true');
  const svg = renderer(icon);
  if (svg) {
    span.append(svg);
    return span;
  }
  if (icon === 'wikilink') {
    span.classList.add(`${className}__icon--fallback`);
    span.textContent = '[[]]';
  } else {
    span.textContent = '•';
  }
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
  const title = bubbleActionTitle(action);
  button.setAttribute(
    'aria-label',
    reason ? tCurrent('common.withParenthetical', { text: title, detail: reason }) : title,
  );
  button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
}

export function decorateBubbleButton(
  button: HTMLButtonElement,
  className: string,
  action: BubbleAction,
  renderer: BubbleIconRenderer,
  options: { menuItem?: boolean; tooltip?: boolean } = {},
): void {
  refreshBubbleButton(button, action);
  if (action.icon) button.append(createBubbleIcon(className, action.icon, renderer));
  if (!action.icon || options.menuItem) {
    const label = document.createElement('span');
    label.className = `${className}__label`;
    label.dataset.bubbleAiLabel = '';
    label.textContent = bubbleActionTitle(action);
    button.append(label);
  }
  if (options.tooltip !== false)
    attachBubbleTooltip(button, className, () => bubbleTooltipText(action));
}

/** Shared AI dropdown for block and source editors. */
export interface BubbleAiMenuView {
  dom: HTMLDivElement;
  close(options?: { restoreFocus?: boolean }): void;
  destroy(): void;
}

export function createBubbleAiMenu(
  className: string,
  options: BubbleAiMenuOptions,
  renderer: BubbleIconRenderer,
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
  trigger.setAttribute('aria-label', tCurrent('bubble.aiMenu.trigger'));
  trigger.append(createBubbleIcon(className, 'sparkles', renderer));
  const triggerLabel = document.createElement('span');
  triggerLabel.className = `${className}__ai-label`;
  triggerLabel.textContent = options.label ?? 'AI';
  const chevron = createBubbleIcon(className, 'chevron-down', renderer);
  chevron.classList.add(`${className}__chevron`);
  trigger.append(triggerLabel, chevron);
  const triggerTooltip = attachBubbleTooltip(trigger, className, () =>
    tCurrent('bubble.aiMenu.tooltip'),
  );

  const menu = document.createElement('div');
  menu.className = `${className}__ai-menu`;
  menu.dataset.aiMenu = '';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', tCurrent('bubble.aiMenu.menuLabel'));
  menu.hidden = true;
  menu.style.bottom = 'calc(100% + 4px)';
  menu.style.left = '0px';

  const items: HTMLButtonElement[] = [];
  /** 与 items 同序缓存可见 label 节点：重开菜单时按当前语言重算，不做选择器拼接。 */
  const labels: (HTMLSpanElement | null)[] = [];
  for (const action of options.actions) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `${className}__ai-item`;
    item.dataset.aiMenuAction = action.id;
    item.setAttribute('role', 'menuitem');
    decorateBubbleButton(item, className, action, renderer, { menuItem: true, tooltip: false });
    labels.push(item.querySelector<HTMLSpanElement>('[data-bubble-ai-label]'));
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

  const enabledItems = () =>
    items.filter((item) => item.getAttribute('aria-disabled') !== 'true');
  const focusItem = (index: number) => {
    const enabled = enabledItems();
    enabled[(index + enabled.length) % enabled.length]?.focus();
  };
  const open = (focus: 'first' | 'last' = 'first') => {
    // 语言可能在工具栏存活期间切换：重开时按当前语言重算菜单 chrome 与动作文案。
    trigger.setAttribute('aria-label', tCurrent('bubble.aiMenu.trigger'));
    menu.setAttribute('aria-label', tCurrent('bubble.aiMenu.menuLabel'));
    labels.forEach((label, index) => {
      const action = options.actions[index]!;
      refreshBubbleButton(items[index]!, action);
      if (label) label.textContent = bubbleActionTitle(action);
    });
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


export interface BubbleExtraControl {
  dom: HTMLElement;
  destroy?: () => void;
}
