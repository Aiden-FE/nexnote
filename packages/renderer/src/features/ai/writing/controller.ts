import type { EditorActionContext, EditorKernelInstance } from '@nexnote/kernel';
import { fromAiActionId, WRITING_ACTION_MAP } from './actions';
import { assembleWritingContext, type BacklinkSnippet } from './context';
import { beginWritingSession } from './session';

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
  /** 上下文字符预算（测试可注入）。 */
  budgetChars?: number;
}

export interface WritingController {
  trigger: (rawActionId: string, ctx: EditorActionContext) => void;
}

export function createWritingController(deps: WritingControllerDeps): WritingController {
  const trigger = (rawActionId: string, ctx: EditorActionContext) => {
    const actionId = fromAiActionId(rawActionId);
    if (!actionId) return;
    const action = WRITING_ACTION_MAP[actionId];
    const kernel = deps.getKernel();
    if (!action || !kernel) return;

    // 无目标文本且为整块/选区目标时不触发（空白选区）。
    if (ctx.target !== 'cursor' && ctx.text.trim().length === 0) return;

    const { markdown, backlinks } = deps.getContext();
    const assembly = assembleWritingContext({
      target: ctx.text,
      document: markdown,
      backlinks,
      budgetChars: deps.budgetChars,
    });

    beginWritingSession({
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
        } else if (ctx.target === 'cursor' && ctx.blockRange) {
          // 斜杠在空块触发：用生成内容填充该空块（斜杠菜单仅空块可开）
          k.replaceRangeWithMarkdown(ctx.blockRange.from, ctx.blockRange.to, generated);
        } else {
          // 追加类：在当前块之后插入新块（单事务）
          const pos = ctx.blockRange?.to ?? ctx.to;
          k.insertMarkdownBlocks(generated, pos, 'after');
        }
      },
    });
  };

  return { trigger };
}
