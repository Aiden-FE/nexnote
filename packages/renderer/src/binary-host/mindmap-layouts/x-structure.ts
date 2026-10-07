import Base from 'simple-mind-map/src/layouts/Base.js';
import { asyncRun } from 'simple-mind-map/src/utils/index.js';
import { layoutSubtree, moveSubtree } from './subtree';
import type { BranchDirection, SubtreeBox } from './subtree';
import { buildLayoutNodes, type NodeBuilderHost } from './node-builder';
import {
  centerRootAtCanvas,
  renderArmLines,
  renderDirectionalExpandBtn,
  renderDirectionalExpandBtnRect,
  renderDirectionalGeneralization,
  renderDirectionalLine,
  tagSubtreeDirection,
  type LayoutRenderCtx,
  type RenderNode,
} from './renderers';

/**
 * DEV-102 X 结构（ADR-0020 决策 4）：根节点的一级子节点分置四向象限——
 * 左上 / 右上 / 左下 / 右下，各象限的子树沿该象限方向向外生长（上象限向上、
 * 下象限向下），象限区域互不重叠。
 *
 * 分配规则（DEV-102 决策 1 + 决策 5）：
 * - 子节点 ≥ 3：按 左上 → 右上 → 左下 → 右下 循环填满象限；
 * - 子节点恰为 2：退化为左右形式（与库内 mindMap 同样偶数下标向右、奇数下标向左）；
 * - 子节点降至 < 2：不重排成别的形状，保留该子节点上一次被分配到的象限方向
 *   （「画布保留最后一次有效分布」）。
 */

/** 象限分配顺序（轮转填充）。 */
const SECTOR_CYCLE = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

type Sector = (typeof SECTOR_CYCLE)[number];

/**
 * 一级子节点最近一次被分配到的分布（跨渲染保留，供子节点减少到 1 个时沿用）。
 * 存「象限」而非只存方向：象限同时决定贴哪一侧与向上/向下，只存方向会丢信息。
 */
type Assignment = { kind: 'quadrant'; sector: Sector } | { kind: 'side'; side: 'left' | 'right' };

const lastAssignment = new Map<string, Assignment>();

interface QuadrantRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 上象限的子树向上生长，下象限向下生长。 */
const sectorDirection = (sector: Sector): BranchDirection =>
  sector.startsWith('top') ? 'up' : 'down';

export class XStructure extends Base {
  override doLayout(callback: (root: SmmInternal.LayoutNode) => void): void {
    asyncRun([
      () => buildLayoutNodes(this as unknown as NodeBuilderHost),
      () => this.positionTree(),
      () => callback(this.root),
    ]);
  }

  private positionTree(): void {
    const root = this.root;
    const children = root.children ?? [];
    // 根节点先落在原点（中心 0,0），最后统一按库内 initRootNodePosition 规则平移。
    root.left = -root.width / 2;
    root.top = -root.height / 2;
    // 一级子节点位于第 2 层，其子树间距从 getMarginX(2) 起算（second / node 区分层）
    const gap = (depth: number): number => this.getMarginX(2 + depth);

    if (children.length >= 3) {
      this.placeQuadrants(root, children, gap);
    } else if (children.length === 2) {
      this.placeHorizontalPair(root, children, gap);
    } else if (children.length === 1) {
      this.placeRememberedArm(root, children[0] as RenderNode, gap);
    }

    centerRootAtCanvas(
      this as unknown as LayoutRenderCtx & { setNodeCenter(node: RenderNode): void },
      root,
    );
  }

  /** 四象限：每象限一块互不重叠的区域；同象限多棵子树沿轴向堆叠，首个最靠根节点。 */
  private placeQuadrants(
    root: RenderNode,
    children: RenderNode[],
    gap: (depth: number) => number,
  ): void {
    // 子节点 ≥ 5 时一个象限会有多棵子树（SECTOR_CYCLE 轮转），因此先按象限分组。
    const groups = new Map<Sector, Array<{ child: RenderNode; box: SubtreeBox }>>();
    children.forEach((child, index) => {
      const sector = SECTOR_CYCLE[index % SECTOR_CYCLE.length] as Sector;
      const direction = sectorDirection(sector);
      const box = layoutSubtree(child, direction, gap);
      tagSubtreeDirection(child, direction);
      lastAssignment.set(child.uid, { kind: 'quadrant', sector });
      const group = groups.get(sector) ?? [];
      group.push({ child, box });
      groups.set(sector, group);
    });

    const g = gap(0);
    const halfWidth = root.width / 2;
    const halfHeight = root.height / 2;
    // 象限区域：宽 = 该象限最宽的子树；高 = 同象限子树纵向堆叠之和。
    const rects = {} as Record<Sector, QuadrantRect>;
    for (const sector of SECTOR_CYCLE) {
      const group = groups.get(sector) ?? [];
      const width = group.reduce((max, item) => Math.max(max, item.box.width), 0);
      const height =
        group.reduce((sum, item) => sum + item.box.height, 0) + g * Math.max(group.length - 1, 0);
      rects[sector] = {
        left: sector.endsWith('left') ? -halfWidth - g - width : halfWidth + g,
        top: sector.startsWith('top') ? -halfHeight - g - height : halfHeight + g,
        width,
        height,
      };
    }

    for (const sector of SECTOR_CYCLE) {
      const rect = rects[sector];
      const group = groups.get(sector) ?? [];
      let along = 0;
      for (const { child, box } of group) {
        // 包围盒在象限内朝根节点一侧对齐（左象限贴右边界、上象限贴下边界）
        const boxLeft = sector.endsWith('left') ? rect.left + rect.width - box.width : rect.left;
        const boxTop = sector.startsWith('top')
          ? rect.top + rect.height - along - box.height
          : rect.top + along;
        along += box.height + g;
        // box.offset 是「包围盒左上角相对锚点中心」的偏移，故锚点中心 = 盒左上角 - offset
        moveSubtree(child, boxLeft - box.offsetX, boxTop - box.offsetY);
      }
    }
  }

  /** 恰好 2 个子节点：左右形式（偶数下标向右、奇数下标向左，与库内 mindMap 一致）。 */
  private placeHorizontalPair(
    root: RenderNode,
    children: RenderNode[],
    gap: (depth: number) => number,
  ): void {
    const right = children[0] as RenderNode;
    const left = children[1] as RenderNode;
    this.placeSide(root, right, 'right', gap);
    this.placeSide(root, left, 'left', gap);
  }

  /**
   * 子节点降到 1 个（菜单已置灰 X 结构，但不改写用户存的结构）：
   * 沿用该子节点上一次被分配到的象限方向，不把画布重排成别的形状（DEV-102 决策 5）。
   * 没有历史（例如刚切到 X 结构）时兜底向右。
   */
  private placeRememberedArm(
    root: RenderNode,
    child: RenderNode,
    gap: (depth: number) => number,
  ): void {
    const remembered = lastAssignment.get(child.uid);
    if (!remembered || remembered.kind === 'side') {
      this.placeSide(root, child, remembered?.side ?? 'right', gap);
      return;
    }
    const direction = sectorDirection(remembered.sector);
    const box = layoutSubtree(child, direction, gap);
    tagSubtreeDirection(child, direction);
    const g = gap(0);
    const boxLeft = -box.width / 2;
    const boxTop = direction === 'up' ? -root.height / 2 - g - box.height : root.height / 2 + g;
    moveSubtree(child, boxLeft - box.offsetX, boxTop - box.offsetY);
  }

  /** 把一棵子树摆到根节点的一侧：包围盒贴根边界，纵向以根中心为轴居中。 */
  private placeSide(
    root: RenderNode,
    child: RenderNode,
    side: 'left' | 'right',
    gap: (depth: number) => number,
  ): void {
    const box = layoutSubtree(child, side, gap);
    tagSubtreeDirection(child, side);
    lastAssignment.set(child.uid, { kind: 'side', side });
    const g = gap(0);
    const halfWidth = root.width / 2;
    const boxLeft = side === 'right' ? halfWidth + g : -halfWidth - g - box.width;
    const boxTop = -box.height / 2;
    moveSubtree(child, boxLeft - box.offsetX, boxTop - box.offsetY);
  }

  private ctx(): LayoutRenderCtx {
    return this as unknown as LayoutRenderCtx;
  }

  private directionOf(node: unknown): BranchDirection {
    const marked = (node as RenderNode | undefined)?.nexDirection;
    return marked ?? 'down';
  }

  override renderLine(node: unknown, lines: unknown[], style: unknown, lineStyle: unknown): void {
    // 根节点的一级子节点方向各异，走「臂」连线（直线连到子节点边界）
    if ((node as RenderNode | undefined)?.isRoot) {
      renderArmLines(
        this.ctx(),
        node as RenderNode,
        lines as Parameters<typeof renderDirectionalLine>[2],
        style,
      );
      return;
    }
    renderDirectionalLine(
      this.ctx(),
      node as RenderNode,
      lines as Parameters<typeof renderDirectionalLine>[2],
      style,
      lineStyle,
      this.directionOf(node),
    );
  }

  override renderExpandBtn(node: unknown, btn: unknown): void {
    renderDirectionalExpandBtn(
      this.ctx(),
      node as RenderNode,
      btn as Parameters<typeof renderDirectionalExpandBtn>[2],
      this.directionOf(node),
    );
  }

  override renderGeneralization(list: unknown[]): void {
    // 概要按所属节点的朝向分组渲染：X 结构里四个象限方向不同，概要应贴在各自节点的近侧。
    const groups = new Map<BranchDirection, unknown[]>();
    for (const item of list as Array<{ node?: RenderNode }>) {
      const direction = this.directionOf(item.node);
      const group = groups.get(direction) ?? [];
      group.push(item);
      groups.set(direction, group);
    }
    for (const [direction, items] of groups) {
      renderDirectionalGeneralization(
        this as unknown as Parameters<typeof renderDirectionalGeneralization>[0],
        items as Parameters<typeof renderDirectionalGeneralization>[1],
        direction,
      );
    }
  }

  override renderExpandBtnRect(
    rect: unknown,
    expandBtnSize: number,
    width: number,
    height: number,
    node: unknown,
  ): void {
    renderDirectionalExpandBtnRect(
      rect as Parameters<typeof renderDirectionalExpandBtnRect>[0],
      expandBtnSize,
      width,
      height,
      this.directionOf(node),
    );
  }
}

export default XStructure;
