import type { OutlineEntry } from '../outline';

/** 预览 heading 元素的最小结构契约（DOM Element 兼容，便于纯函数单测）。 */
export interface PreviewHeadingLike {
  textContent: string | null;
}

/** 空白归一化：折叠所有空白（含换行）为单个空格并去除首尾，用于源码侧与渲染侧文本比对。 */
export function normalizePreviewHeadingText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 预览悬浮目录的定位目标（DEV-047）：
 * 优先按「空白归一化后文本相等」匹配 entry.text——引用块/原始 HTML 标题会渲染为
 * 预览 heading 但不一定与源码解析条目一一对应，纯 ordinal 索引会错位。重名标题时
 * 先校验 ordinal 位置上的 heading 文本是否一致（一致则该位置就是本条目），失配才
 * 全量扫描首个文本相同者；完全无匹配时回退 ordinal 顺序索引，与旧行为兼容。
 */
export function matchPreviewHeading<T extends PreviewHeadingLike>(
  headings: readonly T[],
  entry: Pick<OutlineEntry, 'text' | 'ordinal'>,
): T | null {
  const ordinalHeading = headings[entry.ordinal];
  const wanted = normalizePreviewHeadingText(entry.text);
  if (wanted.length > 0) {
    if (
      ordinalHeading &&
      normalizePreviewHeadingText(ordinalHeading.textContent ?? '') === wanted
    ) {
      return ordinalHeading;
    }
    for (const heading of headings) {
      if (normalizePreviewHeadingText(heading.textContent ?? '') === wanted) return heading;
    }
  }
  return ordinalHeading ?? null;
}
