export interface ToolbarLayoutEntry {
  id: string;
  width: number;
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

  const visibleIds: string[] = [];
  let used = 0;
  // 「更多」按钮自身及其与最后一个可见动作的间距。
  const reserved = Math.max(0, moreWidth) + gap;
  for (const entry of entries) {
    const next = used + entry.width + (visibleIds.length > 0 ? gap : 0);
    if (next + reserved > availableWidth) break;
    visibleIds.push(entry.id);
    used = next;
  }
  const visibleSet = new Set(visibleIds);
  return {
    visibleIds,
    overflowIds: entries.filter((entry) => !visibleSet.has(entry.id)).map((entry) => entry.id),
  };
}
