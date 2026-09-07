import type { BubbleAction } from '@nexnote/kernel';
import type { EditorKernelInstance } from '@nexnote/kernel';

/**
 * DEV-017 选区悬浮工具栏：正文格式化按钮（粗体/斜体/删除线/行内代码/链接）。
 * AI 按钮由 DEV-010 注入；本模块只承担格式化，onAction 分发到内核 TipTap 命令。
 */

export const FORMAT_BOLD = 'format:bold';
export const FORMAT_ITALIC = 'format:italic';
export const FORMAT_STRIKE = 'format:strike';
export const FORMAT_CODE = 'format:code';
export const FORMAT_LINK = 'format:link';

export function formatBubbleActions(): BubbleAction[] {
  return [
    { id: FORMAT_BOLD, title: 'B', hint: '粗体', shortcut: { mod: true, key: 'b' }, shortcutLabel: '⌘B' },
    { id: FORMAT_ITALIC, title: 'I', hint: '斜体', shortcut: { mod: true, key: 'i' }, shortcutLabel: '⌘I' },
    { id: FORMAT_STRIKE, title: 'S', hint: '删除线', shortcut: { mod: true, shift: true, key: 'x' }, shortcutLabel: '⌘⇧X' },
    { id: FORMAT_CODE, title: '`</>', hint: '行内代码', shortcut: { mod: true, key: 'e' }, shortcutLabel: '⌘E' },
    { id: FORMAT_LINK, title: '🔗', hint: '链接', shortcut: { mod: true, key: 'k' }, shortcutLabel: '⌘K' },
  ];
}

/** 在编辑器选区上执行格式化动作；返回是否命中格式化 id。 */
export function runFormatAction(
  id: string,
  kernel: EditorKernelInstance | null,
  selectionText: string,
): boolean {
  if (!kernel || !selectionText.trim()) return false;
  const editor = kernel.editor;
  const chain = editor.chain().focus();
  switch (id) {
    case FORMAT_BOLD:
      chain.toggleBold();
      break;
    case FORMAT_ITALIC:
      chain.toggleItalic();
      break;
    case FORMAT_STRIKE:
      chain.toggleStrike();
      break;
    case FORMAT_CODE:
      chain.toggleCode();
      break;
    case FORMAT_LINK: {
      const href = window.prompt('链接地址（http(s):// 或 obsidian:// 或相对页面路径）：');
      if (!href) return true;
      chain.setLink({ href });
      break;
    }
    default:
      return false;
  }
  void chain.run();
  return true;
}
