import type { BubbleAction } from '@nexnote/kernel';
import { editorActionsForMode, type EditorActionDefinition } from './entries';

function shortcutFromModel(shortcut: string | undefined): BubbleAction['shortcut'] {
  if (!shortcut) return undefined;
  const normalized = shortcut.replace('⌘', '').replace('⇧', '').replace('⌥', '');
  const key = normalized.at(-1)?.toLowerCase();
  if (!key) return undefined;
  return {
    mod: shortcut.includes('⌘'),
    alt: shortcut.includes('⌥'),
    shift: shortcut.includes('⇧'),
    key,
  };
}

function toBubbleAction(action: EditorActionDefinition): BubbleAction {
  return {
    id: action.id,
    title: action.label,
    hint: action.hint,
    icon: action.selectionIcon,
    shortcut: shortcutFromModel(action.shortcut),
    shortcutLabel: action.shortcut,
  };
}

/** DEV-050 action model is the sole source of selection label/icon/shortcut/order metadata. */
export function selectionFormatBubbleActions(): BubbleAction[] {
  return editorActionsForMode('block')
    .filter((action) => action.selectionIcon && action.selectionOrder !== undefined)
    .sort((left, right) => left.selectionOrder! - right.selectionOrder!)
    .map(toBubbleAction);
}
