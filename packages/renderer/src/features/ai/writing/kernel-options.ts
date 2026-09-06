import { computeEditorActionContext } from '@nexnote/kernel';
import type { BubbleAction, ContextMenuItem, SlashMenuItem } from '@nexnote/kernel';
import { toAiActionId, WRITING_ACTIONS } from './actions';
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
  return WRITING_ACTIONS.map((action) => ({
    id: `ai-${action.id}`,
    title: `AI · ${action.label}`,
    hint: '/ai',
    keywords: ['ai', '✨', ...action.keywords],
    action: ({ view }) => {
      const target = view.state.selection.empty ? 'cursor' : 'selection';
      const ctx = computeEditorActionContext(view, target);
      controller.trigger(toAiActionId(action.id), ctx);
      return true;
    },
  }));
}
