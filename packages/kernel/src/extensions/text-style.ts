import { TextStyle, Color, BackgroundColor } from '@tiptap/extension-text-style';
import type { JSONContent } from '@tiptap/core';

/**
 * 文本样式（字体颜色 + 背景色）。
 *
 * 在官方 TextStyle/Color/BackgroundColor 之上补 Markdown 往返：官方扩展只
 * 处理 HTML，@tiptap/markdown 对没有 renderMarkdown 的 mark 会**静默丢内容**。
 * 落盘采用 Obsidian 兼容的内联 HTML span：
 *
 *   `<span style="color: #ff0000; background-color: #fff2cc">文本</span>`
 *
 * 解析侧无需自定义 tokenizer：@tiptap/markdown 的 parseHTMLToken 会用
 * generateJSON 走各扩展的 parseHTML，官方 Color/BackgroundColor 已注册
 * span[style] 的 color/background-color 解析规则，故内联 span 自动还原。
 */
function serializeStyle(attrs: Record<string, unknown> | undefined): string {
  if (!attrs) return '';
  const declarations: string[] = [];
  const color = attrs.color;
  const bg = attrs.backgroundColor;
  if (typeof color === 'string' && color) declarations.push(`color: ${color}`);
  if (typeof bg === 'string' && bg) declarations.push(`background-color: ${bg}`);
  return declarations.join('; ');
}

/**
 * 颜色 span 要成为**最内层** mark：`**<span style="color:…">红</span>**` 而不是
 * `<span style="color:…">**红**</span>`——后者在 CommonMark 中 span 内的 `**`
 * 不再被解析成加粗，会把字面星号写进文件。
 *
 * @tiptap/core 按 priority 降序注册 mark，rank 越大越靠内层；StarterKit 的
 * bold/italic 等都是默认 priority(100)，所以这里取 90 让颜色落在它们内侧。
 * getExtensionField 读的是扩展顶层字段，`extend({ priority })` 即可生效。
 */
const TEXT_STYLE_PRIORITY = 90;

export const TextStyleWithMarkdown = TextStyle.extend({
  priority: TEXT_STYLE_PRIORITY,
  renderMarkdown(
    node: JSONContent,
    helpers: { renderChildren: (node: JSONContent) => string },
  ): string {
    const style = serializeStyle(node.attrs as Record<string, unknown> | undefined);
    const text = helpers.renderChildren(node);
    if (!style) return text;
    return `<span style="${style}">${text}</span>`;
  },
});

export { Color, BackgroundColor };
