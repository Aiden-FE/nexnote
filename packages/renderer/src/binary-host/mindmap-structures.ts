import {
  MIN_ROOT_CHILDREN_FOR_X_STRUCTURE,
  MINDMAP_STRUCTURE_IDS,
  type MindmapStructureId,
} from '@nexnote/shared';

export const MIN_ROOT_CHILDREN_FOR_X = MIN_ROOT_CHILDREN_FOR_X_STRUCTURE;

/**
 * DEV-102 / ADR-0020：xmind 布局结构选项（节点生长方向的排布）。
 *
 * - 四项映射库内布局：right/left（逻辑结构）、down（组织结构图）、fishbone（鱼骨图）。
 * - up / x 为本仓库自研布局类（见 mindmap-layouts/），layout 名为库内不存在的标识，
 *   由 registerCustomMindmapLayouts 挂到实例上后 setLayout 才能命中。
 * - 纯定义模块：不 import simple-mind-map，便于单测与工具栏复用。
 */

/** 结构菜单的示意小图标键（与 mindmap-toolbar 的图标映射一一对应）。 */
export type MindmapStructureIcon =
  'arrow-right' | 'arrow-left' | 'arrow-up' | 'arrow-down' | 'git-branch' | 'asterisk';

export interface MindmapStructureOption {
  id: MindmapStructureId;
  label: string;
  /** 传给 simple-mind-map 的布局名（库内名或自研布局注册的标识）。 */
  layout: string;
  /** 是否为本仓库自研布局（自研布局下 v1 不启用节点拖拽，见 ADR-0020 Consequences）。 */
  custom: boolean;
  icon: MindmapStructureIcon;
}

export const MINDMAP_STRUCTURE_OPTIONS: MindmapStructureOption[] = [
  {
    id: 'right',
    label: '向右分支',
    layout: 'logicalStructure',
    custom: false,
    icon: 'arrow-right',
  },
  {
    id: 'left',
    label: '向左分支',
    layout: 'logicalStructureLeft',
    custom: false,
    icon: 'arrow-left',
  },
  { id: 'up', label: '向上分支', layout: 'nexxUpStructure', custom: true, icon: 'arrow-up' },
  {
    id: 'down',
    label: '向下分支',
    layout: 'organizationStructure',
    custom: false,
    icon: 'arrow-down',
  },
  { id: 'fishbone', label: '鱼骨结构', layout: 'fishbone', custom: false, icon: 'git-branch' },
  { id: 'x', label: 'X 结构', layout: 'nexxXStructure', custom: true, icon: 'asterisk' },
];

export const DEFAULT_MINDMAP_STRUCTURE: MindmapStructureId = 'right';

const OPTION_BY_ID = new Map(MINDMAP_STRUCTURE_OPTIONS.map((option) => [option.id, option]));

/** 未知/未登记 id 一律回退到默认结构（sidecar 可能被手改或来自旧版本）。 */
export function structureById(id: unknown): MindmapStructureOption {
  const key =
    typeof id === 'string'
      ? (MINDMAP_STRUCTURE_IDS as readonly string[]).find((it) => it === id)
      : undefined;
  const option = key ? OPTION_BY_ID.get(key as MindmapStructureId) : undefined;
  return option ?? (OPTION_BY_ID.get(DEFAULT_MINDMAP_STRUCTURE) as MindmapStructureOption);
}

/** 结构是否可选：仅 X 结构受根节点子节点数门控（ADR-0020 决策 4）。 */
export function isStructureSelectable(id: MindmapStructureId, rootChildCount: number): boolean {
  if (id === 'x') return rootChildCount >= MIN_ROOT_CHILDREN_FOR_X_STRUCTURE;
  return true;
}

/** 根节点一级子节点数（X 结构可用性的唯一依据）。 */
export function countRootChildren(model: unknown): number {
  if (!model || typeof model !== 'object') return 0;
  const children = (model as { children?: unknown }).children;
  return Array.isArray(children) ? children.length : 0;
}
