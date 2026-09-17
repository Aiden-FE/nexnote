import { closeHistory } from '@tiptap/pm/history';
import type { EditorActionContext, EditorKernelInstance } from '@nexnote/kernel';
import { fromAiActionId, WRITING_ACTION_MAP } from './actions';
import { assembleWritingContext, type BacklinkSnippet } from './context';
import { beginWritingSession } from './session';
import { getActiveEditor, subscribeActiveEditor } from '../../../editor/active-editor';

/**
 * 写作辅助编排器（DEV-010；DEV-037 状态机收口）。
 *
 * 由 EditorView 注入 kernel/上下文取值器；选区浮层 / 右键菜单 / 斜杠命令统一
 * 经 trigger(rawId, ctx) 进入：组装上下文 → 打开 diff 会话 → 流式生成 →
 * Accept（单事务回写，可 undo）/ Reject（原文不变）/ 停止（保留已显示内容）。
 * 会话生命周期全部交给 beginWritingSession，触发之外不得发出任何请求（ADR-0005）。
 */

export interface WritingControllerDeps {
  getKernel: () => EditorKernelInstance | null;
  getContext: () => { markdown: string; backlinks: BacklinkSnippet[] };
  /** Stable page/tab identity; absent in isolated kernel tests. */
  getPageId?: () => string | null;
  /** 上下文字符预算（测试可注入）。 */
  budgetChars?: number;
}

export interface WritingController {
  trigger: (rawActionId: string, ctx: EditorActionContext) => Promise<boolean> | false;
  /** Start `/ai` before consuming its trigger and bind the insertion point after that commit. */
  triggerSlash: (
    rawActionId: string,
    ctx: EditorActionContext,
    afterSlashCommit: (bindAnchor: () => void) => void,
  ) => Promise<boolean> | false;
}

export function createWritingController(deps: WritingControllerDeps): WritingController {
  const trigger = (rawActionId: string, ctx: EditorActionContext) => {
    const actionId = fromAiActionId(rawActionId);
    if (!actionId) return false;
    const action = WRITING_ACTION_MAP[actionId];
    const kernel = deps.getKernel();
    if (!action || !kernel) return false;

    // 无目标文本且为整块/选区目标时不触发（空白选区）。
    if (ctx.target !== 'cursor' && ctx.text.trim().length === 0) return false;

    const { markdown, backlinks } = deps.getContext();
    const assembly = assembleWritingContext({
      target: ctx.text,
      document: markdown,
      backlinks,
      budgetChars: deps.budgetChars,
    });

    return beginWritingSession({
      action,
      request: { actionId, target: ctx.text, contextText: assembly.contextBlock },
      original: action.kind === 'replace' ? ctx.text : '',
      coords: ctx.coords,
      truncated: assembly.truncated,
      note: assembly.note,
      apply: (generated) => {
        const k = deps.getKernel();
        if (!k) return;
        if (action.kind === 'replace' && ctx.target !== 'cursor') {
          // 替换类：原地替换选区/整块（单事务）
          k.replaceRangeWithMarkdown(ctx.from, ctx.to, generated);
        } else if (ctx.target === 'cursor') {
          // 快捷插入的核心语义：流式结果最终在光标处插入，不替换正文。
          k.editor.view.dispatch(
            k.editor.state.tr.insertText(generated, ctx.from).scrollIntoView(),
          );
        } else {
          // 追加类：在当前块之后插入新块（单事务）
          const pos = ctx.blockRange?.to ?? ctx.to;
          k.insertMarkdownBlocks(generated, pos, 'after');
        }
      },
    });
  };

  const triggerSlash: WritingController['triggerSlash'] = (rawActionId, ctx, afterSlashCommit) => {
    const actionId = fromAiActionId(rawActionId);
    const kernel = deps.getKernel();
    if (!actionId || !kernel || kernel.editor.view !== ctx.view || kernel.editor.isDestroyed)
      return false;
    const action = WRITING_ACTION_MAP[actionId];
    const activeAtStart = getActiveEditor();
    const pageAtStart = deps.getPageId?.();
    if (activeAtStart && activeAtStart !== kernel) return false;
    const samePage = () => deps.getPageId?.() === pageAtStart;
    let valid = true;
    // Permanently invalidate, including edit-then-undo, silent reload, and switch-away/back.
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) valid = false;
    };
    const unsubscribe = subscribeActiveEditor(() => {
      valid = false;
    });
    const cleanup = () => {
      valid = false;
      kernel.editor.off('transaction', onTransaction);
      unsubscribe();
    };
    let anchor: { kernel: EditorKernelInstance; pos: number; revision: number } | null = null;
    afterSlashCommit(() => {
      if (
        !valid ||
        deps.getKernel() !== kernel ||
        kernel.editor.isDestroyed ||
        getActiveEditor() !== activeAtStart ||
        !samePage()
      )
        return;
      anchor = {
        kernel,
        pos: kernel.editor.state.selection.from,
        revision: kernel.getRevision(),
      };
      kernel.editor.on('transaction', onTransaction);
    });
    const { markdown, backlinks } = deps.getContext();
    const assembly = assembleWritingContext({
      target: ctx.text,
      document: markdown,
      backlinks,
      budgetChars: deps.budgetChars,
    });
    const started = beginWritingSession({
      action,
      request: { actionId: action.id, target: ctx.text, contextText: assembly.contextBlock },
      original: '',
      coords: ctx.coords,
      truncated: assembly.truncated,
      note: assembly.note,
      onClose: cleanup,
      apply: (generated) => {
        // A later document change, unmount, or active-page switch invalidates the captured
        // cursor rather than remapping a stale absolute position into another place/page.
        if (
          !valid ||
          !anchor ||
          deps.getKernel() !== anchor.kernel ||
          anchor.kernel.editor.isDestroyed ||
          getActiveEditor() !== activeAtStart ||
          !samePage() ||
          anchor.kernel.getRevision() !== anchor.revision
        )
          return;
        anchor.kernel.editor.view.dispatch(
          closeHistory(
            anchor.kernel.editor.view.state.tr.insertText(generated, anchor.pos).scrollIntoView(),
          ),
        );
      },
    });
    return started.then((success) => {
      if (!success) cleanup();
      return (
        success && valid && samePage() && deps.getKernel() === kernel && !kernel.editor.isDestroyed
      );
    });
  };

  return { trigger, triggerSlash };
}
