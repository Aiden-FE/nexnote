/**
 * DEV-102：子树排布的纯几何内核（不 import simple-mind-map，可直接单测）。
 *
 * 自研布局（向上分支 / X 结构）都基于同一个原语：给定一棵已创建好节点实例的树，
 * 按「父在下 / 子在上」或「父在右 / 子在左」两种朝向做一次自底向上的排布，
 * 返回以「该子树锚点节点自身中心」为原点、向下为正的包围盒。
 *
 * 与库内布局的差别：库内布局先算尺寸、再单独遍历算 top/left、最后用一轮
 * adjustTop/adjustLeft 补偿兄弟重叠；这里自底向上单遍完成——包围盒由子节点面积
 * 精确推出，因此不需要补偿遍历。
 */

/**
 * 子树排布朝向：
 * - down：父在上、子在下（组织结构图 / 向下分支）
 * - up：父在下、子在上（向上分支）
 * - right：父在左、子在右（向右分支）
 * - left：父在右、子在左（向左分支）
 */
export type BranchDirection = 'down' | 'up' | 'left' | 'right';

/**
 * 层间距：定值，或按「离子树根的层数」取值（库内 second.marginX / node.marginX 分层，
 * 自研布局据此对齐同一套间距）。
 */
export type GapSpec = number | ((childDepth: number) => number);

/** 只需尺寸与 children 的节点形状（兼容 simple-mind-map 的节点实例）。 */
export interface LayoutNode {
  width: number;
  height: number;
  left: number;
  top: number;
  children: LayoutNode[];
  /** 节点是否展开：折叠节点的子树不参与排布（默认展开）。 */
  expanded?: boolean;
}

export interface SubtreeBox {
  width: number;
  height: number;
  /** 包围盒左上角，相对锚点节点中心的偏移。 */
  offsetX: number;
  offsetY: number;
}

const isVertical = (direction: BranchDirection): boolean =>
  direction === 'up' || direction === 'down';
/** 朝向决定包围盒的起点沿贴着父节点的哪一侧。 */
const growsForward = (direction: BranchDirection): boolean =>
  direction === 'down' || direction === 'right';

const alongSizeOf = (node: LayoutNode, direction: BranchDirection): number =>
  isVertical(direction) ? node.height : node.width;
const acrossSizeOf = (node: LayoutNode, direction: BranchDirection): number =>
  isVertical(direction) ? node.width : node.height;
const boxAlong = (box: SubtreeBox, direction: BranchDirection): number =>
  isVertical(direction) ? box.height : box.width;
const boxAcross = (box: SubtreeBox, direction: BranchDirection): number =>
  isVertical(direction) ? box.width : box.height;

/**
 * 以「锚点节点中心」为原点排布一棵子树，并把每个节点的 left/top 写回。
 *
 * 约定：
 * - 锚点节点自身中心落在原点（left/top = -尺寸/2）。
 * - 沿生长方向，子树包围盒的近沿距锚点边界一个 gap；兄弟带两端各留一个 gap。
 * - 包围盒返回给调用方，用于把整棵子树摆进父级坐标系。
 */
export function layoutSubtree(
  node: LayoutNode,
  direction: BranchDirection,
  gap: GapSpec,
  depth = 0,
): SubtreeBox {
  // 1) 锚点自身中心置于原点。
  node.left = -node.width / 2;
  node.top = -node.height / 2;

  const nodeAlong = alongSizeOf(node, direction);
  const nodeAcross = acrossSizeOf(node, direction);
  const children = Array.isArray(node.children) && node.expanded !== false ? node.children : [];
  const gapHere = typeof gap === 'number' ? gap : gap(depth);

  const makeBox = (alongExtent: number, acrossExtent: number): SubtreeBox => {
    // 沿轴起点：包围盒起点沿贴锚点边界（down/right 在前，up/left 在后）；
    // 跨轴方向：兄弟带（或节点自身）以锚点中心为轴居中。
    const alongStart = growsForward(direction) ? -nodeAlong / 2 : nodeAlong / 2 - alongExtent;
    return {
      width: isVertical(direction) ? acrossExtent : alongExtent,
      height: isVertical(direction) ? alongExtent : acrossExtent,
      offsetX: isVertical(direction) ? -acrossExtent / 2 : alongStart,
      offsetY: isVertical(direction) ? alongStart : -acrossExtent / 2,
    };
  };

  if (children.length === 0) {
    return makeBox(nodeAlong, nodeAcross);
  }

  // 2) 自底向上：先排好每个子节点子树，得到各自的包围盒。
  const boxes = children.map((child) => layoutSubtree(child, direction, gap, depth + 1));

  // 3) 跨轴方向（兄弟带）：依次排布，兄弟之间与两端各留 gap。
  const bandAcross =
    boxes.reduce((sum, box) => sum + boxAcross(box, direction), 0) +
    gapHere * (children.length + 1);
  const across = Math.max(bandAcross, nodeAcross);

  // 4) 沿轴方向：包围盒长度 = 锚点尺寸 + gap + 最深子树。
  const depthOf = (list: SubtreeBox[], dir: BranchDirection): number =>
    list.reduce((max, box) => Math.max(max, boxAlong(box, dir)), 0);
  const along = nodeAlong + gapHere + depthOf(boxes, direction);

  // 5) 子节点落位：跨轴按兄弟带游标，沿轴紧邻锚点边界（间隔 gap）。
  const anchor = growsForward(direction) ? nodeAlong / 2 + gapHere : -(nodeAlong / 2 + gapHere);
  let cursor = -bandAcross / 2 + gapHere;
  children.forEach((child, index) => {
    const box = boxes[index] as SubtreeBox;
    const acrossCenter = cursor + boxAcross(box, direction) / 2;
    cursor += boxAcross(box, direction) + gapHere;
    const alongCenter = growsForward(direction)
      ? anchor + alongSizeOf(child, direction) / 2
      : anchor - alongSizeOf(child, direction) / 2;

    // 子树内部是相对「子节点中心」排的，整体平移到目标中心。
    moveSubtree(
      child,
      isVertical(direction) ? acrossCenter : alongCenter,
      isVertical(direction) ? alongCenter : acrossCenter,
    );
  });

  return makeBox(along, across);
}

/**
 * 递归平移整棵子树，保持内部相对位置。
 * 「中心」指 node.left/top 所在坐标系里要叠加的位移（node 左上角 = 中心 - 尺寸/2）。
 */
export function moveSubtree(node: LayoutNode, centerX: number, centerY: number): void {
  node.left += centerX;
  node.top += centerY;
  // 折叠节点不参与排布，其子树也不随父级平移（库内布局同样跳过折叠子树）。
  if (node.expanded === false) return;
  for (const child of node.children ?? []) moveSubtree(child, centerX, centerY);
}
