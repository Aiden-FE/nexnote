import { computeEditorActionContext } from '@nexnote/kernel';
import { editorActionCatalogEntry } from '@nexnote/shared';
import type { BubbleAction, ContextMenuItem, SlashMenuItem } from '@nexnote/kernel';
import { t } from '../../../lib/i18n';
import { toAiActionId, WRITING_ACTIONS } from './actions';
import { CHAT_ASK_ACTION } from '../chat/ask-ai';
import {
  OPEN_TRANSLATION_WORKBENCH_ID,
  TRANSLATE_SELECTION_ACTION_ID,
} from '../translation/actions';
import type { WritingController } from './controller';

/** 选区浮动工具栏的六个动作（含 ⌘⌥ 快捷键）。 */
export function writingBubbleActions(): BubbleAction[] {
  return WRITING_ACTIONS.map((action) => ({
    id: toAiActionId(action.id),
    titleKey: `bubble.aiMenu.${toAiActionId(action.id)}`,
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
    {
      id: CHAT_ASK_ACTION,
      titleKey: `bubble.aiMenu.${CHAT_ASK_ACTION}`,
    },
    {
      id: TRANSLATE_SELECTION_ACTION_ID,
      titleKey: `bubble.aiMenu.${TRANSLATE_SELECTION_ACTION_ID}`,
    },
    {
      id: OPEN_TRANSLATION_WORKBENCH_ID,
      titleKey: `bubble.aiMenu.${OPEN_TRANSLATION_WORKBENCH_ID}`,
    },
  ];
}

/** 右键菜单：AI 写作子菜单（选区作用于选区，折叠/块作用于整块）。 */
export function writingContextMenu(ctx: { target: string }): ContextMenuItem[] {
  // 右键菜单在内核打开时才 build：用命令式 t() 保证每次打开按当前语言成文。
  const scope = t(
    ctx.target === 'selection' ? 'ai.contextMenu.scopeSelection' : 'ai.contextMenu.scopeBlock',
  );
  return [
    {
      titleText: t('ai.contextMenu.title', { scope }),
      submenu: WRITING_ACTIONS.map((action) => ({
        id: toAiActionId(action.id),
        titleKey: `bubble.aiMenu.${toAiActionId(action.id)}`,
      })),
    },
  ];
}

/** 斜杠 `/ai` 项：空块基于上文生成，选区作用于选区。 */
export function writingSlashItems(controller: WritingController): SlashMenuItem[] {
  const canonical = editorActionCatalogEntry('ai:insert');
  if (!canonical?.quickInsert) throw new Error('Missing canonical AI insert action');
  const aiInsert: SlashMenuItem = {
    id: canonical.id,
    titleKey: canonical.nameKey,
    hintKey: canonical.hintKey,
    icon: canonical.icon,
    group: canonical.quickInsert.group,
    kind: canonical.quickInsert.kind,
    contract: {
      execution: canonical.quickInsert.execution,
      capability: canonical.quickInsert.capability,
    },
    keywords: [...canonical.quickInsert.aliases],
    action: ({ view, afterSlashCommit }) => {
      const instruction = window.prompt(
        t('source.slash.aiPrompt'),
        t('source.slash.aiPromptDefault'),
      );
      if (!instruction?.trim()) return false;
      return controller.triggerSlash(
        'ai:expand',
        { ...computeEditorActionContext(view, 'cursor'), text: instruction.trim() },
        afterSlashCommit,
      );
    },
  };
  return [
    aiInsert,
    ...WRITING_ACTIONS.map((action): SlashMenuItem => ({
      id: `ai-${action.id}`,
      titleKey: `editorAction.ai.writing:${action.id}.name`,
      hintKey: 'editorAction.ai.writing.slashHint',
      icon: 'sparkles',
      group: 'ai',
      kind: 'ai',
      contract: { execution: 'explicit-ai', capability: 'explicit-ai' },
      keywords: ['ai', '✨', ...action.keywords],
      action: ({ view, afterSlashCommit }) =>
        controller.triggerSlash(
          toAiActionId(action.id),
          computeEditorActionContext(view, 'cursor'),
          afterSlashCommit,
        ),
    })),
  ];
}
