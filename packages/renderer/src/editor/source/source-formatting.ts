import type { EditorView } from '@codemirror/view';

import type { SourceBubbleAction } from './source-bubble';
import {
  FORMAT_BOLD,
  FORMAT_CODE,
  FORMAT_ITALIC,
  FORMAT_LINK,
  FORMAT_STRIKE,
  FORMAT_WIKILINK,
  LINK_URL_PROMPT,
} from '../interactions/formatting';

/**
 * DEV-023 源码模式划词格式化：Markdown 语法包裹（与块编辑 bubble 按钮集对齐）。
 *
 * - 五项格式化映射 `**x**` / `*x*` / `~~x~~` / `` `x` `` / `[x](url)`，双链映射 `[[x]]`
 * - 无选区时插入空语法骨架，光标落在待填位置（双链骨架为 `[[页面名]]`）
 * - 写回由 {@link applySourceFormat} 以单个 CodeMirror 事务完成（一次 undo 整体撤销），
 *   与 AI Accept 同语义（ADR-0004 修订「划词按钮集统一」）
 */

/** 格式化动作 id 顺序（与块编辑 bubble 一致：五项格式化 + 双链）。 */
export const SOURCE_FORMAT_IDS = [
  FORMAT_BOLD,
  FORMAT_ITALIC,
  FORMAT_STRIKE,
  FORMAT_CODE,
  FORMAT_LINK,
  FORMAT_WIKILINK,
] as const;

/** 一次格式化写回计划：insert 为写入文本，anchor/head 为相对 insert 起点的选区。 */
export interface SourceFormatPlan {
  insert: string;
  /** 光标/选区起点（相对 insert 起点） */
  anchor: number;
  /** 选区终点（折叠时与 anchor 相等） */
  head: number;
}

/** URL 含空格/圆括号时用 `<…>` 包裹，避免提前闭合 `(url)`（CommonMark 行内链接语法）。 */
function safeLinkUrl(url: string): string {
  return /[()\s]/.test(url) ? `<${url}>` : url;
}

/**
 * 计算格式化包裹写回（纯函数，无编辑器依赖）。
 *
 * @param id 动作 id（SOURCE_FORMAT_IDS 之一；未知 id 返回 null）
 * @param text 选区文本；空白/空文本视为「无选区」，插入空语法骨架
 * @param url 链接动作的 URL；链接动作在 URL 缺省（取消输入）时返回 null
 */
export function planSourceFormat(
  id: string,
  text: string,
  url?: string | null,
): SourceFormatPlan | null {
  const hasText = text.trim().length > 0;
  const wrap = (prefix: string, suffix: string, placeholder = ''): SourceFormatPlan => {
    const inner = hasText ? text : placeholder;
    return {
      insert: `${prefix}${inner}${suffix}`,
      anchor: prefix.length,
      head: prefix.length + inner.length,
    };
  };

  switch (id) {
    case FORMAT_BOLD:
      return wrap('**', '**');
    case FORMAT_ITALIC:
      return wrap('*', '*');
    case FORMAT_STRIKE:
      return wrap('~~', '~~');
    case FORMAT_CODE:
      return wrap('`', '`');
    case FORMAT_LINK:
      if (!url) return null;
      return wrap('[', `](${safeLinkUrl(url)})`);
    case FORMAT_WIKILINK:
      return wrap('[[', ']]', '页面名');
    default:
      return null;
  }
}

/** 源码 bubble 的格式化按钮（与块编辑 bubble 同图标、同顺序；五项 + 双链）。 */
export function sourceFormatBubbleActions(): SourceBubbleAction[] {
  return [
    { id: FORMAT_BOLD, title: 'B', hint: '粗体 **文本**' },
    { id: FORMAT_ITALIC, title: 'I', hint: '斜体 *文本*' },
    { id: FORMAT_STRIKE, title: 'S', hint: '删除线 ~~文本~~' },
    { id: FORMAT_CODE, title: '`</>', hint: '行内代码 `代码`' },
    { id: FORMAT_LINK, title: '🔗', hint: '链接（外部 URL）[文本](url)' },
    { id: FORMAT_WIKILINK, title: '[[]]', hint: '双链（内部页面）[[页面名]]' },
  ];
}

/** 链接动作取 URL：沿用块编辑链接交互（window.prompt 轻量输入）。 */
function promptLinkUrl(): string | null {
  return window.prompt(LINK_URL_PROMPT);
}

/**
 * 在 CodeMirror 选区上执行格式化动作（真实选区；空选区插入语法骨架）。
 *
 * @returns 是否命中格式化 id（链接取消输入亦视为已处理，返回 true 且不写回）
 */
export function applySourceFormat(
  view: EditorView,
  id: string,
  options?: { promptUrl?: () => string | null },
): boolean {
  if (!(SOURCE_FORMAT_IDS as readonly string[]).includes(id)) return false;
  let url: string | null | undefined;
  if (id === FORMAT_LINK) {
    url = (options?.promptUrl ?? promptLinkUrl)();
    if (!url) return true;
  }
  const sel = view.state.selection.main;
  const text = sel.empty ? '' : view.state.sliceDoc(sel.from, sel.to);
  const plan = planSourceFormat(id, text, url);
  if (!plan) return false;
  // 单个事务写回（与 AI Accept 同语义）：一次 undo 整体撤销
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: plan.insert },
    selection: { anchor: sel.from + plan.anchor, head: sel.from + plan.head },
    scrollIntoView: true,
  });
  return true;
}
