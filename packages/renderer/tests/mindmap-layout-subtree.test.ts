import { describe, expect, it } from 'vitest';
import { layoutSubtree } from '../src/binary-host/mindmap-layouts/subtree';
import type { LayoutNode } from '../src/binary-host/mindmap-layouts/subtree';

/**
 * DEV-102：子树排布纯几何内核的单测。
 * 期望值全部手工推算（不依赖实现自身计算），坐标系为「父节点中心 = 原点、y 向下」。
 */

const leaf = (width: number, height: number): LayoutNode => ({ width, height, children: [] });

/** 父 100x40 + 两个 60x30 叶子。 */
function twoLeafTree(): { root: LayoutNode; a: LayoutNode; b: LayoutNode } {
  const a = leaf(60, 30);
  const b = leaf(60, 30);
  const root: LayoutNode = { width: 100, height: 40, children: [a, b] };
  return { root, a, b };
}

describe('layoutSubtree 叶子（DEV-102）', () => {
  it('单节点以自身中心为原点，包围盒 = 自身尺寸', () => {
    const node = leaf(100, 40);
    const box = layoutSubtree(node, 'down', 10);
    expect(node.left).toBe(-50);
    expect(node.top).toBe(-20);
    expect(box).toEqual({ width: 100, height: 40, offsetX: -50, offsetY: -20 });
  });
});

describe('layoutSubtree 向下（父在上、子在下）（DEV-102）', () => {
  it('兄弟横排、整体以父节点居中，子树带与父节点间距 = gap', () => {
    const { root, a, b } = twoLeafTree();
    const box = layoutSubtree(root, 'down', 10);
    // 父节点自身居中于原点
    expect([root.left, root.top]).toEqual([-50, -20]);
    // 子节点：横向 -65..-5 与 5..65（两端各 10 留白），纵向 20(父底) + 10(gap) = 30 起
    expect([a.left, a.top]).toEqual([-65, 30]);
    expect([b.left, b.top]).toEqual([5, 30]);
    // 包围盒：横向 150（兄弟 60+60 + 3 个 gap），纵向 -20..60 = 80
    expect(box).toEqual({ width: 150, height: 80, offsetX: -75, offsetY: -20 });
  });
});

describe('layoutSubtree 向上（父在下、子在上）（DEV-102）', () => {
  it('纵向镜像：子节点在父节点上方，gap 同样为 10', () => {
    const { root, a, b } = twoLeafTree();
    const box = layoutSubtree(root, 'up', 10);
    expect([root.left, root.top]).toEqual([-50, -20]);
    // 子节点纵向 -60..-30，父顶 -20，间距 10
    expect([a.left, a.top]).toEqual([-65, -60]);
    expect([b.left, b.top]).toEqual([5, -60]);
    expect(box).toEqual({ width: 150, height: 80, offsetX: -75, offsetY: -60 });
  });
});

describe('layoutSubtree 向右（父在左、子在右）（DEV-102）', () => {
  it('兄弟竖排，子树带沿 x 轴向右生长', () => {
    const { root, a, b } = twoLeafTree();
    const box = layoutSubtree(root, 'right', 10);
    expect([root.left, root.top]).toEqual([-50, -20]);
    // 子节点 x = 50(父右) + 10(gap) = 60 起；兄弟带高 90（30+30+3×10），以父中心为轴居中
    expect([a.left, a.top]).toEqual([60, -35]);
    expect([b.left, b.top]).toEqual([60, 5]);
    // 包围盒：x 从父左沿 -50 到 120（宽 170）；y 以父中心为轴（高 90，-45..45）
    expect(box).toEqual({ width: 170, height: 90, offsetX: -50, offsetY: -45 });
  });
});

describe('layoutSubtree 多层递归（DEV-102）', () => {
  it('深层子树整体随父节点平移，内部相对位置保持', () => {
    const grand = leaf(20, 20);
    const child = { width: 60, height: 30, children: [grand] };
    const root: LayoutNode = { width: 100, height: 40, children: [child] };

    const box = layoutSubtree(root, 'down', 10);

    // 子节点：单个子节点时跨轴居中于父节点 → left = -30
    expect([child.left, child.top]).toEqual([-30, 30]);
    // 孙节点：子节点底 30+30=60 起 + gap 10 → 70；跨轴居中于子节点
    expect([grand.left, grand.top]).toEqual([-10, 70]);
    expect(box).toEqual({ width: 100, height: 110, offsetX: -50, offsetY: -20 });
  });

  it('折叠子树（expand=false）只占节点自身尺寸', () => {
    const grand = leaf(20, 20);
    const child = { width: 60, height: 30, children: [grand] };
    const root: LayoutNode = { width: 100, height: 40, children: [child] };

    child.expanded = false;
    const box = layoutSubtree(root, 'down', 10);

    // 折叠节点自身照常落位（跨轴居中于父节点、沿轴在 gap 之后），但其后代不排布
    expect([child.left, child.top]).toEqual([-30, 30]);
    expect([grand.left, grand.top]).toEqual([undefined, undefined]);
    expect(box).toEqual({ width: 100, height: 80, offsetX: -50, offsetY: -20 });
  });
});
