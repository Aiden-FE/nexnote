// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { UpStructure } from '../src/binary-host/mindmap-layouts/up-structure';
import { XStructure } from '../src/binary-host/mindmap-layouts/x-structure';
import type { RenderNode } from '../src/binary-host/mindmap-layouts/renderers';

/**
 * DEV-102：自研布局的几何验收。
 *
 * 直接构造布局实例并注入一棵已建好的节点树（绕开库内 Base.createNode 的渲染管线），
 * 只跑排布阶段，断言节点相对根节点的象限/朝向。这比"打开应用看一眼"更精确，
 * 且能锁住 ADR-0020 决策 4 的 X 结构语义：左上 / 右上 / 左下 / 右下四象限。
 */

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 800;
const MARGIN = 10;

let uidSeq = 0;

function node(width: number, height: number, children: RenderNode[] = []): RenderNode {
  uidSeq += 1;
  return {
    uid: `u${uidSeq}`,
    width,
    height,
    left: Number.NaN,
    top: Number.NaN,
    layerIndex: 0,
    expandBtnSize: 10,
    children,
    style: { line: () => undefined },
  };
}

function fakeRenderer() {
  return {
    mindMap: {
      opt: { initRootNodePosition: ['center', 'center'] },
      themeConfig: {},
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      draw: {},
      lineDraw: { path: () => ({ plot: () => undefined }) },
    },
  };
}

type Layout = { getMarginX: (layerIndex: number) => number };

function makeLayout<T extends Layout>(
  LayoutClass: new (renderer: unknown, layout?: string) => T & { root: RenderNode },
  root: RenderNode,
): T & { root: RenderNode } {
  const layout = new LayoutClass(fakeRenderer() as unknown as never) as T & { root: RenderNode };
  layout.root = root;
  layout.getMarginX = () => MARGIN;
  return layout;
}

/** 只跑排布：两个布局的 positionTree 都是 private，用一次窄 cast 调用。 */
function position(layout: { positionTree?: () => void }): void {
  (layout as unknown as { positionTree(): void }).positionTree();
}

const centerOf = (target: RenderNode): { x: number; y: number } => ({
  x: target.left + target.width / 2,
  y: target.top + target.height / 2,
});

describe('向上分支结构几何（DEV-102）', () => {
  it('子节点整体位于根节点上方，且兄弟横向并排不重叠', () => {
    const a = node(60, 30);
    const b = node(60, 30);
    const root = node(100, 40, [a, b]);
    const layout = makeLayout(UpStructure, root);
    position(layout);

    const rootCenter = centerOf(root);
    expect(centerOf(a).y).toBeLessThan(rootCenter.y);
    expect(centerOf(b).y).toBeLessThan(rootCenter.y);
    // 兄弟水平分离
    expect(centerOf(b).x - centerOf(a).x).toBeGreaterThanOrEqual(60 + MARGIN - 1);
    // 根节点按库内规则落在画布中心
    expect(root.left).toBe(CANVAS_WIDTH / 2);
    expect(root.top).toBe(CANVAS_HEIGHT / 2);
  });

  it('多层子树逐级向上，无重叠', () => {
    const grand = node(20, 20);
    const child = node(60, 30, [grand]);
    const root = node(100, 40, [child]);
    const layout = makeLayout(UpStructure, root);
    position(layout);

    expect(centerOf(grand).y).toBeLessThan(centerOf(child).y);
    expect(centerOf(child).y).toBeLessThan(centerOf(root).y);
  });

  it('根节点按 initRootNodePosition 落位时其余节点同步平移', () => {
    const child = node(60, 30);
    const root = node(100, 40, [child]);
    const layout = makeLayout(UpStructure, root);
    position(layout);
    const delta = child.left - (centerOf(root).x - 30);
    expect(delta).toBeCloseTo(0, 6);
  });
});

describe('X 结构几何（DEV-102 决策 4）', () => {
  it('四个子节点分置左上 / 右上 / 左下 / 右下四个象限', () => {
    const children = [node(60, 30), node(60, 30), node(60, 30), node(60, 30)];
    const root = node(100, 40, children);
    const layout = makeLayout(XStructure, root);
    position(layout);

    const [tl, tr, bl, br] = children as [RenderNode, RenderNode, RenderNode, RenderNode];
    const rc = centerOf(root);
    expect(centerOf(tl).x).toBeLessThan(rc.x);
    expect(centerOf(tl).y).toBeLessThan(rc.y);
    expect(centerOf(tr).x).toBeGreaterThan(rc.x);
    expect(centerOf(tr).y).toBeLessThan(rc.y);
    expect(centerOf(bl).x).toBeLessThan(rc.x);
    expect(centerOf(bl).y).toBeGreaterThan(rc.y);
    expect(centerOf(br).x).toBeGreaterThan(rc.x);
    expect(centerOf(br).y).toBeGreaterThan(rc.y);
  });

  it('同一象限内多个子节点不重叠', () => {
    const children = Array.from({ length: 8 }, () => node(60, 30));
    const root = node(100, 40, children);
    const layout = makeLayout(XStructure, root);
    position(layout);

    const rc = centerOf(root);
    const topLeft = children.filter((c) => centerOf(c).x < rc.x && centerOf(c).y < rc.y);
    expect(topLeft.length).toBeGreaterThan(1);
    for (let i = 1; i < topLeft.length; i += 1) {
      const prev = centerOf(topLeft[i - 1] as RenderNode);
      const cur = centerOf(topLeft[i] as RenderNode);
      const overlapX = Math.abs(cur.x - prev.x) < 60 - 1;
      const overlapY = Math.abs(cur.y - prev.y) < 30 - 1;
      expect(overlapX && overlapY).toBe(false);
    }
  });

  it('恰好 2 个子节点时退化为左右形式（偶数下标向右、奇数下标向左）', () => {
    const first = node(60, 30);
    const second = node(60, 30);
    const root = node(100, 40, [first, second]);
    const layout = makeLayout(XStructure, root);
    position(layout);

    const rc = centerOf(root);
    expect(centerOf(first).x).toBeGreaterThan(rc.x);
    expect(centerOf(second).x).toBeLessThan(rc.x);
    // 纵向以根节点为轴居中
    expect(centerOf(first).y).toBeCloseTo(rc.y, 6);
    expect(centerOf(second).y).toBeCloseTo(rc.y, 6);
  });

  it('象限顺序按子节点身份固定：第 1 个左上、第 2 个右上、第 3 个左下、第 4 个右下', () => {
    const first = node(60, 30);
    const second = node(60, 30);
    const third = node(60, 30);
    const fourth = node(60, 30);
    const root = node(100, 40, [first, second, third, fourth]);
    position(makeLayout(XStructure, root));

    const rc = centerOf(root);
    const quadrantOf = (target: RenderNode): string => {
      const c = centerOf(target);
      return `${c.x < rc.x ? 'left' : 'right'}-${c.y < rc.y ? 'top' : 'bottom'}`;
    };
    // 顺序语义必须锁死：仅验象限符号无法发现顺序倒置
    expect(quadrantOf(first)).toBe('left-top');
    expect(quadrantOf(second)).toBe('right-top');
    expect(quadrantOf(third)).toBe('left-bottom');
    expect(quadrantOf(fourth)).toBe('right-bottom');
  });

  it('子节点降到 1 个时保留该子节点上一次被分配的方向（决策 5）', () => {
    const kept = node(60, 30);
    const dropped = node(60, 30);
    const third = node(60, 30);
    const fourth = node(60, 30);
    const root = node(100, 40, [kept, dropped, third, fourth]);
    position(makeLayout(XStructure, root));
    // 第 4 个子节点原本分在右下（向下生长）
    expect(centerOf(fourth).y).toBeGreaterThan(centerOf(root).y);

    // 删到只剩它：应仍沿原方向（下方）生长，而不是被重排成右侧单臂
    root.children = [fourth];
    position(makeLayout(XStructure, root));
    expect(centerOf(fourth).y).toBeGreaterThan(centerOf(root).y);
  });

  it('每个象限的子树沿该象限方向生长（左上象限向上、右下象限向下）', () => {
    const tlChild = node(60, 30);
    const brChild = node(60, 30);
    const tlGrand = node(20, 20);
    const brGrand = node(20, 20);
    tlChild.children = [tlGrand];
    brChild.children = [brGrand];
    const root = node(100, 40, [tlChild, node(60, 30), node(60, 30), brChild]);
    const layout = makeLayout(XStructure, root);
    position(layout);

    expect(centerOf(tlGrand).y).toBeLessThan(centerOf(tlChild).y);
    expect(centerOf(brGrand).y).toBeGreaterThan(centerOf(brChild).y);
  });
});
