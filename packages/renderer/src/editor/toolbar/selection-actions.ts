import type { BubbleAction, BubbleIconName } from '@nexnote/kernel';
import { editorAction } from './entries';
import {
  FORMAT_BOLD,
  FORMAT_CODE,
  FORMAT_ITALIC,
  FORMAT_LINK,
  FORMAT_STRIKE,
  FORMAT_WIKILINK,
} from '../interactions/format-ids';

/**
 * DEV-051 划词工具栏对 DEV-050 唯一动作模型的投影。
 * 两种编辑器消费同一 BubbleAction 数组，避免名称、图标、快捷键及顺序漂移。
 */
const SELECTION_ACTIONS: Array<{
  id: string;
  icon: BubbleIconName;
  shortcut?: BubbleAction['shortcut'];
}> = [
  { id: FORMAT_BOLD, icon: 'bold', shortcut: { mod: true, key: 'b' } },
  { id: FORMAT_ITALIC, icon: 'italic', shortcut: { mod: true, key: 'i' } },
  { id: FORMAT_STRIKE, icon: 'strike', shortcut: { mod: true, shift: true, key: 'x' } },
  { id: FORMAT_CODE, icon: 'code', shortcut: { mod: true, key: 'e' } },
  { id: FORMAT_LINK, icon: 'link', shortcut: { mod: true, key: 'k' } },
  { id: FORMAT_WIKILINK, icon: 'wikilink' },
];

export function selectionFormatBubbleActions(): BubbleAction[] {
  return SELECTION_ACTIONS.map(({ id, icon, shortcut }) => {
    const action = editorAction(id);
    return {
      id,
      title: action.label,
      hint: action.hint,
      icon,
      shortcut,
      shortcutLabel: action.shortcut,
    };
  });
}
