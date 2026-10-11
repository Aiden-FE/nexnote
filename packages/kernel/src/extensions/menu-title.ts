/**
 * 菜单类标题的语言无关解析（ADR-0023）。
 *
 * 与斜杠菜单 `QuickInsertItem` 的既有约定一致：
 * - `titleKey`：应用自有文案，按**当前**界面语言成文；
 * - `titleText`：插件贡献原文，属 MUST-NOT-translate 边界，直接上屏；
 * - `titleKey` 指向目录中不存在的 key 时回退 `titleText`，绝不把裸 key 上屏。
 */
import { tCurrent } from '@nexnote/shared';

export interface MenuTitleSource {
  titleKey?: string;
  titleText?: string;
  /**
   * Deprecated alias of `titleText` kept for the transition of existing
   * block-menu / plugin-menu / bubble call sites. New code must use
   * `titleKey` (app copy) or `titleText` (plugin-supplied source text).
   */
  title?: string;
}

export function resolveMenuTitle(source: MenuTitleSource): string {
  const fallback = source.titleText ?? source.title ?? '';
  if (!source.titleKey) return fallback;
  const translated = tCurrent(source.titleKey);
  return translated === source.titleKey ? fallback || translated : translated;
}
