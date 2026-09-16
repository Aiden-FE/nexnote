import type { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import type { ChangeSpec } from '@codemirror/state';

export type SourceFormatScope = 'selection' | 'document';

export interface SourceTextEdit {
  from: number;
  to: number;
  insert: string;
}

/** Full-document context is required even when formatting only selected lines. */
export function planSourceMarkdown(
  text: string,
  range?: { from: number; to: number },
): SourceTextEdit[] {
  const edits: SourceTextEdit[] = [];
  let frontmatter = false;
  let fence: { marker: string; length: number } | undefined;
  let previousBlank = false;
  const lines = text.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g);
  for (const match of lines) {
    const from = match.index;
    if (from === text.length) break;
    const line = match[1]!;
    const ending = match[2]!;
    const selected =
      !range ||
      (range.from < range.to && from < range.to && from + line.length + ending.length > range.from);
    if (from === 0 && /^\uFEFF?---[ \t]*$/.test(line)) {
      frontmatter = true;
      previousBlank = false;
      continue;
    }
    if (frontmatter) {
      if (/^(---|\.\.\.)[ \t]*$/.test(line)) frontmatter = false;
      continue;
    }
    // Conservatively protect fences, including indented/container fences.
    const fenceLine = line.replace(/^(?:[ \t]*>[ \t]?)+/, '');
    const marker = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(fenceLine);
    if (fence) {
      if (
        marker &&
        marker[1]![0] === fence.marker &&
        marker[1]!.length >= fence.length &&
        !marker[2]!.trim()
      )
        fence = undefined;
      previousBlank = false;
      continue;
    }
    if (marker && (marker[1]![0] !== '`' || !marker[2]!.includes('`'))) {
      fence = { marker: marker[1]![0]!, length: marker[1]!.length };
      previousBlank = false;
      continue;
    }
    const blank = /^[ \t]*$/.test(line);
    if (blank && previousBlank && selected) {
      edits.push({ from, to: from + line.length + ending.length, insert: '' });
    } else if (selected) {
      let formatted = blank ? '' : line;
      // Only valid ATX headings: do not turn hashtags into headings.
      formatted = formatted.replace(/^( {0,3}#{1,6})[ \t]+(?=\S)/, '$1 ');
      // Keep thematic breaks and setext underlines intact.
      if (!/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line)) {
        formatted = formatted.replace(
          /^( *)([-+*])[ \t]+(?=\S)/,
          (_, indent: string) => ' '.repeat(indent.length - (indent.length % 2)) + '- ',
        );
      }
      if (formatted !== line) {
        // Restrict the edit to the changed prefix to preserve caret/content positions.
        let suffix = 0;
        while (
          suffix < line.length &&
          suffix < formatted.length &&
          line[line.length - 1 - suffix] === formatted[formatted.length - 1 - suffix]
        )
          suffix++;
        edits.push({
          from,
          to: from + line.length - suffix,
          insert: formatted.slice(0, formatted.length - suffix),
        });
      }
    }
    previousBlank = blank;
  }
  return edits;
}

/** Lightweight, deterministic formatter; line endings and protected regions stay byte-identical. */
export function formatSourceMarkdown(text: string): string {
  let result = text;
  for (const edit of planSourceMarkdown(text).reverse()) {
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  }
  return result;
}

/** Apply prefix edits in one isolated undo event, retaining selection direction. */
function applySourceEdits(view: EditorView, edits: ChangeSpec): void {
  const changes = view.state.changes(edits);
  if (changes.empty) return;
  view.dispatch({
    changes,
    selection: view.state.selection.map(changes, 1),
    annotations: isolateHistory.of('full'),
    scrollIntoView: true,
  });
}

export function applySourceMarkdownFormat(
  view: EditorView,
  scope: SourceFormatScope = 'document',
): boolean {
  if (view.state.readOnly) return false;
  const selection = view.state.selection.main;
  if (scope === 'selection' && selection.empty) return false;
  applySourceEdits(
    view,
    planSourceMarkdown(view.state.doc.toString(), scope === 'selection' ? selection : undefined),
  );
  return true;
}

/** Tab only owns nonempty selections spanning multiple physical lines. */
export function indentSourceSelection(view: EditorView, outdent = false): boolean {
  if (view.state.readOnly) return false;
  const { state } = view;
  const selectedLines = new Set<number>();
  for (const range of state.selection.ranges) {
    if (range.empty || state.doc.lineAt(range.from).number === state.doc.lineAt(range.to).number)
      return false;
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to - 1).number;
    for (let number = first; number <= last; number++) selectedLines.add(number);
  }
  const edits: SourceTextEdit[] = [];
  for (const number of [...selectedLines].sort((a, b) => a - b)) {
    const line = state.doc.line(number);
    const count = outdent ? /^ {0,2}/.exec(line.text)![0].length : 0;
    if (!outdent || count)
      edits.push({ from: line.from, to: line.from + count, insert: outdent ? '' : '  ' });
  }
  applySourceEdits(view, edits);
  return true;
}

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
