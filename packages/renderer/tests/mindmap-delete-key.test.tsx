// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import MindMap from 'simple-mind-map';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MindmapEditor } from '../src/binary-host/mindmap-editor';

/**
 * DEV-107：xmind 删除键双重分发回归测试。
 *
 * 根因：应用层 keydown（DEV-099 引入）与 simple-mind-map 库内 KeyCommand
 * 在同一个 window 上注册了同样的快捷键（'Del|Backspace' → REMOVE_NODE、
 * 'Control+z' → BACK、'Control+y' → FORWARD），一次按键命令执行两遍。
 * 单选删除末尾节点后库自动激活相邻兄弟（deleteNodeActive 默认开），第二遍
 * REMOVE_NODE 把相邻兄弟连带删掉。
 *
 * 修复约定：删除/撤销/重做键全权交给库；应用层只保留库没有的键（Ctrl+S）
 * 与库缺失的 macOS 惯用键（Cmd/Ctrl+Shift+Z 重做，库只有 Control+y）。
 *
 * 测试走真实库管线（DEV-102 约定：不 mock simple-mind-map）：
 * 组件真实挂载 → 从宿主容器取实例 → 注入激活态 → 在 body 上派发 keydown
 * （冒泡到 window，与真实"点选节点后焦点在 body"一致）→ 断言树形态。
 */

const MODEL = {
  data: { text: 'root' },
  children: [
    { data: { text: 'c1' } },
    { data: { text: 'c2' } },
    { data: { text: 'c3' } },
  ],
};

interface NodeLike {
  data?: { text?: string };
  children?: NodeLike[];
}

/** 库的 text 字段是富文本（`<p>…</p>`），比较前剥掉 HTML 标签。 */
function plainText(value: unknown): string {
  return String(value ?? '').replace(/<[^>]+>/g, '');
}

/** happy-dom 20.14 对 svg.js 新建 SVG group 的祖先校验缺陷兜底（同 DEV-102）。 */
const happyDomAppendChild = Node.prototype.appendChild;
let happyDomInternalAppendChild: symbol | null = null;

/** happy-dom 里元素无真实尺寸，库拒绝宽高为 0 的容器——全量打桩。 */
const realGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

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
  HTMLElement.prototype.getBoundingClientRect = function stubbedRect() {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      toJSON: () => ({}),
    } as DOMRect;
  };
});

afterEach(() => {
  Node.prototype.appendChild = happyDomAppendChild;
  HTMLElement.prototype.getBoundingClientRect = realGetBoundingClientRect;
});

async function mountEditor(onChange: (m: unknown) => void): Promise<{
  mindMap: MindMap;
  unmount: () => Promise<void>;
}> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(MindmapEditor, {
        path: '/vault/test.xmind',
        model: MODEL,
        onChange,
      }),
    );
  });
  const host = container.querySelector(
    '[data-testid="mindmap-editor"] > div',
  ) as (HTMLElement & { __mindMap?: MindMap }) | null;
  const mindMap = host?.__mindMap;
  if (!mindMap) throw new Error('宿主未暴露 __mindMap 观测口');
  return {
    mindMap,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

interface RendererInternals {
  root: { getData: (k: string) => unknown; children: unknown[] } | null;
  activeNodeList: unknown[];
  addNodeToActiveList: (node: unknown, notEmit?: boolean) => void;
}

function rendererOf(mindMap: MindMap): RendererInternals {
  return (mindMap as unknown as { renderer: RendererInternals }).renderer;
}

/** 库排布异步链式收敛：等 renderer.root 出现。 */
async function settle(mindMap: MindMap): Promise<void> {
  const renderer = rendererOf(mindMap);
  for (let tick = 0; tick < 50 && !renderer.root; tick += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (!renderer.root) throw new Error('排布未在预期帧数内完成');
}

/** 找到按文本定位的已渲染节点实例。 */
function findNodeInstance(mindMap: MindMap, text: string): unknown {
  const walk = (node: { getData: (k: string) => unknown; children: unknown[] }): unknown => {
    if (plainText(node.getData('text')) === text) return node;
    for (const child of node.children) {
      const hit = walk(child as typeof node);
      if (hit) return hit;
    }
    return null;
  };
  const root = rendererOf(mindMap).root;
  return root ? walk(root) : null;
}

/**
 * 等待 onChange 收到 children 数量为 target 的树并返回该树。
 *
 * data_change 经 addHistory 的 100ms 尾沿节流发出（addHistoryTime），纯
 * setTimeout(0) 微步不足以跨过节流窗口，按 10ms 步进等待至多 2s。
 */
async function waitForChildren(latest: () => NodeLike, target: number): Promise<NodeLike> {
  for (let tick = 0; tick < 200; tick += 1) {
    const tree = latest();
    if ((tree.children ?? []).length === target) return tree;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `onChange 未在预期时长内收到 ${target} 个子节点：${JSON.stringify(latest())}`,
  );
}

/** 派发一次 keydown：target=body（真实点选节点后焦点位置），冒泡到 window 监听。 */
function pressKey(init: KeyboardEventInit): void {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
}

interface EditorHandles {
  mindMap: MindMap;
  unmount: () => Promise<void>;
}

/**
 * 公共流程：挂载 → 收敛 → 进画布（库快捷键的鼠标门控）→ 注入激活态。
 * 激活态走 renderer.addNodeToActiveList（与节点点击 active() 的同一入口）；
 * SET_NODE_ACTIVE exec 在 happy-dom 下依赖的节点渲染产物不完整，不采用。
 *
 * 挂载后等待 >addHistoryTime（100ms 尾沿节流）：构造期 addHistoryOnInit 的
 * 定时器先于首个用户操作落地，历史栈里才有"初始树"这一条，撤销语义才能
 * 走通——真实用户的首次编辑永远晚于这个窗口，这里显式对齐该时序。
 */
async function setupWithActiveNode(
  text: string,
  onChange: (m: unknown) => void,
): Promise<EditorHandles> {
  const handles = await mountEditor(onChange);
  await settle(handles.mindMap);
  await new Promise<void>((resolve) => setTimeout(resolve, 150));
  await act(async () => {
    (handles.mindMap as unknown as { emit: (e: string) => void }).emit('svg_mouseenter');
  });
  const node = findNodeInstance(handles.mindMap, text);
  expect(node).toBeTruthy();
  await act(async () => {
    rendererOf(handles.mindMap).addNodeToActiveList(node, true);
  });
  expect(rendererOf(handles.mindMap).activeNodeList).toHaveLength(1);
  return handles;
}

describe('DEV-107 · 删除键双重分发', () => {
  it('选中末尾节点按 Delete 一次：只删该节点，相邻兄弟保留', async () => {
    let latest: NodeLike = MODEL;
    const handles = await setupWithActiveNode('c3', (m) => {
      latest = m as NodeLike;
    });
    try {
      await act(async () => {
        pressKey({ key: 'Delete', code: 'Delete', keyCode: 46 });
      });
      const tree = await waitForChildren(() => latest, 2);
      // 修复断言：只有 c3 被删；c1、c2 保留。双重分发下 c2 会被连带删除（只剩 c1）。
      expect((tree.children ?? []).map((c) => plainText(c.data?.text))).toEqual([
        'c1',
        'c2',
      ]);
    } finally {
      await handles.unmount();
    }
  });

  it('选中末尾节点按 Backspace 一次：同样只删该节点', async () => {
    let latest: NodeLike = MODEL;
    const handles = await setupWithActiveNode('c3', (m) => {
      latest = m as NodeLike;
    });
    try {
      await act(async () => {
        pressKey({ key: 'Backspace', code: 'Backspace', keyCode: 8 });
      });
      const tree = await waitForChildren(() => latest, 2);
      expect((tree.children ?? []).map((c) => plainText(c.data?.text))).toEqual([
        'c1',
        'c2',
      ]);
    } finally {
      await handles.unmount();
    }
  });

  it('Ctrl/Cmd+Z 撤销一次：一步到位恢复被删节点', async () => {
    let latest: NodeLike = MODEL;
    const handles = await setupWithActiveNode('c3', (m) => {
      latest = m as NodeLike;
    });
    try {
      await act(async () => {
        pressKey({ key: 'Delete', code: 'Delete', keyCode: 46 });
      });
      await waitForChildren(() => latest, 2);
      await act(async () => {
        pressKey({ key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true });
      });
      const tree = await waitForChildren(() => latest, 3);
      // 双重分发下会一次跳两步或步进异常；修复后一次撤销恢复原树。
      expect((tree.children ?? []).map((c) => plainText(c.data?.text))).toEqual([
        'c1',
        'c2',
        'c3',
      ]);
    } finally {
      await handles.unmount();
    }
  });

  it('Cmd/Ctrl+Shift+Z 重做（应用层保留的库缺失键）：删除后重做一步恢复删除', async () => {
    let latest: NodeLike = MODEL;
    const handles = await setupWithActiveNode('c3', (m) => {
      latest = m as NodeLike;
    });
    try {
      await act(async () => {
        pressKey({ key: 'Delete', code: 'Delete', keyCode: 46 });
      });
      await waitForChildren(() => latest, 2);
      await act(async () => {
        pressKey({ key: 'z', code: 'KeyZ', keyCode: 90, metaKey: true });
      });
      await waitForChildren(() => latest, 3);
      await act(async () => {
        pressKey({ key: 'z', code: 'KeyZ', keyCode: 90, metaKey: true, shiftKey: true });
      });
      const tree = await waitForChildren(() => latest, 2);
      // 库的 FORWARD 只注册在 Control+y；Cmd/Ctrl+Shift+Z 由应用层补，且只执行一步。
      expect((tree.children ?? []).map((c) => plainText(c.data?.text))).toEqual([
        'c1',
        'c2',
      ]);
    } finally {
      await handles.unmount();
    }
  });

  it('画布外（非编辑类目标）按键不触发删除', async () => {
    let latest: NodeLike = MODEL;
    const handles = await setupWithActiveNode('c3', (m) => {
      latest = m as NodeLike;
    });
    try {
      // 模拟鼠标已离开画布：库的 enableShortcutOnlyWhenMouseInSvg 门控生效，
      // 快捷键不响应；应用层也已不含删除分发——树保持不变。
      await act(async () => {
        (handles.mindMap as unknown as { emit: (e: string) => void }).emit('svg_mouseleave');
      });
      await act(async () => {
        pressKey({ key: 'Delete', code: 'Delete', keyCode: 46 });
      });
      for (let tick = 0; tick < 10; tick += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      expect((latest.children ?? []).map((c) => plainText(c.data?.text))).toEqual([
        'c1',
        'c2',
        'c3',
      ]);
    } finally {
      await handles.unmount();
    }
  });
});
