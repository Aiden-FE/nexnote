import Base from 'simple-mind-map/src/layouts/Base.js';
import { asyncRun } from 'simple-mind-map/src/utils/index.js';
import { layoutSubtree } from './subtree';
import { buildLayoutNodes, type NodeBuilderHost } from './node-builder';
import {
  centerRootAtCanvas,
  renderDirectionalExpandBtn,
  renderDirectionalExpandBtnRect,
  renderDirectionalGeneralization,
  renderDirectionalLine,
  type LayoutRenderCtx,
  type RenderNode,
} from './renderers';

/**
 * DEV-102 向上分支结构（ADR-0020）：库内没有任何向上生长的树布局
 * （OrganizationStructure 硬编码向下生长，`CONSTANTS.DIR.UP` 从不进入布局代码），
 * 因此这里镜像一份「组织结构图」——根节点按库内惯例落位，子节点逐级向上生长，
 * 兄弟节点横向并排。
 *
 * 几何复用 mindmap-layouts/subtree 的自底向上内核；节点创建与尺寸缓存仍走库内
 * Base 契约（createNode），因此主题、概要、折叠等既有能力不受影响。
 */
export class UpStructure extends Base {
  override doLayout(callback: (root: SmmInternal.LayoutNode) => void): void {
    asyncRun([
      () => buildLayoutNodes(this as unknown as NodeBuilderHost),
      () => this.positionTree(),
      () => callback(this.root),
    ]);
  }

  /** 自底向上排布整棵树，再按库内 initRootNodePosition 规则把根节点落位。 */
  private positionTree(): void {
    const root = this.root;
    layoutSubtree(root, 'up', (depth: number) => this.getMarginX(depth + 1));
    centerRootAtCanvas(
      this as unknown as LayoutRenderCtx & { setNodeCenter(node: RenderNode): void },
      root,
    );
  }

  private ctx(): LayoutRenderCtx {
    return this as unknown as LayoutRenderCtx;
  }

  override renderLine(node: unknown, lines: unknown[], style: unknown, lineStyle: unknown): void {
    renderDirectionalLine(
      this.ctx(),
      node as RenderNode,
      lines as Parameters<typeof renderDirectionalLine>[2],
      style,
      lineStyle,
      'up',
    );
  }

  override renderExpandBtn(node: unknown, btn: unknown): void {
    renderDirectionalExpandBtn(
      this.ctx(),
      node as RenderNode,
      btn as Parameters<typeof renderDirectionalExpandBtn>[2],
      'up',
    );
  }

  override renderGeneralization(list: unknown[]): void {
    renderDirectionalGeneralization(
      this as unknown as Parameters<typeof renderDirectionalGeneralization>[0],
      list as Parameters<typeof renderDirectionalGeneralization>[1],
      'up',
    );
  }

  override renderExpandBtnRect(
    rect: unknown,
    expandBtnSize: number,
    width: number,
    height: number,
    _node: unknown,
  ): void {
    renderDirectionalExpandBtnRect(
      rect as Parameters<typeof renderDirectionalExpandBtnRect>[0],
      expandBtnSize,
      width,
      height,
      'up',
    );
  }
}

export default UpStructure;
