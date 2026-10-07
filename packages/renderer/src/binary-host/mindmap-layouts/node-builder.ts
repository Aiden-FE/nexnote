import { walk } from 'simple-mind-map/src/utils/index.js';

/** 自研布局构建节点时用到的 Base 子集（structural typing，避免耦合库内部类型）。 */
export interface NodeBuilderHost {
  renderer: { renderTree: SmmInternal.DataNode };
  createNode(
    cur: SmmInternal.DataNode,
    parent: SmmInternal.DataNode | null,
    isRoot: boolean,
    layerIndex: number,
    index: number,
    ancestors: SmmInternal.DataNode[],
  ): SmmInternal.LayoutNode;
}

/**
 * 自研布局共用的节点构建：遍历渲染树创建节点实例，并给折叠节点打上
 * `expanded = false`（折叠子树不参与排布），返回 true 停止向下遍历——与库内
 * 各布局 walk 的约定一致。
 */
export function buildLayoutNodes(host: NodeBuilderHost): void {
  walk(
    host.renderer.renderTree,
    null,
    (cur, parent, isRoot, layerIndex, index, ancestors) => {
      const node = host.createNode(cur, parent, isRoot, layerIndex, index, ancestors);
      node.expanded = cur.data.expand !== false;
      return cur.data.expand === false;
    },
    null,
    true,
    0,
  );
}
