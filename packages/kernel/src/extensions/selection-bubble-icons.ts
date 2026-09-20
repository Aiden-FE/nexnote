/**
 * DEV-063：划词工具栏图标管线（框架无关、安全 SVG）。
 *
 * - 来源：`lucide-react` 已安装版本的公开 `__iconNode` 数据（与顶部工具栏一致），
 *   经 `document.createElementNS(SVG_NS, …)` 构建 SVG，禁止 `innerHTML`/`outerHTML`。
 * - 运行时约定：仅使用「元素名 + 属性对象」描述子节点；对每个属性值用 setAttribute 写入，
 *   避免把用户/外部字符串当作 HTML 解析。
 * - 注入：`BubbleIconRenderer` 由渲染层通过 `SelectionBubbleOptions.iconRenderer` 传入。
 *   默认 renderer 返回与该版本 lucide-react 完全一致的 Lucide SVG；
 *   未注入时保留 data-icon 语义（fallback 由 createBubbleIcon 维护）。
 *
 * 不在 renderer 内调用 React DOM、不引入 lucide-react 组件渲染（避免把 React 拽入
 * 框架无关的 kernel 工具栏）。仅复用已安装 lucide 包内同版本的图标几何数据。
 */

import type { BubbleIconName } from './selection-bubble';

export type BubbleIconRenderer = (
  icon: BubbleIconName | 'chevron-down',
) => SVGElement | null;

/** 默认 SVG 命名空间常量：与 `document.createElementNS` 共用，避免重复字面量。 */
export const SVG_NS = 'http://www.w3.org/2000/svg';

/** Lucide 通用 viewBox（lucide-react 1.41 与既有图标一致）。 */
export const LUCIDE_VIEWBOX = '0 0 24 24';

/** 类型守卫：lucide 子节点只允许已知 SVG 元素。 */
type LucideChild =
  | ['path', Record<string, string>]
  | ['circle', Record<string, string>]
  | ['rect', Record<string, string>]
  | ['line', Record<string, string>]
  | ['polyline', Record<string, string>]
  | ['polygon', Record<string, string>]
  | ['ellipse', Record<string, string>]
  | ['g', Record<string, string>];

const KNOWN_TAGS = new Set([
  'path',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'ellipse',
  'g',
]);

/** 复刻 lucide-react 1.41 内对应图标的 `__iconNode`（与顶部 lucide-react 工具栏一一对应）。
 *  与 `dist/esm/icons/*.mjs` 中 `__iconNode` 数组字节一致。
 *  仅在 lockfile 锁定的版本下同步：升级 lucide-react 时需手动同步本表。 */
const LUCIDE_ICON_NODES: Record<string, LucideChild[]> = {
  bold: [['path', { d: 'M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8', key: 'mg9rjx' }]],
  italic: [
    ['line', { x1: '19', x2: '10', y1: '4', y2: '4', key: '15jd3p' }],
    ['line', { x1: '14', x2: '5', y1: '20', y2: '20', key: 'bu0au3' }],
    ['line', { x1: '15', x2: '9', y1: '4', y2: '20', key: 'uljnxc' }],
  ],
  strikethrough: [
    ['path', { d: 'M16 4H9a3 3 0 0 0-2.83 4', key: '43sutm' }],
    ['path', { d: 'M14 12a4 4 0 0 1 0 8H6', key: 'nlfj13' }],
    ['line', { x1: '4', x2: '20', y1: '12', y2: '12', key: '1e0a9i' }],
  ],
  code: [
    ['path', { d: 'm16 18 6-6-6-6', key: 'eg8j8' }],
    ['path', { d: 'm8 6-6 6 6 6', key: 'ppft3o' }],
  ],
  link: [
    ['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', key: '1cjeqo' }],
    ['path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71', key: '19qd67' }],
  ],
  sparkles: [
    [
      'path',
      {
        d: 'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
        key: '1s2grr',
      },
    ],
    ['path', { d: 'M20 2v4', key: '1rf3ol' }],
    ['path', { d: 'M22 4h-4', key: 'gwowj6' }],
    ['circle', { cx: '4', cy: '20', r: '2', key: '6kqj1y' }],
  ],
  stop: [['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2', key: 'afitv7' }]],
  'chevron-down': [['path', { d: 'm6 9 6 6 6-6', key: 'qrunsl' }]],
};

/** 根据 lucide 几何数据构造 `<svg>` 节点。返回值未挂载到任何父节点，调用方负责追加。
 *  实现选择：setAttribute 逐字段写入，避免任何字符串拼接进 innerHTML。 */
export function buildLucideSvg(name: BubbleIconName | 'chevron-down'): SVGSVGElement | null {
  // 'strike' 是 bubble 语义名，lucide 几何名为 'strikethrough'，二者同形状
  const lookup = name === 'strike' ? 'strikethrough' : name;
  const children = LUCIDE_ICON_NODES[lookup];
  if (!children) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', LUCIDE_VIEWBOX);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.dataset.lucide = lookup;
  for (const [tag, attrs] of children) {
    if (!KNOWN_TAGS.has(tag)) continue;
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'key') continue; // React key 不是 SVG 属性
      node.setAttribute(kebab(key), String(value));
    }
    svg.append(node);
  }
  return svg;
}

function kebab(name: string): string {
  if (name === 'className') return 'class';
  // 其余属性均为已 kebab-case 或单段名称（d / cx / cy / r / x1 / x2 / y1 / y2 / width / height / rx）。
  return name;
}

/** 默认 renderer：从 lucide 数据构造 SVG。测试与未注入场景都使用此 renderer。 */
export const defaultBubbleIconRenderer: BubbleIconRenderer = (icon) => buildLucideSvg(icon);