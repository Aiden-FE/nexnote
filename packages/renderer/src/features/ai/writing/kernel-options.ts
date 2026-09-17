import { computeEditorActionContext } from '@nexnote/kernel';
import type { BubbleAction, ContextMenuItem, SlashMenuItem } from '@nexnote/kernel';
import { toAiActionId, WRITING_ACTIONS } from './actions';
import { CHAT_ASK_ACTION } from '../chat/ask-ai';
import { TRANSLATE_SELECTION_ACTION_ID } from '../translation/actions';
import type { WritingController } from './controller';

/** 选区浮动工具栏的六个动作（含 ⌘⌥ 快捷键）。 */
export function writingBubbleActions(): BubbleAction[] {
  return WRITING_ACTIONS.map((action) => ({
    id: toAiActionId(action.id),
    title: action.label,
    shortcut: { mod: true, alt: true, key: action.modKey },
    shortcutLabel: `⌘⌥${action.modKey.toUpperCase()}`,
  }));
}

/**
 * DEV-034：划词工具栏 AI 下拉的完整动作集（六写作动作 + 询问 AI）。
 * DEV-041：追加划词翻译（只读浮层，无写回路径）。
 * 块编辑与源码模式共用同一函数，按钮集与顺序天然一致。
 */
export function writingAiMenuActions(): BubbleAction[] {
  return [
    ...writingBubbleActions(),
    { id: CHAT_ASK_ACTION, title: '询问 AI' },
    { id: TRANSLATE_SELECTION_ACTION_ID, title: '翻译' },
  ];
}

/** 右键菜单：AI 写作子菜单（选区作用于选区，折叠/块作用于整块）。 */
export function writingContextMenu(ctx: { target: string }): ContextMenuItem[] {
  const scope = ctx.target === 'selection' ? '选区' : '本块';
  return [
    {
      title: `✨ AI 写作（${scope}）`,
      submenu: WRITING_ACTIONS.map((action) => ({
        id: toAiActionId(action.id),
        title: action.label,
      })),
    },
  ];
}

/** 斜杠 `/ai` 项：空块基于上文生成，选区作用于选区。 */
export function writingSlashItems(controller: WritingController): SlashMenuItem[] {
  const aiInsert: SlashMenuItem = {
    id: 'ai-insert',
    title: 'AI 插入',
    hint: '指令…',
    group: 'AI',
    kind: 'ai',
    keywords: ['ai', 'insert', 'prompt', '生成', '插入'],
    action: ({ view }) => {
      const instruction = window.prompt('AI 插入指令', '请基于当前上下文补充内容');
      if (!instruction?.trim()) return false;
      const editorContext = computeEditorActionContext(view, 'cursor');
      // expand 是“在光标处追加”的既有白名单动作；指令作为目标传入，正文不会被替换。
      controller.trigger(toAiActionId('expand'), {
        ...editorContext,
        text: instruction.trim(),
        target: 'cursor',
      });
      return true;
    },
  };
  return [
    aiInsert,
    ...WRITING_ACTIONS.map((action): SlashMenuItem => ({
      id: `ai-${action.id}`,
      title: `AI · ${action.label}`,
      hint: '/ai',
      group: 'AI',
      kind: 'ai',
      keywords: ['ai', '✨', ...action.keywords],
      action: ({ view }) => {
        const target = view.state.selection.empty ? 'cursor' : 'selection';
        const editorContext = computeEditorActionContext(view, target);
        controller.trigger(toAiActionId(action.id), editorContext);
        return true;
      },
    })),
  ];
}
