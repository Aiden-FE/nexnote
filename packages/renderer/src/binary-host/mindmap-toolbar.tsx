import { useEffect, useRef, useState } from 'react';
import {
  Undo2,
  Redo2,
  Save,
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCcw,
  Palette,
  MoveRight,
  MoveLeft,
  MoveUp,
  MoveDown,
  GitBranch,
  Asterisk,
} from 'lucide-react';
import type MindMap from 'simple-mind-map';
import { MINDMAP_THEME_PRESETS } from './mindmap-themes';
import {
  MINDMAP_STRUCTURE_OPTIONS,
  isStructureSelectable,
  MIN_ROOT_CHILDREN_FOR_X,
  type MindmapStructureIcon,
} from './mindmap-structures';
import type { MindmapStructureId } from '@nexnote/shared';

/** DEV-102：结构菜单的图标映射（icon 字段与 lucide 组件的连接点，收在此处）。 */
const STRUCTURE_ICONS: Record<MindmapStructureIcon, typeof MoveRight> = {
  'arrow-right': MoveRight,
  'arrow-left': MoveLeft,
  'arrow-up': MoveUp,
  'arrow-down': MoveDown,
  'git-branch': GitBranch,
  asterisk: Asterisk,
};

/**
 * DEV-099：xmind 画布四角悬浮工具组（grill Q1/Q13）：
 * 左上 = 撤销 / 重做 / 保存状态 / 立即保存；右上 = 缩小 / 百分比 / 放大 / 适应画布 / 复位 / 主题。
 * 画布保持占满宿主，工具组悬浮覆盖、常驻半透明、hover 提亮，不自动隐藏。
 */

export interface MindmapToolbarProps {
  mindMap: MindMap | null;
  scale: number;
  themeId: string;
  /** session 落盘状态（编辑中… / 已保存 / 失败文案）。 */
  saveStatus: string | null;
  onThemeChange: (themeId: string) => void;
  onSaveNow: () => void;
  /** DEV-102：当前布局结构 id（sidecar 回读 + 菜单高亮）。 */
  structure: MindmapStructureId;
  /** DEV-102：根节点一级子节点数（X 结构门控）。 */
  rootChildCount: number;
  /** DEV-102：选择结构回调（编辑器负责应用 setLayout + sidecar 写回）。 */
  onStructureChange: (structure: MindmapStructureId) => void;
}

function FloatButton({
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
      className="rounded p-1.5 text-neutral-600 hover:bg-white/80 hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-700/80 dark:hover:text-white"
    >
      {children}
    </button>
  );
}

const GROUP_CLASS =
  'pointer-events-auto flex items-center gap-0.5 rounded-lg border border-neutral-200/70 bg-white/70 px-1 py-0.5 shadow-sm backdrop-blur transition-opacity hover:bg-white/95 dark:border-neutral-700/70 dark:bg-neutral-800/70 dark:hover:bg-neutral-800/95';

export function MindmapToolbar({
  mindMap,
  scale,
  themeId,
  saveStatus,
  onThemeChange,
  onSaveNow,
  structure,
  rootChildCount,
  onStructureChange,
}: MindmapToolbarProps): React.JSX.Element {
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [structureMenuOpen, setStructureMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const structureMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!themeMenuOpen && !structureMenuOpen) return;
    const onDown = (e: MouseEvent): void => {
      if (themeMenuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setThemeMenuOpen(false);
      }
      if (
        structureMenuOpen &&
        structureMenuRef.current &&
        !structureMenuRef.current.contains(e.target as Node)
      ) {
        setStructureMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [themeMenuOpen, structureMenuOpen]);

  const call = (method: 'enlarge' | 'narrow' | 'fit' | 'reset'): void => {
    if (!mindMap) return;
    const v = (mindMap as unknown as { view: Record<string, () => void> }).view;
    v[method]?.();
  };

  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 z-20">
        <div className={GROUP_CLASS}>
          <FloatButton
            title="撤销 (Ctrl+Z)"
            disabled={!mindMap}
            onClick={() => mindMap?.execCommand('BACK')}
          >
            <Undo2 className="size-4" />
          </FloatButton>
          <FloatButton
            title="重做 (Ctrl+Shift+Z)"
            disabled={!mindMap}
            onClick={() => mindMap?.execCommand('FORWARD')}
          >
            <Redo2 className="size-4" />
          </FloatButton>
          <span
            data-testid="mindmap-save-status"
            className="max-w-40 truncate px-1 text-xs text-neutral-500 dark:text-neutral-400"
            title={saveStatus ?? '已保存'}
          >
            {saveStatus ?? '已保存'}
          </span>
          <FloatButton title="立即保存 (Ctrl+S)" onClick={onSaveNow}>
            <Save className="size-4" />
          </FloatButton>
        </div>
      </div>

      <div className="pointer-events-none absolute right-3 top-3 z-20">
        <div className={GROUP_CLASS}>
          <FloatButton title="缩小" disabled={!mindMap} onClick={() => call('narrow')}>
            <ZoomOut className="size-4" />
          </FloatButton>
          <span
            data-testid="mindmap-zoom-percent"
            className="min-w-11 select-none text-center text-xs tabular-nums text-neutral-600 dark:text-neutral-300"
          >
            {Math.round(scale * 100)}%
          </span>
          <FloatButton title="放大" disabled={!mindMap} onClick={() => call('enlarge')}>
            <ZoomIn className="size-4" />
          </FloatButton>
          <FloatButton title="适应画布" disabled={!mindMap} onClick={() => call('fit')}>
            <Maximize className="size-4" />
          </FloatButton>
          <FloatButton title="复位 100%" disabled={!mindMap} onClick={() => call('reset')}>
            <RotateCcw className="size-4" />
          </FloatButton>
          <div ref={structureMenuRef} className="relative">
            <FloatButton title="结构" onClick={() => setStructureMenuOpen((open) => !open)}>
              <GitBranch className="size-4" />
            </FloatButton>
            {structureMenuOpen && (
              <div
                role="menu"
                data-testid="mindmap-structure-menu"
                className="absolute right-0 top-9 z-30 w-40 rounded-md border border-neutral-200 bg-white py-1 shadow-md dark:border-neutral-700 dark:bg-neutral-800"
              >
                {MINDMAP_STRUCTURE_OPTIONS.map((option) => {
                  const selectable = isStructureSelectable(option.id, rootChildCount);
                  const Icon = STRUCTURE_ICONS[option.icon];
                  const isCurrent = option.id === structure;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="menuitem"
                      data-testid={`mindmap-structure-${option.id}`}
                      aria-current={isCurrent ? 'true' : undefined}
                      disabled={!selectable}
                      title={
                        selectable
                          ? option.label
                          : `${option.label}（需 ${MIN_ROOT_CHILDREN_FOR_X} 个以上子节点）`
                      }
                      onClick={() => {
                        onStructureChange(option.id);
                        setStructureMenuOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-700 ${
                        isCurrent
                          ? 'font-semibold text-neutral-900 dark:text-white'
                          : 'text-neutral-600 dark:text-neutral-300'
                      } ${selectable ? '' : 'cursor-not-allowed opacity-40'}`}
                    >
                      {Icon && <Icon className="size-3.5" aria-hidden="true" />}
                      <span className="flex-1">{option.label}</span>
                      {!selectable && <span className="text-[10px]">需 2 个以上子节点</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div ref={menuRef} className="relative">
            <FloatButton title="主题" onClick={() => setThemeMenuOpen((open) => !open)}>
              <Palette className="size-4" />
            </FloatButton>
            {themeMenuOpen && (
              <div
                role="menu"
                data-testid="mindmap-theme-menu"
                className="absolute right-0 top-9 z-30 w-28 rounded-md border border-neutral-200 bg-white py-1 shadow-md dark:border-neutral-700 dark:bg-neutral-800"
              >
                {MINDMAP_THEME_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    role="menuitem"
                    data-testid={`mindmap-theme-${preset.id}`}
                    onClick={() => {
                      onThemeChange(preset.id);
                      setThemeMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-700 ${
                      preset.id === themeId
                        ? 'font-semibold text-neutral-900 dark:text-white'
                        : 'text-neutral-600 dark:text-neutral-300'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="size-3 rounded-full border border-neutral-300"
                      style={{
                        backgroundColor:
                          (preset.config.root as { fillColor?: string })?.fillColor ?? '#888',
                      }}
                    />
                    {preset.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
