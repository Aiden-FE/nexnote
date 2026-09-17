import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { ChevronDown, MoreHorizontal } from 'lucide-react';
import { ToolbarTooltip } from './Tooltip';
import { cn } from '../../lib/utils';
import { AI_ENTRY_ID, type ToolbarEntrySpec, type ToolbarSubItemSpec } from './entries';
import { resolveToolbarLayout } from './overflow';

const resolveDisabled = (value: boolean | (() => boolean) | undefined): boolean =>
  typeof value === 'function' ? value() : (value ?? false);

const resolveDisabledReason = (
  value: string | (() => string | undefined) | undefined,
): string | undefined => (typeof value === 'function' ? value() : value);

/** 溢出菜单触发器 id（工具栏内部使用，不与业务动作 id 冲突）。 */
export const TOOLBAR_MORE_ID = 'toolbar:more';
/** 动作之间的水平间距（与容器 gap-1 一致，参与宽度计算）。 */
const ITEM_GAP = 4;
/** 「更多」按钮宽度尚未测得时的兜底估值。 */
const MORE_WIDTH_FALLBACK = 32;

export interface EditorToolbarProps {
  /** 工具栏可访问名称（role=toolbar） */
  label: string;
  /** 声明式动作表（见 entries.tsx），不含处理函数。 */
  entries: ToolbarEntrySpec[];
  /** 动作分发：工具栏按钮与溢出菜单项都经此回调执行。 */
  onCommand: (id: string) => void;
  /** 右侧固定控件（如属性 Popover 触发器）；不参与溢出，始终保持可见。 */
  tools?: ReactNode;
  /** 右侧状态展示（保存状态）；只读状态，不是动作。 */
  status?: ReactNode;
}

interface PanelState {
  entryId: string;
  /** 打开后要聚焦的菜单项位置。 */
  focus: 'first' | 'last' | null;
  /** 触发按钮矩形（菜单锚定在其下方）。 */
  left: number;
  top: number;
}

/**
 * 编辑器单行工具栏（DEV-035）。
 *
 * - 动作 Icon-first（ADR-0006）：顶层默认仅图标，AI 入口为 Sparkles + `AI` + chevron
 *   例外；名称、快捷键与禁用原因由统一 Tooltip 承载（hover / focus 可达，Esc 关闭）
 * - 宽度不足时按 Priority+ 规则把尾部动作收进「更多」溢出菜单
 *   （{@link resolveToolbarLayout}），同一动作组的入口整体移动、不拆散
 * - 「更多」保留原分组：AI 入口整体折叠为一个分组标题 + 其全部子动作
 * - 键盘：工具栏内 ←/→/Home/End 移动焦点（roving tabindex）；菜单 ↑/↓/Home/End
 *   移动、Enter/Space 执行、Esc 关闭并把焦点还给触发器
 *
 * 宽度由动作按钮实测宽度 + 容器宽度（ResizeObserver）得出；测量不可用（容器或动作
 * 宽度为 0）时退回「全部平铺」，保证任何情况下动作都可达。
 */
export function EditorToolbar({ label, entries, onCommand, tools, status }: EditorToolbarProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const widths = useRef(new Map<string, number>());
  const panelRef = useRef<HTMLDivElement>(null);
  const signatureRef = useRef('');
  const [overflow, setOverflow] = useState<string[]>([]);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const signature = entries.map((entry) => entry.id).join('|');
  const visible = entries.filter((entry) => !overflow.includes(entry.id));
  const hidden = entries.filter((entry) => overflow.includes(entry.id));
  const active = panel ? entries.find((entry) => entry.id === panel.entryId) : undefined;
  const panelItems: ToolbarSubItemSpec[] =
    active?.kind === 'menu'
      ? active.items
      : hidden.flatMap((entry) =>
          entry.kind === 'menu'
            ? entry.items
            : [
                {
                  id: entry.id,
                  label: entry.label,
                  icon: entry.icon,
                  shortcut: entry.shortcut,
                  disabled: entry.disabled,
                  disabledReason: entry.disabledReason,
                },
              ],
        );

  /** 实测并缓存当前渲染出的动作按钮宽度，再按可用宽度决定溢出集合。 */
  const recompute = useCallback((): void => {
    const row = rowRef.current;
    if (!row) return;
    refs.current.forEach((el, id) => {
      const width = el.getBoundingClientRect().width;
      if (width > 0) widths.current.set(id, width);
    });
    const available = row.getBoundingClientRect().width;
    const measured = entries.map((entry) => ({
      id: entry.id,
      width: widths.current.get(entry.id) ?? 0,
      overflowGroup: entry.overflowGroup,
    }));
    // 容器或动作尚未测得宽度（首帧、无布局环境）：保持全部平铺。
    if (available <= 0 || measured.some((entry) => entry.width <= 0)) return;
    const layout = resolveToolbarLayout(
      measured,
      available,
      widths.current.get(TOOLBAR_MORE_ID) ?? MORE_WIDTH_FALLBACK,
      ITEM_GAP,
    );
    setOverflow((prev) =>
      prev.length === layout.overflowIds.length &&
      prev.every((id, index) => id === layout.overflowIds[index])
        ? prev
        : layout.overflowIds,
    );
  }, [entries]);

  // 测量驱动布局：渲染后、绘制前按实测宽度收敛溢出集合（React 的 measure-before-paint
  // 用例；setOverflow 有同值短路，不会自激）。
  /* eslint-disable react-hooks/set-state-in-effect -- 测量后才知布局，收敛溢出集合 */
  useLayoutEffect(() => {
    // 动作集合变化（换模式 = 换一套动作）：作废宽度缓存，先平铺一帧再重新测量。
    if (signatureRef.current !== signature) {
      signatureRef.current = signature;
      for (const id of [...widths.current.keys()]) {
        if (id !== TOOLBAR_MORE_ID) widths.current.delete(id);
      }
      if (overflow.length > 0) {
        setOverflow([]);
        return;
      }
    }
    recompute();
  }, [entries, signature, overflow.length, recompute]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => recompute());
      observer.observe(row);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [recompute]);

  // 打开菜单后聚焦指定菜单项（WAI-ARIA menu 行为）。
  useLayoutEffect(() => {
    if (!panel?.focus) return;
    const items = [
      ...(panelRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? []),
    ].filter((el) => !el.disabled);
    (panel.focus === 'last' ? items[items.length - 1] : items[0])?.focus();
  }, [panel]);

  useEffect(() => {
    if (!panel) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      refs.current.get(panel.entryId)?.focus();
      setPanel(null);
    };
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if ([...refs.current.values()].some((el) => el.contains(target))) return;
      setPanel(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointerDown, true);
    };
  }, [panel]);

  const openPanel = (entryId: string, focus: PanelState['focus']): void => {
    const rect = refs.current.get(entryId)?.getBoundingClientRect();
    setPanel({ entryId, focus, left: rect?.left ?? 8, top: (rect?.bottom ?? 0) + 4 });
  };

  const onToolbarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [
      ...(rowRef.current?.querySelectorAll<HTMLButtonElement>('button[data-toolbar-item="true"]') ??
        []),
    ].filter((el) => !el.disabled);
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (((current + step) % buttons.length) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) return;
    const buttons = [
      ...(panelRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? []),
    ].filter((el) => !el.disabled);
    if (buttons.length === 0) return;
    if (event.key === 'Tab') {
      setPanel(null);
      return;
    }
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (((current + step) % buttons.length) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  const register = (id: string, el: HTMLButtonElement | null): void => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  };

  const trigger = (entry: ToolbarEntrySpec, index: number): ReactNode => {
    const isMenu = entry.kind === 'menu';
    const expanded = panel?.entryId === entry.id;
    const disabled = entry.kind === 'action' && resolveDisabled(entry.disabled);
    const reason = resolveDisabledReason(entry.disabledReason);
    const tooltipLabel = entry.shortcut ? `${entry.label}（${entry.shortcut}）` : entry.label;
    const tooltipText = reason ? `${tooltipLabel} — ${reason}` : (entry.hint ?? tooltipLabel);
    const labeled = entry.id === AI_ENTRY_ID;
    return (
      <ToolbarTooltip key={entry.id} text={tooltipText}>
        <button
          ref={(el) => register(entry.id, el)}
          type="button"
          data-toolbar-item="true"
          data-item-id={entry.id}
          data-testid={`toolbar-entry-${entry.id}`}
          aria-label={reason ? `${entry.label}（${reason}）` : entry.label}
          aria-disabled={disabled || undefined}
          aria-haspopup={isMenu ? 'menu' : undefined}
          aria-expanded={isMenu ? expanded : undefined}
          tabIndex={focusId === entry.id || (!focusId && index === 0) ? 0 : -1}
          onFocus={() => setFocusId(entry.id)}
          onClick={() => {
            if (disabled) return;
            if (!isMenu) {
              onCommand(entry.id);
              return;
            }
            if (expanded) setPanel(null);
            else openPanel(entry.id, 'first');
          }}
          onKeyDown={(event) => {
            if (!isMenu || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
            event.preventDefault();
            openPanel(entry.id, event.key === 'ArrowDown' ? 'first' : 'last');
          }}
          className={cn(
            'flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
            expanded && 'bg-accent text-foreground',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          {entry.icon}
          {labeled && <span className="text-[11px]">{entry.label}</span>}
          {isMenu && <ChevronDown className="size-2.5 shrink-0" aria-hidden="true" />}
        </button>
      </ToolbarTooltip>
    );
  };

  const menuItem = (item: ToolbarSubItemSpec): ReactNode => {
    const disabled = resolveDisabled(item.disabled);
    const reason = resolveDisabledReason(item.disabledReason);
    return (
      <button
        key={item.id}
        type="button"
        role="menuitem"
        data-testid={`toolbar-menu-item-${item.id}`}
        aria-label={reason ? `${item.label}（${reason}）` : item.label}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (disabled) return;
          onCommand(item.id);
          setPanel(null);
        }}
        className={cn(
          'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
          disabled ? 'cursor-not-allowed text-muted-foreground/50' : 'hover:bg-accent',
        )}
      >
        {item.icon && (
          <span className="flex size-3.5 shrink-0 items-center justify-center">{item.icon}</span>
        )}
        <span className="flex-1 truncate">{item.label}</span>
        {reason && <span className="text-[10px] text-muted-foreground">{reason}</span>}
        {item.shortcut && (
          <span className="text-[10px] text-muted-foreground">{item.shortcut}</span>
        )}
      </button>
    );
  };

  return (
    <div
      role="toolbar"
      aria-label={label}
      data-testid="editor-toolbar"
      className="flex h-8 shrink-0 items-center gap-1.5 border-b px-3 text-[11px] text-muted-foreground"
    >
      <div
        ref={rowRef}
        data-testid="editor-toolbar-actions"
        onKeyDown={onToolbarKeyDown}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
      >
        {visible.map((entry, index) => trigger(entry, index))}
        {hidden.length > 0 && (
          <ToolbarTooltip key={TOOLBAR_MORE_ID} text="更多">
            <button
              ref={(el) => register(TOOLBAR_MORE_ID, el)}
              type="button"
              data-toolbar-item="true"
              data-item-id={TOOLBAR_MORE_ID}
              data-testid="toolbar-more"
              aria-label="更多"
              aria-haspopup="menu"
              aria-expanded={panel?.entryId === TOOLBAR_MORE_ID}
              tabIndex={focusId === TOOLBAR_MORE_ID || (!focusId && visible.length === 0) ? 0 : -1}
              onFocus={() => setFocusId(TOOLBAR_MORE_ID)}
              onClick={() => {
                if (panel?.entryId === TOOLBAR_MORE_ID) setPanel(null);
                else openPanel(TOOLBAR_MORE_ID, 'first');
              }}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                event.preventDefault();
                openPanel(TOOLBAR_MORE_ID, event.key === 'ArrowDown' ? 'first' : 'last');
              }}
              className={cn(
                'flex h-6 shrink-0 items-center justify-center rounded px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground',
                panel?.entryId === TOOLBAR_MORE_ID && 'bg-accent text-foreground',
              )}
            >
              <MoreHorizontal className="size-3.5" aria-hidden="true" />
            </button>
          </ToolbarTooltip>
        )}
      </div>

      {tools}
      {status}

      {panel && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={active?.label ?? '更多'}
          data-testid={panel.entryId === TOOLBAR_MORE_ID ? 'toolbar-more-menu' : 'toolbar-menu'}
          onKeyDown={onPanelKeyDown}
          style={{
            left: Math.min(panel.left, Math.max(8, window.innerWidth - 300)),
            top: panel.top,
          }}
          className="fixed z-50 min-w-[200px] max-w-[300px] rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {panel.entryId === TOOLBAR_MORE_ID
            ? hidden.map((entry) =>
                entry.kind === 'menu' ? (
                  <div key={entry.id}>
                    <div
                      role="presentation"
                      data-testid={`toolbar-more-group-${entry.id}`}
                      className="px-2 py-1 text-[10px] font-medium text-muted-foreground"
                    >
                      {entry.label}
                    </div>
                    {entry.items.map((item) => menuItem(item))}
                  </div>
                ) : (
                  menuItem({
                    id: entry.id,
                    label: entry.label,
                    icon: entry.icon,
                    shortcut: entry.shortcut,
                    disabled: entry.disabled,
                    disabledReason: entry.disabledReason,
                  })
                ),
              )
            : panelItems.map((item) => menuItem(item))}
        </div>
      )}
    </div>
  );
}
