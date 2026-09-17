export interface ToolbarLayoutEntry {
  id: string;
  width: number;
  /** 相邻且同名的动作构成不可拆分的响应式单元（如三态视图切换器）。 */
  overflowGroup?: string;
  /** persistent 常驻项最后溢出；secondary 低频组优先整体溢出。 */
  priority?: 'persistent' | 'secondary' | 'supplementary';
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
 * - 空间不足时按优先级反序溢出：secondary（格式/插入等低频组）先整体让位，
 *   persistent 常驻集合（含 AI）最后让位；supplementary（视图/导航）居中
 * - 同一 overflowGroup 的相邻入口是不可拆分单元，只能一起可见或一起溢出
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

  // 相邻同组入口合并为布局单元：一起可见或一起进「更多」。
  const units: ToolbarLayoutEntry[][] = [];
  for (const entry of entries) {
    const previous = units.at(-1);
    if (entry.overflowGroup && previous?.[0]?.overflowGroup === entry.overflowGroup)
      previous.push(entry);
    else units.push([entry]);
  }

  // 先按原始顺序装满可见行（保证宽屏下用户看到的顺序与信息架构一致），
  // 空间不足时从尾部回收：secondary 先走、supplementary 次之、persistent 最后。
  const rank = { secondary: 0, supplementary: 1, persistent: 2 } as const;
  const priorityOf = (unit: ToolbarLayoutEntry[]): number => rank[unit[0]?.priority ?? 'secondary'];

  const fits = (keep: number): boolean => {
    const kept = units.slice(0, keep);
    if (kept.length === 0) return true;
    const width = kept.reduce(
      (sum, unit, index) =>
        sum + unit.reduce((s, entry) => s + entry.width, 0) + (index > 0 ? gap : 0),
      0,
    );
    return width + Math.max(0, moreWidth) + gap <= availableWidth;
  };

  let keep = units.length;
  while (keep > 0 && !fits(keep)) {
    // 从当前可见尾部找一个可回收单元：优先级最低者；并列时取更靠右者。
    let victim = -1;
    let victimRank = Infinity;
    for (let i = keep - 1; i >= 0; i -= 1) {
      const r = priorityOf(units[i]!);
      if (r < victimRank) {
        victimRank = r;
        victim = i;
      }
    }
    if (victim < 0) break;
    // 把被回收单元移到尾部，保持「更多」内顺序稳定（低优先级在前）。
    const [removed] = units.splice(victim, 1);
    units.push(removed!);
    keep -= 1;
  }
  // keep 之后的全在「更多」里；重新裁剪以防最后一轮 fits 已满足。
  while (keep > 0 && !fits(keep)) keep -= 1;

  const visibleIds = units.slice(0, keep).flatMap((unit) => unit.map((entry) => entry.id));
  const visibleSet = new Set(visibleIds);
  return {
    visibleIds,
    overflowIds: entries.filter((entry) => !visibleSet.has(entry.id)).map((entry) => entry.id),
  };
}
