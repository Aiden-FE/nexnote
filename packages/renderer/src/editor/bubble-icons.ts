/**
 * DEV-063：渲染层共享 SVG icon renderer。
 *
 * - 同一实例同时注入块编辑 (EditorView) 与源码模式 (SourceModeView) 的 selection bubble，
 *   保证两模式图标视觉一致（同一份 lucide-react 1.41 几何）。
 * - 默认走内核 `defaultBubbleIconRenderer`；如需切换到 lucide-react 组件输出，
 *   可在此处替换实现并保持引用稳定（不能每渲染重建，否则样式不命中）。
 *
 * 不在此处引入 React DOM；renderer 仅返回 SVGElement，由 bubble DOM API 直接挂载。
 */

import { defaultBubbleIconRenderer, type BubbleIconRenderer } from '@nexnote/kernel';

/**
 * 块编辑与源码模式共用的 icon renderer（DEV-063）。
 *
 * 内核 defaultBubbleIconRenderer 已是纯 SVG DOM、跨模式一致；此处只是再包一层
 * 类型稳定的导出，方便块/源码两个 EditorView 注入同一引用。
 */
export const selectionBubbleIconRenderer: BubbleIconRenderer = defaultBubbleIconRenderer;