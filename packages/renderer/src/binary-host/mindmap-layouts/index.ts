import { layoutValueList } from 'simple-mind-map/src/constants/constant.js';
import { UpStructure } from './up-structure';
import { XStructure } from './x-structure';

/**
 * DEV-102 / ADR-0020 决策 2：自研布局的注册。
 *
 * simple-mind-map 0.14.0 里没有「向上」树布局，`rightFishbone*` 还是死枚举
 * （常量表有、Render 的 layouts 表没有 entry，选中会被静默降级），所以向上分支与
 * X 结构由本仓库实现。注册必须绕过库的两道白名单，但不改 node_modules：
 *
 * 1. 渲染层查找链是 `layouts[name] || this.mindMap[name]`（Render.setLayout），
 *    把布局类挂到 MindMap 实例上即可命中；
 * 2. `opt.layout` 与 `setLayout` 都按模块级 `layoutValueList` 校验，而该数组没有
 *    公开写入口，只能就地把自研布局名注入（本文件是唯一的注入点）。
 *
 * 必须在 `new MindMap(...)` 之后、`setLayout(...)` 之前调用：handleOpt 在构造时
 * 就会校验 layout，构造参数不能用自研名字。
 */

export const UP_STRUCTURE_LAYOUT = 'nexxUpStructure';
export const X_STRUCTURE_LAYOUT = 'nexxXStructure';

export const CUSTOM_MINDMAP_LAYOUTS: Record<string, unknown> = {
  [UP_STRUCTURE_LAYOUT]: UpStructure,
  [X_STRUCTURE_LAYOUT]: XStructure,
};

let allowListPatched = false;

function ensureAllowList(): void {
  if (allowListPatched) return;
  for (const name of Object.keys(CUSTOM_MINDMAP_LAYOUTS)) {
    if (!layoutValueList.includes(name)) layoutValueList.push(name);
  }
  allowListPatched = true;
}

/** 把自研布局类挂到实例上（幂等）。 */
export function registerCustomMindmapLayouts(mindMap: object): void {
  ensureAllowList();
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

export { UpStructure } from './up-structure';
export { XStructure } from './x-structure';
