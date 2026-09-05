/**
 * @nexnote/kernel — 编辑器内核（框架无关）。
 *
 * 本包在 DEV-001 中仅是占位空壳：真实实现（TipTap 3 + Markdown 双向管道 +
 * UniqueID/DragHandle/Suggestion 扩展集）由 DEV-002 落地。此处导出稳定的
 * 入口签名与类型形状，供渲染层与后续票提前对齐依赖关系。
 */

export const KERNEL_VERSION = '0.0.0-placeholder';

/** DEV-002 将提供的编辑器配置形状（预留，字段会随实现细化）。 */
export interface EditorKernelConfig {
  /** 初始 Markdown 内容 */
  initialMarkdown?: string;
  /** 内容变化回调（防抖保存由调用方/DEV-002 实现） */
  onContentChange?: (markdown: string) => void;
}

/** DEV-002 将提供的编辑器实例形状（预留）。 */
export interface EditorKernelInstance {
  /** 当前编辑器内容序列化为 Markdown */
  getMarkdown(): string;
  /** 销毁编辑器实例 */
  destroy(): void;
}

/** 编辑器工厂（占位实现：渲染提示文本；DEV-002 替换为 TipTap 3 内核）。 */
export function createEditor(
  container: HTMLElement,
  _config?: EditorKernelConfig,
): EditorKernelInstance {
  container.textContent =
    'NexNote editor kernel 未实现：本区域将由 DEV-002 的 TipTap 3 内核渲染。';
  return {
    getMarkdown: () => '',
    destroy: () => {
      container.textContent = '';
    },
  };
}
