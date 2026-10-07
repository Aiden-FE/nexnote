/**
 * DEV-102：simple-mind-map 内部子路径导入的窄声明。
 * 包无 exports 映射、src 无类型声明，但布局类必须继承库内 Base 才能被 Render 实例化
 * （`new L(this, layout)`），因此按实际用到的成员声明最小契约。
 */
declare namespace SmmInternal {
  /** 渲染树节点（库内 walk 遍历的数据节点）。 */
  interface DataNode {
    data: { expand?: boolean };
    children?: DataNode[];
  }
  /** 布局用的节点实例。 */
  interface LayoutNode {
    uid: string;
    left: number;
    top: number;
    width: number;
    height: number;
    layerIndex: number;
    isRoot?: boolean;
    expandBtnSize: number;
    children: LayoutNode[];
    style: { line(line: unknown): void };
    _lines?: unknown[];
    /** 节点是否展开（折叠时其子树不参与排布）。 */
    expanded?: boolean;
    /** DEV-102：自研布局给节点打的朝向标记，供连线/展开按钮渲染分派。 */
    nexDirection?: 'up' | 'down' | 'left' | 'right';
    getData(key?: string): unknown;
    hasCustomPosition?(): boolean;
  }
  interface GeneralizationBoundaries {
    left: number;
    right: number;
    top: number;
    bottom: number;
    generalizationLineMargin: number;
    generalizationNodeMargin: number;
  }
  interface MindMapLike {
    opt: Record<string, unknown>;
    themeConfig: Record<string, unknown>;
    width: number;
    height: number;
  }
}

declare module 'simple-mind-map/src/layouts/Base.js' {
  export default class Base {
    constructor(renderer: unknown, layout?: string);
    renderer: { renderTree: SmmInternal.DataNode; mindMap: SmmInternal.MindMapLike };
    mindMap: SmmInternal.MindMapLike;
    root: SmmInternal.LayoutNode;
    lineDraw: { path(): { plot(path: string): void } };
    layout?: string;
    doLayout(callback: (root: SmmInternal.LayoutNode) => void): void;
    renderLine(node: unknown, lines: unknown[], style: unknown, lineStyle: unknown): void;
    renderExpandBtn(node: unknown, btn: unknown): void;
    renderGeneralization(list: unknown[]): void;
    renderExpandBtnRect(rect: unknown, size: number, w: number, h: number, node: unknown): void;
    createNode(
      cur: SmmInternal.DataNode,
      parent: SmmInternal.DataNode | null,
      isRoot: boolean,
      layerIndex: number,
      index: number,
      ancestors: SmmInternal.DataNode[],
    ): SmmInternal.LayoutNode;
    setNodeCenter(node: SmmInternal.LayoutNode, position?: unknown): void;
    getMarginX(layerIndex: number): number;
    getMarginY(layerIndex: number): number;
    createFoldLine(list: Array<[number, number]>): string;
    quadraticCurvePath(x1: number, y1: number, x2: number, y2: number, v?: boolean): string;
    cubicBezierPath(x1: number, y1: number, x2: number, y2: number, v?: boolean): string;
    setLineStyle(style: unknown, line: unknown, path: string, child: unknown): void;
    transformPath(path: string): string;
    getNodeGeneralizationRenderBoundaries(
      item: unknown,
      dir: 'h' | 'v',
    ): SmmInternal.GeneralizationBoundaries;
  }
}

declare module 'simple-mind-map/src/utils/index.js' {
  export function walk(
    root: SmmInternal.DataNode,
    parent: SmmInternal.DataNode | null,
    before?: (
      cur: SmmInternal.DataNode,
      parent: SmmInternal.DataNode | null,
      isRoot: boolean,
      layerIndex: number,
      index: number,
      ancestors: SmmInternal.DataNode[],
    ) => boolean | undefined | void,
    after?:
      | ((
          cur: SmmInternal.DataNode,
          parent: SmmInternal.DataNode | null,
          isRoot: boolean,
          layerIndex: number,
        ) => void)
      | null,
    isRoot?: boolean,
    layerIndex?: number,
    index?: number,
    ancestors?: SmmInternal.DataNode[],
  ): void;
  export function asyncRun(tasks: Array<() => void>, callback?: () => void): void;
  export function getNodeIndexInNodeList(
    node: { uid?: string },
    nodeList: Array<{ uid?: string }>,
  ): number;
}

declare module 'simple-mind-map/src/constants/constant.js' {
  export const CONSTANTS: Record<string, unknown>;
  /** 库内布局白名单（模块级数组，自研布局名需注入此处才能通过 setLayout 校验）。 */
  export const layoutValueList: string[];
}
