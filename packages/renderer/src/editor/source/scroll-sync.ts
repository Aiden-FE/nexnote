/**
 * 源码 → 预览单向滚动同步（DEV-020）。
 *
 * 只按「已滚动距离 / 可滚动距离」比例映射：源码区滚到一半，
 * 预览区也滚到一半。反向（预览 → 源码）不联动，避免抖动回路。
 */
export function syncScrollRatio(
  src: { scrollTop: number; scrollHeight: number; clientHeight: number },
  dst: { scrollHeight: number; clientHeight: number },
): number {
  const srcRange = src.scrollHeight - src.clientHeight;
  if (srcRange <= 0) return 0;
  const ratio = Math.min(Math.max(src.scrollTop / srcRange, 0), 1);
  const dstRange = dst.scrollHeight - dst.clientHeight;
  return Math.round(ratio * dstRange);
}
