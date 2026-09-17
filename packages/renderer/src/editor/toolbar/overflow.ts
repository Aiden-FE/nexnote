export interface ToolbarLayoutEntry {
  id: string;
  width: number;
  /** 相邻且同名的动作构成不可拆分的响应式单元（如三态视图切换器）。 */
  overflowGroup?: string;
}

export interface ToolbarLayout {
  visibleIds: string[];
  overflowIds: string[];
}

/**
 * 单行工具栏的 Priority+ 布局（纯函数，便于单测）：从左到右放入动作，放不下的
 * 移入「更多」溢出菜单。
 *
 * - 全部放得下时不需要「更多」，也不为其预留空间
 * - 需要溢出时，「更多」按钮与间距一并预留
 * - 可用宽度连「更多」都放不下时，全部动作进入菜单（「更多」始终可达）
 */
export function resolveToolbarLayout(
  entries: readonly ToolbarLayoutEntry[],
  availableWidth: number,
  moreWidth: number,
  gap = 4,
): ToolbarLayout {
  if (entries.length === 0) return { visibleIds: [], overflowIds: [] };
  const total = entries.reduce((sum, entry) => sum + entry.width, 0) + gap * (entries.length - 1);
  if (total <= availableWidth) {
    return { visibleIds: entries.map((entry) => entry.id), overflowIds: [] };
  }

  // 语义动作组与普通单动作都归一为布局单元。同组入口只能一起可见或一起溢出，
  // 避免窄窗把三态视图切换器等控件拆散；「格式 / 插入」本身已是单个 menu 单元。
  const units: ToolbarLayoutEntry[][] = [];
  for (const entry of entries) {
    const previous = units.at(-1);
    if (entry.overflowGroup && previous?.[0]?.overflowGroup === entry.overflowGroup)
      previous.push(entry);
    else units.push([entry]);
  }

  const visibleIds: string[] = [];
  let used = 0;
  const reserved = Math.max(0, moreWidth) + gap;
  for (const unit of units) {
    const unitWidth = unit.reduce((sum, entry) => sum + entry.width, 0) + gap * (unit.length - 1);
    const next = used + unitWidth + (visibleIds.length > 0 ? gap : 0);
    if (next + reserved > availableWidth) break;
    visibleIds.push(...unit.map((entry) => entry.id));
    used = next;
  }
  const visibleSet = new Set(visibleIds);
  return {
    visibleIds,
    overflowIds: entries.filter((entry) => !visibleSet.has(entry.id)).map((entry) => entry.id),
  };
}
