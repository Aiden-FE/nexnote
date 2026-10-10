import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';
import {
  Plus,
  Columns2,
  Trash2,
  StickyNote,
  Link2,
  X,
  Shapes,
  Palette,
  BadgeCheck,
} from 'lucide-react';
import type MindMap from 'simple-mind-map';
import { MINDMAP_MARKERS } from './mindmap-icons';

/**
 * DEV-099：选中节点后拉开的右侧抽屉（grill Q1/Q4/Q7/Q12）：
 * 悬浮覆盖画布右侧（不推挤），三节——节点操作 / 样式（形状·颜色·标记）/ 附加（备注·超链接）。
 * 展开/折叠属临时视图状态、不入抽屉：simple-mind-map 核心在节点激活/悬停时
 * 于连接线起点自绘折叠按钮。
 * 选中节点自动开、取消选中自动收，头部提供手动收合按钮。
 */

export interface MindmapDrawerProps {
  mindMap: MindMap | null;
  /** 当前激活节点（simple-mind-map node 实例，opaque handle）。 */
  activeNodes: unknown[];
  open: boolean;
  onClose: () => void;
}

/** 12 色 curated 调色板（grill Q9）；填充/边框/文字三目标共用。 */
const COLOR_SWATCHES = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#84cc16',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#64748b',
] as const;

/** 6 种形状（grill Q10）。 */
const SHAPES: Array<{ id: string; label: string }> = [
  { id: 'rectangle', label: 'binary.drawer.rectangle' },
  { id: 'roundedRectangle', label: 'binary.drawer.roundedRectangle' },
  { id: 'ellipse', label: 'binary.drawer.ellipse' },
  { id: 'circle', label: 'binary.drawer.circle' },
  { id: 'diamond', label: 'binary.drawer.diamond' },
  { id: 'parallelogram', label: 'binary.drawer.parallelogram' },
];

type NodeHandle = {
  getData?: (key?: string) => unknown;
  setData?: (data: Record<string, unknown>) => void;
};

function SectionTitle({ icon, text }: { icon: React.ReactNode; text: string }): React.JSX.Element {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
      {icon}
      {text}
    </div>
  );
}

function DrawerButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-700"
    >
      {children}
    </button>
  );
}

export function MindmapDrawer({
  mindMap,
  activeNodes,
  open,
  onClose,
}: MindmapDrawerProps): React.JSX.Element | null {
  const t = useI18n();
  const [note, setNote] = useState('');
  const [hyperlink, setHyperlink] = useState('');
  const hasSelection = activeNodes.length > 0;

  // 切换选中节点时回填备注/超链接输入框：刻意的「选中集合变化即重置受控输入」，
  // 不宜用 key 重挂载（抽屉其余节需保持挂载），故定向抑制保守的 set-state-in-effect。
  useEffect(() => {
    const first = activeNodes[0] as NodeHandle | undefined;
    const data = (first?.getData?.() ?? {}) as { note?: string; hyperlink?: string };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNote(data.note ?? '');
    setHyperlink(data.hyperlink ?? '');
    // 仅在选中集合变化时回填；输入过程不触发（避免光标跳动）。
  }, [activeNodes]);

  if (!open) return null;

  const each = (fn: (node: never) => void): void => {
    for (const node of activeNodes) fn(node as never);
  };
  const exec = (command: string, ...args: unknown[]): void => {
    (mindMap as unknown as { execCommand: (c: string, ...a: unknown[]) => void })?.execCommand(
      command,
      ...args,
    );
  };
  const nodeIconList = (node: NodeHandle): string[] => {
    const data = (node.getData?.() ?? {}) as { icon?: string[] };
    return Array.isArray(data.icon) ? data.icon : [];
  };

  return (
    <aside
      data-testid="mindmap-drawer"
      className="absolute bottom-3 right-3 top-14 z-20 flex w-64 flex-col overflow-hidden rounded-lg border border-neutral-200/80 bg-white/90 shadow-lg backdrop-blur dark:border-neutral-700/80 dark:bg-neutral-800/90"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
        <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">
          {t('binary.drawer.title', {
            selection: hasSelection
              ? t('binary.drawer.selectionCount', { count: activeNodes.length })
              : '',
          })}
        </span>
        <button
          type="button"
          aria-label={t('binary.drawer.collapse')}
          title={t('binary.drawer.collapse')}
          onClick={onClose}
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        <section>
          <SectionTitle icon={<Plus className="size-3.5" />} text={t('binary.drawer.node')} />
          <div className="grid grid-cols-2 gap-1.5">
            <DrawerButton
              title={t('binary.drawer.addChild')}
              disabled={!mindMap || !hasSelection}
              onClick={() => exec('INSERT_CHILD_NODE', false, activeNodes)}
            >
              <Plus className="size-3.5" /> {t('binary.drawer.child')}
            </DrawerButton>
            <DrawerButton
              title={t('binary.drawer.addSibling')}
              disabled={!mindMap || !hasSelection}
              onClick={() => exec('INSERT_NODE', false, activeNodes)}
            >
              <Columns2 className="size-3.5" /> {t('binary.drawer.sibling')}
            </DrawerButton>
            <DrawerButton
              title={t('binary.drawer.deleteNode')}
              disabled={!mindMap || !hasSelection}
              onClick={() => exec('REMOVE_NODE', activeNodes)}
            >
              <Trash2 className="size-3.5" /> {t('binary.drawer.delete')}
            </DrawerButton>
          </div>
        </section>

        <section>
          <SectionTitle icon={<Shapes className="size-3.5" />} text={t('binary.drawer.shape')} />
          <div className="grid grid-cols-3 gap-1.5">
            {SHAPES.map((shape) => (
              <DrawerButton
                key={shape.id}
                title={t(shape.label)}
                disabled={!mindMap || !hasSelection}
                onClick={() => each((node) => exec('SET_NODE_SHAPE', node, shape.id))}
              >
                <span className="w-full truncate text-center">{t(shape.label)}</span>
              </DrawerButton>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle icon={<Palette className="size-3.5" />} text={t('binary.drawer.color')} />
          {(['fillColor', 'borderColor', 'color'] as const).map((prop) => (
            <div key={prop} className="mb-1.5">
              <div className="mb-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                {prop === 'fillColor'
                  ? t('binary.drawer.fillColor')
                  : prop === 'borderColor'
                    ? t('binary.drawer.borderColor')
                    : t('binary.drawer.textColor')}
              </div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  title={t('binary.drawer.none')}
                  aria-label={t('binary.drawer.colorNone', { prop })}
                  disabled={!mindMap || !hasSelection}
                  onClick={() =>
                    each((node) =>
                      exec(
                        'SET_NODE_STYLE',
                        node,
                        prop,
                        prop === 'color' ? '#1f2328' : 'transparent',
                      ),
                    )
                  }
                  className="size-4 rounded border border-neutral-300 bg-white dark:border-neutral-600 dark:bg-neutral-800"
                />
                {COLOR_SWATCHES.map((color) => (
                  <button
                    key={color}
                    type="button"
                    title={color}
                    aria-label={`${prop} ${color}`}
                    disabled={!mindMap || !hasSelection}
                    onClick={() => each((node) => exec('SET_NODE_STYLE', node, prop, color))}
                    className="size-4 rounded border border-black/10"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>

        <section>
          <SectionTitle icon={<BadgeCheck className="size-3.5" />} text={t('binary.drawer.markers')} />
          <div className="grid grid-cols-6 gap-1">
            {MINDMAP_MARKERS.map((marker) => (
              <button
                key={marker.id}
                type="button"
                title={t(marker.label)}
                aria-label={t(marker.label)}
                disabled={!mindMap || !hasSelection}
                onClick={() =>
                  each((node) => {
                    const handle = node as unknown as NodeHandle;
                    const icons = nodeIconList(handle);
                    const next = icons.includes(marker.svg)
                      ? icons.filter((item) => item !== marker.svg)
                      : [...icons, marker.svg];
                    exec('SET_NODE_ICON', node, next);
                  })
                }
                className="flex items-center justify-center rounded border border-transparent p-0.5 hover:border-neutral-300 hover:bg-neutral-100 disabled:opacity-40 dark:hover:border-neutral-600 dark:hover:bg-neutral-700"
              >
                <img
                  src={`data:image/svg+xml,${encodeURIComponent(marker.svg)}`}
                  alt=""
                  width={16}
                  height={16}
                  className="pointer-events-none"
                />
              </button>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle icon={<StickyNote className="size-3.5" />} text={t('binary.drawer.note')} />
          <textarea
            data-testid="mindmap-note-input"
            value={note}
            disabled={!hasSelection}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => each((node) => exec('SET_NODE_NOTE', node, note))}
            rows={3}
            placeholder={
            hasSelection ? t('binary.drawer.notePlaceholderSelected') : t('binary.drawer.notePlaceholder')
          }
            className="w-full resize-none rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <SectionTitle icon={<Link2 className="size-3.5" />} text={t('binary.drawer.link')} />
          <input
            data-testid="mindmap-link-input"
            value={hyperlink}
            disabled={!hasSelection}
            onChange={(e) => setHyperlink(e.target.value)}
            onBlur={() => each((node) => exec('SET_NODE_HYPERLINK', node, hyperlink))}
            placeholder={
              hasSelection
                ? t('binary.drawer.linkPlaceholderSelected')
                : t('binary.drawer.linkPlaceholder')
            }
            className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </section>
      </div>
    </aside>
  );
}
