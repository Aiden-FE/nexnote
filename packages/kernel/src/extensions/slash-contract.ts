import type { EditorView } from '@tiptap/pm/view';
import type { QuickInsertCapability, QuickInsertExecution } from '@nexnote/shared';

/** 当前快捷插入的执行能力；由输入上下文和插件声明共同决定。 */
export interface SlashExecutionContext {
  triggerFrom: number;
  triggerTo: number;
  /** trigger 前后均无有效正文，才允许块类型转换。 */
  emptyBlock: boolean;
  capabilities: ReadonlySet<QuickInsertCapability>;
}

export interface SlashExecutionContract {
  execution: QuickInsertExecution;
  capability: QuickInsertCapability;
}

export function canExecuteSlashAction(
  contract: SlashExecutionContract | undefined,
  context: SlashExecutionContext,
): boolean {
  if (!contract || !context.capabilities.has(contract.capability)) return false;
  return contract.execution !== 'convert-empty-block' || context.emptyBlock;
}

/** 结构动作只会插在当前顶层块之后，永不 replaceSelection 截断正文。 */
export function insertAtSafeBlockBoundary(
  view: EditorView,
  node: Parameters<typeof view.state.tr.insert>[1],
): boolean {
  const $from = view.state.selection.$from;
  if ($from.depth < 1) return false;
  view.dispatch(view.state.tr.insert($from.after(1), node).scrollIntoView());
  return true;
}

export function consumeSlashTrigger(view: EditorView, context: SlashExecutionContext): void {
  if (context.triggerTo > context.triggerFrom) {
    view.dispatch(view.state.tr.delete(context.triggerFrom, context.triggerTo).scrollIntoView());
  }
}
