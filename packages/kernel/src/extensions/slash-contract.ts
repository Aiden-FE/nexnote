import type { EditorView } from '@tiptap/pm/view';
import type { Transaction } from '@tiptap/pm/state';
import type { QuickInsertCapability, QuickInsertExecution } from '@nexnote/shared';

/** 当前快捷插入的执行能力；由输入上下文和插件声明共同决定。 */
export interface SlashExecutionContext {
  triggerFrom: number;
  triggerTo: number;
  /** 触发所在的最内层可编辑 textblock；菜单不得跨兄弟列表项或引用段落复用。 */
  textblockFrom: number;
  textblockTo: number;
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

/** 同一未派发 transaction 中先消费 trigger，再执行动作；失败时丢弃整个 transaction。 */
export interface SlashActionTransaction {
  readonly view: EditorView;
  readonly tr: Transaction;
  readonly context: SlashExecutionContext;
}

/** 结构动作只会插在当前顶层块之后，永不 replaceSelection 截断正文。 */
export function insertAtSafeBlockBoundary(
  view: EditorView,
  node: Parameters<typeof view.state.tr.insert>[1],
  transaction?: Transaction,
): boolean {
  const tr = transaction ?? view.state.tr;
  const $from = tr.selection.$from;
  if ($from.depth < 1) return false;
  tr.insert($from.after(1), node).scrollIntoView();
  if (transaction) return true;
  view.dispatch(tr);
  return true;
}

export function consumeSlashTrigger(tr: Transaction, context: SlashExecutionContext): void {
  if (context.triggerTo > context.triggerFrom) {
    tr.delete(context.triggerFrom, context.triggerTo);
  }
}
