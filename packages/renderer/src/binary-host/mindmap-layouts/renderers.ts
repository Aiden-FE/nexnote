import { moveSubtree } from './subtree';
import type { BranchDirection } from './subtree';

/**
 * DEV-102：自研布局的连线 / 展开按钮 / 概要渲染。
 *
 * 这些函数是 simple-mind-map 库内 OrganizationStructure（上/下）与 LogicalStructure
 * （左/右）渲染代码的「按朝向参数化」版本：库内布局把方向写死在类里（isUseLeft 或
 * 固定的 top+height），自研布局需要同一套几何在四种朝向下复用，因此把方向抽成参数。
 * 三种连线风格（straight/direct/curve）都实现——默认主题是 straight，另外两种在
 * 用户改主题时不能缺。
 */

export interface LineHandle {
  plot(path: string): void;
}

export interface RenderNode {
  uid: string;
  left: number;
  top: number;
  width: number;
  height: number;
  layerIndex: number;
  isRoot?: boolean;
  expandBtnSize: number;
  children: RenderNode[];
  style: { line(line: unknown): void };
  _lines?: unknown[];
  /** DEV-102：自研布局给节点打的朝向标记，连线/展开按钮渲染按它分派。 */
  nexDirection?: 'up' | 'down' | 'left' | 'right';
}

/** Base 布局实例中本模块用到的能力（structural typing，避免耦合库内部类型）。 */
export interface LayoutRenderCtx {
  mindMap: {
    opt: Record<string, unknown>;
    themeConfig: Record<string, unknown>;
  };
  lineDraw: { path(): LineHandle };
  getMarginX(layerIndex: number): number;
  createFoldLine(list: Array<[number, number]>): string;
  quadraticCurvePath(x1: number, y1: number, x2: number, y2: number, v?: boolean): string;
  cubicBezierPath(x1: number, y1: number, x2: number, y2: number, v?: boolean): string;
  setLineStyle(style: unknown, line: LineHandle, path: string, child: RenderNode): void;
  transformPath(path: string): string;
}

export const isVerticalDirection = (direction: BranchDirection): boolean =>
  direction === 'up' || direction === 'down';

function expandBtnSizeOf(ctx: LayoutRenderCtx, node: RenderNode): number {
  const { alwaysShowExpandBtn, notShowExpandBtn } = ctx.mindMap.opt as {
    alwaysShowExpandBtn?: boolean;
    notShowExpandBtn?: boolean;
  };
  if (!alwaysShowExpandBtn || notShowExpandBtn) return 0;
  return node.expandBtnSize;
}

/** 节点到子节点的连线：按朝向与连线风格分派。 */
export function renderDirectionalLine(
  ctx: LayoutRenderCtx,
  node: RenderNode,
  lines: LineHandle[],
  style: unknown,
  lineStyle: unknown,
  direction: BranchDirection,
): void {
  if (node.children.length <= 0) return;
  if (isVerticalDirection(direction)) {
    if (lineStyle === 'curve') renderVerticalCurve(ctx, node, lines, style, direction);
    else if (lineStyle === 'direct') renderVerticalDirect(ctx, node, lines, style, direction);
    else renderVerticalStraight(ctx, node, lines, style, direction);
  } else {
    if (lineStyle === 'curve') renderHorizontalCurve(ctx, node, lines, style, direction);
    else if (lineStyle === 'direct') renderHorizontalDirect(ctx, node, lines, style, direction);
    else renderHorizontalStraight(ctx, node, lines, style, direction);
  }
}

// ── 垂直朝向（上/下）：库内 OrganizationStructure 的镜像 ────────────────────

function renderVerticalStraight(
  ctx: LayoutRenderCtx,
  node: RenderNode,
  lines: LineHandle[],
  style: unknown,
  direction: BranchDirection,
): void {
  const up = direction === 'up';
  const { left, top, width, height, isRoot } = node;
  let expandBtnSize = expandBtnSizeOf(ctx, node);
  const x1 = left + width / 2;
  // 父节点靠子节点一侧的边：向下时是底边，向上时是顶边
  const y1 = up ? top : top + height;
  const s1 = ctx.getMarginX(node.layerIndex + 1) * 0.7;
  const busY = up ? y1 - s1 : y1 + s1;
  let minx = Infinity;
  let maxx = -Infinity;
  const len = node.children.length;
  node.children.forEach((item, index) => {
    const x2 = item.left + item.width / 2;
    // 子节点靠父节点一侧的边；连线越过该边时退到远边，避免穿进节点
    const childNear = up ? item.top + item.height : item.top;
    const childFar = up ? item.top : item.top + item.height;
    const y2 = up
      ? busY < childNear
        ? childFar
        : childNear
      : busY > childNear
        ? childFar
        : childNear;
    if (x2 < minx) minx = x2;
    if (x2 > maxx) maxx = x2;
    const nodeUseLineStyleOffset = ctx.mindMap.themeConfig.nodeUseLineStyle
      ? ` L ${item.left},${y2} L ${item.left + item.width},${y2}`
      : '';
    ctx.setLineStyle(
      style,
      lines[index] as LineHandle,
      `M ${x2},${busY} L ${x2},${y2}${nodeUseLineStyleOffset}`,
      item,
    );
  });
  minx = Math.min(x1, minx);
  maxx = Math.max(x1, maxx);
  // 父节点的竖线
  const stub = ctx.lineDraw.path();
  node.style.line(stub);
  expandBtnSize = len > 0 && !isRoot ? expandBtnSize : 0;
  stub.plot(
    ctx.transformPath(
      up
        ? `M ${x1},${y1 - expandBtnSize} L ${x1},${busY}`
        : `M ${x1},${y1 + expandBtnSize} L ${x1},${busY}`,
    ),
  );
  node._lines?.push(stub);
  if (typeof style === 'function') (style as (l: unknown, n: unknown) => void)(stub, node);
  // 横向母线
  if (len > 0) {
    const bus = ctx.lineDraw.path();
    node.style.line(bus);
    bus.plot(ctx.transformPath(`M ${minx},${busY} L ${maxx},${busY}`));
    node._lines?.push(bus);
    if (typeof style === 'function') (style as (l: unknown, n: unknown) => void)(bus, node);
  }
}

function renderVerticalDirect(
  ctx: LayoutRenderCtx,
  node: RenderNode,
  lines: LineHandle[],
  style: unknown,
  direction: BranchDirection,
): void {
  const up = direction === 'up';
  const { left, top, width, height } = node;
  const expandBtnSize = expandBtnSizeOf(ctx, node);
  const x1 = left + width / 2;
  const y1 = up
    ? top - (node.layerIndex === 0 ? 0 : expandBtnSize)
    : top + height + (node.layerIndex === 0 ? 0 : expandBtnSize);
  node.children.forEach((item, index) => {
    const x2 = item.left + item.width / 2;
    const y2 = up ? item.top + item.height : item.top;
    const nodeUseLineStylePath = ctx.mindMap.themeConfig.nodeUseLineStyle
      ? ` L ${item.left},${y2} L ${item.left + item.width},${y2}`
      : '';
    ctx.setLineStyle(
      style,
      lines[index] as LineHandle,
      `M ${x1},${y1} L ${x2},${y2}${nodeUseLineStylePath}`,
      item,
    );
  });
}

function renderVerticalCurve(
  ctx: LayoutRenderCtx,
  node: RenderNode,
  lines: LineHandle[],
  style: unknown,
  direction: BranchDirection,
): void {
  const up = direction === 'up';
  const { left, top, width, height } = node;
  let expandBtnSize = expandBtnSizeOf(ctx, node);
  const { nodeUseLineStyle, rootLineStartPositionKeepSameInCurve, rootLineKeepSameInCurve } = ctx
    .mindMap.themeConfig as {
    nodeUseLineStyle?: boolean;
    rootLineStartPositionKeepSameInCurve?: boolean;
    rootLineKeepSameInCurve?: boolean;
  };
  node.children.forEach((item, index) => {
    if (node.layerIndex === 0) expandBtnSize = 0;
    const x1 = left + width / 2;
    const y1 = up
      ? node.layerIndex === 0 && !rootLineStartPositionKeepSameInCurve
        ? top + height / 2
        : top - expandBtnSize
      : node.layerIndex === 0 && !rootLineStartPositionKeepSameInCurve
        ? top + height / 2
        : top + height + expandBtnSize;
    const x2 = item.left + item.width / 2;
    const y2 = up ? item.top + item.height : item.top;
    const stylePath = nodeUseLineStyle
      ? ` L ${item.left},${y2} L ${item.left + item.width},${y2}`
      : '';
    const path =
      node.isRoot && !rootLineKeepSameInCurve
        ? ctx.quadraticCurvePath(x1, y1, x2, y2, true)
        : ctx.cubicBezierPath(x1, y1, x2, y2, true);
    ctx.setLineStyle(style, lines[index] as LineHandle, path + stylePath, item);
  });
}

// ── 水平朝向（左/右）：库内 LogicalStructure 的按朝向参数化 ──────────────────

function renderHorizontalStraight(
  ctx: LayoutRenderCtx,
  node: RenderNode,
  lines: LineHandle[],
  style: unknown,
  direction: BranchDirection,
): void {
  const isLeft = direction === 'left';
  const { left, top, width, height } = node;
  const expandBtnSize = expandBtnSizeOf(ctx, node);
  const marginX = ctx.getMarginX(node.layerIndex + 1);
  const s1 = isLeft ? -(marginX - expandBtnSize) * 0.6 : (marginX - expandBtnSize) * 0.6;
  const nodeUseLineStyle = ctx.mindMap.themeConfig.nodeUseLineStyle;
  node.children.forEach((item, index) => {
    const x1 = isLeft
      ? node.layerIndex === 0
        ? left
        : left - expandBtnSize
      : node.layerIndex === 0
        ? left + width
        : left + width + expandBtnSize;
    let y1 = top + height / 2;
    const x2 = isLeft ? item.left + item.width : item.left;
    let y2 = item.top + item.height / 2;
    const offset = nodeUseLineStyle ? item.width * (isLeft ? -1 : 1) : 0;
    y1 = nodeUseLineStyle && !node.isRoot ? y1 + height / 2 : y1;
    y2 = nodeUseLineStyle ? y2 + item.height / 2 : y2;
    const path = ctx.createFoldLine([
      [x1, y1],
      [x1 + s1, y1],
      [x1 + s1, y2],
      [x2 + offset, y2],
    ]);
    ctx.setLineStyle(style, lines[index] as LineHandle, path, item);
  });
}

function renderHorizontalDirect(
  ctx: LayoutRenderCtx,
  node: RenderNode,
  lines: LineHandle[],
  style: unknown,
  direction: BranchDirection,
): void {
  const isLeft = direction === 'left';
  const { left, top, width, height } = node;
  let expandBtnSize = expandBtnSizeOf(ctx, node);
  const nodeUseLineStyle = ctx.mindMap.themeConfig.nodeUseLineStyle;
  node.children.forEach((item, index) => {
    if (node.layerIndex === 0) expandBtnSize = 0;
    const x1 = isLeft ? left - expandBtnSize : left + width + expandBtnSize;
    let y1 = top + height / 2;
    const x2 = isLeft ? item.left + item.width : item.left;
    let y2 = item.top + item.height / 2;
    y1 = nodeUseLineStyle && !node.isRoot ? y1 + height / 2 : y1;
    y2 = nodeUseLineStyle ? y2 + item.height / 2 : y2;
    const stylePath = nodeUseLineStyle
      ? ` L ${isLeft ? item.left : item.left + item.width},${y2}`
      : '';
    ctx.setLineStyle(
      style,
      lines[index] as LineHandle,
      `M ${x1},${y1} L ${x2},${y2}${stylePath}`,
      item,
    );
  });
}

function renderHorizontalCurve(
  ctx: LayoutRenderCtx,
  node: RenderNode,
  lines: LineHandle[],
  style: unknown,
  direction: BranchDirection,
): void {
  const isLeft = direction === 'left';
  const { left, top, width, height } = node;
  let expandBtnSize = expandBtnSizeOf(ctx, node);
  const { nodeUseLineStyle, rootLineStartPositionKeepSameInCurve, rootLineKeepSameInCurve } = ctx
    .mindMap.themeConfig as {
    nodeUseLineStyle?: boolean;
    rootLineStartPositionKeepSameInCurve?: boolean;
    rootLineKeepSameInCurve?: boolean;
  };
  node.children.forEach((item, index) => {
    if (node.layerIndex === 0) expandBtnSize = 0;
    const x1 = isLeft
      ? node.layerIndex === 0 && !rootLineStartPositionKeepSameInCurve
        ? left + width / 2
        : left - expandBtnSize
      : node.layerIndex === 0 && !rootLineStartPositionKeepSameInCurve
        ? left + width / 2
        : left + width + expandBtnSize;
    let y1 = top + height / 2;
    const x2 = isLeft ? item.left + item.width : item.left;
    let y2 = item.top + item.height / 2;
    y1 = nodeUseLineStyle && !node.isRoot ? y1 + height / 2 : y1;
    y2 = nodeUseLineStyle ? y2 + item.height / 2 : y2;
    const stylePath = nodeUseLineStyle
      ? ` L ${isLeft ? item.left : item.left + item.width},${y2}`
      : '';
    const path =
      node.isRoot && !rootLineKeepSameInCurve
        ? ctx.quadraticCurvePath(x1, y1, x2, y2)
        : ctx.cubicBezierPath(x1, y1, x2, y2);
    ctx.setLineStyle(style, lines[index] as LineHandle, path + stylePath, item);
  });
}

/** 展开/收起按钮：贴在节点靠子节点一侧的边中点。 */
export function renderDirectionalExpandBtn(
  ctx: LayoutRenderCtx,
  node: RenderNode,
  btn: {
    transform(): { translateX: number; translateY: number };
    translate(x: number, y: number): void;
  },
  direction: BranchDirection,
): void {
  const { width, height } = node;
  let expandBtnSize = node.expandBtnSize;
  if (node.layerIndex === 0) expandBtnSize = 0;
  const nodeUseLineStyleOffset = ctx.mindMap.themeConfig.nodeUseLineStyle ? height / 2 : 0;
  const { translateX, translateY } = btn.transform();
  let targetX: number;
  let targetY: number;
  if (isVerticalDirection(direction)) {
    targetX = width / 2 - expandBtnSize / 2;
    targetY = direction === 'up' ? -expandBtnSize / 2 : height + expandBtnSize / 2;
  } else {
    targetX = direction === 'left' ? -expandBtnSize : width;
    targetY = height / 2 + nodeUseLineStyleOffset;
  }
  if (targetX === translateX && targetY === translateY) return;
  btn.translate(targetX - translateX, targetY - translateY);
}

/** 展开/收起按钮的隐藏占位矩形（布局切换后需要重算命中区域）。 */
export function renderDirectionalExpandBtnRect(
  rect: { size(w: number, h: number): { x(v: number): { y(v: number): unknown } } },
  expandBtnSize: number,
  width: number,
  height: number,
  direction: BranchDirection,
): void {
  if (isVerticalDirection(direction)) {
    if (direction === 'up') rect.size(width, expandBtnSize).x(0).y(-expandBtnSize);
    else rect.size(width, expandBtnSize).x(0).y(height);
    return;
  }
  if (direction === 'left') rect.size(expandBtnSize, height).x(-expandBtnSize).y(0);
  else rect.size(expandBtnSize, height).x(width).y(0);
}

/**
 * 概要节点：贴在节点靠子节点一侧。垂直朝向用 v 向边界（下沿/上沿），水平朝向用 h 向边界
 * （与库内 OrganizationStructure / LogicalStructure 的取边规则一致）。
 */
export function renderDirectionalGeneralization(
  ctx: LayoutRenderCtx & {
    getNodeGeneralizationRenderBoundaries(
      item: unknown,
      dir: 'h' | 'v',
    ): {
      left: number;
      right: number;
      top: number;
      bottom: number;
      generalizationLineMargin: number;
      generalizationNodeMargin: number;
    };
  },
  list: Array<{
    node: RenderNode;
    generalizationLine: LineHandle;
    generalizationNode: RenderNode;
    range?: number[];
  }>,
  direction: BranchDirection,
): void {
  const margin = ctx.getMarginX(1);
  list.forEach((item) => {
    if (isVerticalDirection(direction)) {
      const b = ctx.getNodeGeneralizationRenderBoundaries(item, 'v');
      const up = direction === 'up';
      const edge = up ? b.top : b.bottom;
      const sign = up ? -1 : 1;
      const y1 = edge + sign * b.generalizationLineMargin;
      const y2 = y1;
      const x1 = b.left;
      const x2 = b.right;
      const cx = x1 + (x2 - x1) / 2;
      const cy = y1 + sign * margin;
      item.generalizationLine.plot(ctx.transformPath(`M ${x1},${y1} Q ${cx},${cy} ${x2},${y2}`));
      item.generalizationNode.top =
        edge + sign * (b.generalizationLineMargin + b.generalizationNodeMargin + margin);
      item.generalizationNode.left =
        b.left + (b.right - b.left - item.generalizationNode.width) / 2;
      return;
    }
    const isLeft = direction === 'left';
    const b = ctx.getNodeGeneralizationRenderBoundaries(item, 'h');
    const edge = isLeft ? b.left : b.right;
    const sign = isLeft ? -1 : 1;
    const x = edge + sign * b.generalizationLineMargin;
    const y1 = b.top;
    const y2 = b.bottom;
    const cx = x + sign * margin;
    const cy = y1 + (y2 - y1) / 2;
    item.generalizationLine.plot(ctx.transformPath(`M ${x},${y1} Q ${cx},${cy} ${x},${y2}`));
    item.generalizationNode.left =
      x + sign * (b.generalizationLineMargin + b.generalizationNodeMargin);
    item.generalizationNode.top = y1 + (y2 - y1 - item.generalizationNode.height) / 2;
  });
}

/** 根节点 → 一级子节点的「臂」连线（X 结构专用：直线连到子节点靠根一侧的边）。 */
export function renderArmLines(
  ctx: LayoutRenderCtx,
  root: RenderNode,
  lines: LineHandle[],
  style: unknown,
): void {
  const cx = root.left + root.width / 2;
  const cy = root.top + root.height / 2;
  root.children.forEach((item, index) => {
    const tx = item.left + item.width / 2;
    const ty = item.top + item.height / 2;
    // 从根中心指向子节点中心，末端收到子节点边界上（按主轴方向截断）
    const dx = tx - cx;
    const dy = ty - cy;
    const halfW = item.width / 2 + 2;
    const halfH = item.height / 2 + 2;
    const scale = Math.min(
      Math.abs(dx) > 1e-6 ? halfW / Math.abs(dx) : Number.POSITIVE_INFINITY,
      Math.abs(dy) > 1e-6 ? halfH / Math.abs(dy) : Number.POSITIVE_INFINITY,
    );
    const endX = tx - dx * Math.min(scale, 1);
    const endY = ty - dy * Math.min(scale, 1);
    ctx.setLineStyle(style, lines[index] as LineHandle, `M ${cx},${cy} L ${endX},${endY}`, item);
  });
}

/**
 * 根节点落位：库内 setNodeCenter 把根节点放在画布中心（受 initRootNodePosition 影响）。
 * 自研布局排布后根节点中心在原点（0,0），因此先量出 setNodeCenter 想要的位移，
 * 再把整棵树（根以外）一起平移过去，最后写回根节点自身。
 */
export function centerRootAtCanvas(
  ctx: LayoutRenderCtx & { setNodeCenter(node: RenderNode): void },
  root: RenderNode,
): void {
  const beforeLeft = root.left;
  const beforeTop = root.top;
  ctx.setNodeCenter(root);
  const dx = root.left - beforeLeft;
  const dy = root.top - beforeTop;
  root.left = beforeLeft;
  root.top = beforeTop;
  for (const child of root.children ?? []) moveSubtree(child, dx, dy);
  root.left += dx;
  root.top += dy;
}

/** 递归给子树内每个节点打朝向标记（连线/展开按钮渲染按朝向分派）。 */
export function tagSubtreeDirection(node: RenderNode, direction: BranchDirection): void {
  node.nexDirection = direction;
  for (const child of node.children ?? []) tagSubtreeDirection(child, direction);
}
