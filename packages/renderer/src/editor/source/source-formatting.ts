import type { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import type { ChangeSpec } from '@codemirror/state';
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

export type SourceFormatScope = 'selection' | 'document';

export interface SourceTextEdit {
  from: number;
  to: number;
  insert: string;
}

/** thematic break 整行样式（`---` / `***` / `- - -` 等）；`---` 同时也是 setext 下划线。 */
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/**
 * 规范单个无序列表行（语义安全优先）：
 *
 * - 绝不改写标记字符：`-`/`+`/`*` 混用代表「不同列表」，改写会静默合并两个列表；
 * - 仅把标记后的空白规范为单个空格；标记后紧跟非空白视为漏空格笔误补一个空格，
 *   但内容以数字开头（如 `-3 度`）或行内再次出现标记字符（如 `*斜体*`）时
 *   更可能是正文而非列表，保持原样；
 * - 缩进仅在两种笔误情形下取整到偶数：顶层 1 空格归 0（CommonMark 中 1 与 0
 *   空格同为顶层项，归 2 会把兄弟项变成子项）；奇数缩进且前一个非空行恰为
 *   「取整值缩进上的无序列表项」时对齐该同级项。其余缩进一律不动，
 *   特别保护有序父项（如 `1. `）内容列下的奇数缩进子列表。
 */
function formatBulletLine(line: string, previousBulletIndent: number | null): string {
  const match = /^( *)([-+*])(.*)$/.exec(line);
  if (!match) return line;
  const indent = match[1]!;
  const marker = match[2]!;
  const rest = match[3]!;
  let nextIndent = indent;
  if (
    indent.length % 2 === 1 &&
    (indent.length === 1 || previousBulletIndent === indent.length - 1)
  )
    nextIndent = ' '.repeat(indent.length - 1);
  let nextRest = rest;
  const whitespace = /^[ \t]+/.exec(rest);
  if (whitespace && rest.length > whitespace[0]!.length) {
    nextRest = ` ${rest.slice(whitespace[0]!.length)}`;
  } else if (/^\S/.test(rest) && !/^\d/.test(rest) && !rest.includes(marker)) {
    nextRest = ` ${rest}`;
  }
  return nextIndent + marker + nextRest;
}

/** 前一个非空行作为无序列表项时的缩进；非列表项行（含 thematic break）返回 null。 */
function bulletIndentOf(line: string): number | null {
  if (THEMATIC_BREAK.test(line)) return null;
  const match = /^( *)([-+*])(?:[ \t]+(?=\S)|[ \t]*$)/.exec(line);
  return match ? match[1]!.length : null;
}

/** 即使只格式化选中的行，也需要全文上下文（frontmatter/围栏状态需跨行追踪）。 */
export function planSourceMarkdown(
  text: string,
  range?: { from: number; to: number },
): SourceTextEdit[] {
  const edits: SourceTextEdit[] = [];
  let frontmatter = false;
  let fence: { marker: string; length: number } | undefined;
  let previousBlank = false;
  let previousBulletIndent: number | null = null;
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
      previousBulletIndent = null;
      continue;
    }
    if (frontmatter) {
      if (/^(---|\.\.\.)[ \t]*$/.test(line)) frontmatter = false;
      previousBulletIndent = null;
      continue;
    }
    // 保守起见保护代码围栏，包括缩进或引用容器内的围栏。
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
      previousBulletIndent = null;
      continue;
    }
    if (marker && (marker[1]![0] !== '`' || !marker[2]!.includes('`'))) {
      fence = { marker: marker[1]![0]!, length: marker[1]!.length };
      previousBlank = false;
      previousBulletIndent = null;
      continue;
    }
    const blank = /^[ \t]*$/.test(line);
    if (blank && previousBlank && selected) {
      edits.push({ from, to: from + line.length + ending.length, insert: '' });
    } else if (selected) {
      let formatted = blank ? '' : line;
      // 仅规范合法 ATX 标题：不把 hashtag 误变成标题。
      formatted = formatted.replace(/^( {0,3}#{1,6})[ \t]+(?=\S)/, '$1 ');
      // thematic break 与 setext 下划线整体保持原样；无序列表行按语义安全规则规范。
      if (!blank && !THEMATIC_BREAK.test(line)) {
        const bullet = formatBulletLine(line, previousBulletIndent);
        if (bullet !== line) formatted = bullet;
      }
      if (formatted !== line) {
        // 编辑收缩到实际变化的前缀，尽量保住光标与内容位置。
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
    // 空行不重置：缩进取整参考的是「前一个非空行」。
    if (!blank) previousBulletIndent = bulletIndentOf(line);
  }
  return edits;
}

/** 轻量、确定性的格式化：行尾与受保护区域保持字节不变。 */
export function formatSourceMarkdown(text: string): string {
  let result = text;
  for (const edit of planSourceMarkdown(text).reverse()) {
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  }
  return result;
}

/** 将前缀编辑合入单个隔离 undo 事务，并保留选区方向。 */
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

/** Tab 仅接管跨多个物理行的非空选区。 */
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
