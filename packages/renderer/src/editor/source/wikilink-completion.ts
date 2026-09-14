import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { SuggestionItem } from '@nexnote/kernel';
import { withUncreated, type PageCandidate } from '../interactions/suggestions';

/**
 * 源码模式 `[[` 双链补全（DEV-024）。
 *
 * 与块编辑 `[[` 补全共用同一候选数据源（withUncreated：模糊过滤 + 别名匹配 +
 * 红链「创建新页面」项）；键盘 ↑↓ / Enter / Esc 由 @codemirror/autocomplete 默认
 * 键位提供。候选组装与触发识别拆为纯函数，便于脱离编辑器环境单测。
 */

export interface WikilinkCompletionDeps {
  /** 页面候选来源（与块编辑 [[ 补全同一数据源） */
  getPages(): PageCandidate[];
  /** 确认候选后的回调（红链创建页面等副作用） */
  onPick?(item: SuggestionItem): void;
}

/**
 * 光标前文本（当前行内）处于 `[[查询词` 状态时返回查询词，否则 null。
 * 已输入 `]`（闭合）或再次出现 `[[`（嵌套触发）时不补全。
 */
export function wikilinkQueryBefore(textBefore: string): string | null {
  const idx = textBefore.lastIndexOf('[[');
  if (idx < 0) return null;
  const after = textBefore.slice(idx + 2);
  if (after.includes(']')) return null;
  if (after.includes('[')) return null;
  return after;
}

/** 选中候选后写入源码的文本：目标 + 可选 `|别名` + 闭合符 `]]`。 */
export function wikilinkInsertText(item: SuggestionItem): string {
  const target = item.insert?.target ?? item.id;
  const alias = item.insert?.alias ?? null;
  return alias ? `${target}|${alias}]]` : `${target}]]`;
}

function toCompletion(item: SuggestionItem, deps: WikilinkCompletionDeps): Completion {
  return {
    label: item.title,
    detail: item.meta === 'uncreated' ? '创建新页面' : item.hint,
    apply: (view: EditorView, _completion, from, to) => {
      // 光标后紧跟手输的 `]]` 时一并吞掉，避免产生三连闭合 `]]]`。
      const trailing = view.state.doc.sliceString(to, to + 2) === ']]' ? 2 : 0;
      const insert = wikilinkInsertText(item);
      view.dispatch({
        changes: { from, to: to + trailing, insert },
        selection: { anchor: from + insert.length },
        userEvent: 'input.complete',
      });
      deps.onPick?.(item);
    },
  };
}

export function createWikilinkCompletionSource(
  deps: WikilinkCompletionDeps,
): (context: CompletionContext) => CompletionResult | null {
  return (context) => {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    const query = wikilinkQueryBefore(textBefore);
    if (query == null) return null;
    const items = withUncreated(deps.getPages(), query).slice(0, 8);
    if (items.length === 0) return null;
    return {
      from: context.pos - query.length,
      options: items.map((item) => toCompletion(item, deps)),
      // 关闭 CM 默认按 label 模糊过滤：`|别名` / `#锚点` 等查询词不在 label 内，
      // 会被误判 0 命中而关菜单；候选过滤由 withUncreated（标题/路径/别名）负责。
      filter: false,
    };
  };
}

/** 源码模式 `[[` 双链补全扩展（override 独占补全通道，不与语言补全混排）。 */
export function sourceWikilinkCompletion(deps: WikilinkCompletionDeps): Extension {
  return autocompletion({
    override: [createWikilinkCompletionSource(deps)],
    icons: false,
  });
}
