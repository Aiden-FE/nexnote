// @vitest-environment happy-dom
import { afterEach, beforeEach } from 'vitest';
import { describe, expect, it } from 'vitest';
import MindMap from 'simple-mind-map';
import {
  applyMindmapLayout,
  UP_STRUCTURE_LAYOUT,
  X_STRUCTURE_LAYOUT,
} from '../src/binary-host/mindmap-layouts';
import { MINDMAP_STRUCTURE_OPTIONS } from '../src/binary-host/mindmap-structures';

/**
 * DEV-102：走真实库管线的集成测试。
 *
 * 前面的纯几何单测直接调用布局类；这里改用 `new MindMap(...)` + `setLayout`，
 * 验证自研布局确实能被库接受（绕过 layoutValueList 白名单）、被 Render 实例化、
 * 并真的把一级子节点排到预期象限——即 ADR-0020 决策 2 的注册机制与决策 4 的
 * 象限语义在完整管线里成立。
 */

const MODEL = {
  data: { text: 'root' },
  children: [
    { data: { text: 'a' } },
    { data: { text: 'b' } },
    { data: { text: 'c' } },
    { data: { text: 'd' } },
  ],
};

const CANVAS = { width: 1000, height: 800 };

/**
 * DEV-102：happy-dom 20.14 对 simple-mind-map / svg.js 首次挂载全新 SVG group
 * 的祖先校验存在兼容缺陷——`NodeUtility.isInclusiveAncestor` 在此场景会抛
 * TypeError。跳过该校验后真实 append 全部成功（4/4 group 挂载、isRendering
 * 回落），证明不是节点树错误，而是环境校验误报。
 *
 * 这里只兜底该 TypeError：先用公开 appendChild，失败后调 happy-dom 内部
 * `Symbol(appendChild)(node, disableValidations=true)` 重试真实插入。
 * 不捕获其他异常，避免掩盖真实 DOM 破坏。
 */
const happyDomAppendChild = Node.prototype.appendChild;
let happyDomInternalAppendChild: symbol | null = null;

beforeEach(() => {
  happyDomInternalAppendChild = null;
  for (const symbol of Object.getOwnPropertySymbols(Node.prototype)) {
    if (symbol.description === 'appendChild') happyDomInternalAppendChild = symbol;
  }
  if (!happyDomInternalAppendChild) {
    throw new Error('happy-dom Node.prototype 缺少内部 appendChild symbol，需复核兼容补丁');
  }
  Node.prototype.appendChild = function patchedAppendChild(this: Node, node: Node): Node {
    try {
      return happyDomAppendChild.call(this, node);
    } catch (error) {
      if ((error as Error).name !== 'TypeError') throw error;
      const realNode = (node as { node?: Node }).node ?? node;
      const internal = (
        this as unknown as Record<symbol, (child: Node, disableValidations: boolean) => Node>
      )[happyDomInternalAppendChild];
      if (typeof internal !== 'function') throw error;
      return internal.call(this, realNode, true);
    }
  };
});

afterEach(() => {
  Node.prototype.appendChild = happyDomAppendChild;
});

interface PositionedNode {
  left: number;
  top: number;
  width: number;
  height: number;
  children: PositionedNode[];
}

/** happy-dom 里元素没有真实尺寸，库会拒绝宽高为 0 的容器，因此打桩测量结果。 */
function mountHost(): HTMLDivElement {
  const el = document.createElement('div');
  document.body.append(el);
  el.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: CANVAS.width,
      height: CANVAS.height,
      right: CANVAS.width,
      bottom: CANVAS.height,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

/**
 * 库的排布是异步的（asyncRun 链式 setTimeout，实测约 5 跳），因此按「renderer.root
 * 已产生」来收敛，而不是赌固定帧数或真实时间——单测不引入时间抖动。
 */
const MAX_TICKS = 50;

async function settleRoot(mindMap: MindMap): Promise<PositionedNode> {
  const renderer = (mindMap as unknown as { renderer: { root: PositionedNode | null } }).renderer;
  for (let tick = 0; tick < MAX_TICKS && !renderer.root; tick += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const root = renderer.root;
  if (!root) throw new Error('排布未在预期帧数内完成');
  return root;
}

async function build(layout: string): Promise<{ mindMap: MindMap; root: PositionedNode }> {
  const mindMap = new MindMap({
    el: mountHost(),
    data: MODEL,
    layout: 'logicalStructure',
    readonly: true,
  } as unknown as ConstructorParameters<typeof MindMap>[0]);
  applyMindmapLayout(mindMap, layout);
  return { mindMap, root: await settleRoot(mindMap) };
}

const center = (node: PositionedNode): { x: number; y: number } => ({
  x: node.left + node.width / 2,
  y: node.top + node.height / 2,
});

describe('自研布局走真实库管线（DEV-102）', () => {
  it('六种结构经真实管线应用后仍停留在所选布局（不被白名单降级）', async () => {
    expect((await build(X_STRUCTURE_LAYOUT)).mindMap.getLayout()).toBe(X_STRUCTURE_LAYOUT);
    expect((await build(UP_STRUCTURE_LAYOUT)).mindMap.getLayout()).toBe(UP_STRUCTURE_LAYOUT);
    for (const option of MINDMAP_STRUCTURE_OPTIONS) {
      expect((await build(option.layout)).mindMap.getLayout()).toBe(option.layout);
    }
  });

  it('X 结构：一级子节点落在四个不同象限', async () => {
    const { root } = await build(X_STRUCTURE_LAYOUT);
    expect(root.children).toHaveLength(4);
    const rc = center(root);
    const quadrant = (child: PositionedNode): string => {
      const c = center(child);
      return `${c.x < rc.x ? 'left' : 'right'}-${c.y < rc.y ? 'top' : 'bottom'}`;
    };
    expect(new Set(root.children.map(quadrant)).size).toBe(4);
  });

  it('向上分支：一级子节点整体位于根节点上方', async () => {
    const { root } = await build(UP_STRUCTURE_LAYOUT);
    const rc = center(root);
    for (const child of root.children) {
      expect(center(child).y).toBeLessThanOrEqual(rc.y);
    }
  });
});
