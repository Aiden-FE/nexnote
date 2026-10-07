import { UpStructure } from './up-structure';
import { XStructure, clearXStructureAssignments } from './x-structure';

/**
 * DEV-102 / ADR-0020 决策 2：自研布局的注册与应用。
 *
 * simple-mind-map 0.14.0 里没有「向上」树布局，`rightFishbone*` 还是死枚举
 * （常量表有、Render 的 layouts 表没有 entry，选中会被静默降级），所以向上分支与
 * X 结构由本仓库实现。注册不改 node_modules，只用库已有的两个入口：
 *
 * 1. 渲染层的查找链是 `layouts[name] || this.mindMap[name]`（Render.setLayout），
 *    把布局类挂到 MindMap 实例上即可被实例化；
 * 2. `opt.layout` 与 `setLayout` 都按模块级 `layoutValueList` 校验，而该数组没有
 *    公开写入口。自研布局名不在其中，因此这里在实例层复刻一次 setLayout 的动作
 *    （校验 → view.reset → renderer.setLayout → render → emit），只去掉白名单校验。
 *
 * 为什么不在实例层之外注入白名单：打包后渲染进程里 `simple-mind-map`（package.json
 * 的 main 指向 dist UMD）与 `simple-mind-map/src/constants/constant.js` 可能是两份
 * 独立模块实例，改动其中一份对另一份无效——单测里就复现了这个失效。实例层绕行
 * 与模块解析结果无关，是唯一可靠的做法。
 */

export const UP_STRUCTURE_LAYOUT = 'nexxUpStructure';
export const X_STRUCTURE_LAYOUT = 'nexxXStructure';

export const CUSTOM_MINDMAP_LAYOUTS: Record<string, unknown> = {
  [UP_STRUCTURE_LAYOUT]: UpStructure,
  [X_STRUCTURE_LAYOUT]: XStructure,
};

export function isCustomMindmapLayout(layout: string): boolean {
  return Object.prototype.hasOwnProperty.call(CUSTOM_MINDMAP_LAYOUTS, layout);
}

/** 把自研布局类挂到实例上（幂等）。 */
export function registerCustomMindmapLayouts(mindMap: object): void {
  const target = mindMap as Record<string, unknown>;
  for (const [name, LayoutClass] of Object.entries(CUSTOM_MINDMAP_LAYOUTS)) {
    if (!(name in target)) {
      Object.defineProperty(target, name, {
        value: LayoutClass,
        configurable: true,
        writable: true,
      });
    }
  }
}

/** 库内实例中 setLayout 用到的内部成员（结构与 index.js 的实现一致）。 */
interface MindMapLayoutInternals {
  opt: Record<string, unknown>;
  view: { reset(): void };
  renderer: { setLayout(): void };
  render(callback: null, source: string): void;
  emit(event: string, payload: unknown): void;
  setLayout(layout: string, notRender?: boolean): void;
}

/**
 * 应用布局结构：库内布局名走官方 setLayout；自研布局名走实例层绕行。
 * 必须在 `new MindMap(...)` 之后调用（构造期 handleOpt 就会校验 layout，构造参数
 * 不能用自研名字）。
 */
export function applyMindmapLayout(mindMap: object, layout: string): void {
  registerCustomMindmapLayouts(mindMap);
  const internals = mindMap as unknown as MindMapLayoutInternals;
  if (!isCustomMindmapLayout(layout)) {
    internals.setLayout(layout);
    return;
  }
  internals.opt.layout = layout;
  internals.view.reset();
  internals.renderer.setLayout();
  internals.render(null, 'changeLayout');
  internals.emit('layout_change', layout);
}

export { clearXStructureAssignments };

export { UpStructure } from './up-structure';
export { XStructure } from './x-structure';
