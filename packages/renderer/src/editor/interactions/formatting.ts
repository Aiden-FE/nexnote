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
/** 双链（[[页面名]]）：与外链（FORMAT_LINK，外部 URL）互不混淆的独立动作。 */
export const FORMAT_WIKILINK = 'format:wikilink';

/** 链接动作的 URL 输入提示语（块编辑与源码模式共用同一交互）。 */
export const LINK_URL_PROMPT = '链接地址（http(s):// 或 obsidian:// 或相对页面路径）：';

export function formatBubbleActions(): BubbleAction[] {
  return [
    {
      id: FORMAT_BOLD,
      title: 'B',
      hint: '粗体',
      shortcut: { mod: true, key: 'b' },
      shortcutLabel: '⌘B',
    },
    {
      id: FORMAT_ITALIC,
      title: 'I',
      hint: '斜体',
      shortcut: { mod: true, key: 'i' },
      shortcutLabel: '⌘I',
    },
    {
      id: FORMAT_STRIKE,
      title: 'S',
      hint: '删除线',
      shortcut: { mod: true, shift: true, key: 'x' },
      shortcutLabel: '⌘⇧X',
    },
    {
      id: FORMAT_CODE,
      title: '`</>',
      hint: '行内代码',
      shortcut: { mod: true, key: 'e' },
      shortcutLabel: '⌘E',
    },
    {
      id: FORMAT_LINK,
      title: '🔗',
      hint: '链接（外部 URL）',
      shortcut: { mod: true, key: 'k' },
      shortcutLabel: '⌘K',
    },
    { id: FORMAT_WIKILINK, title: '[[]]', hint: '双链（内部页面 [[页面名]]）' },
  ];
}

/**
 * 在编辑器选区上执行格式化动作；返回是否命中格式化 id。
 *
 * 工具栏入口传 `allowEmptySelection`：无选区时对光标处设置存储 mark（继续输入
 * 即生效）；划词 bubble 不传，保持「无选区不动作」的原语义。
 */
export function runFormatAction(
  id: string,
  kernel: EditorKernelInstance | null,
  selectionText: string,
  options?: { allowEmptySelection?: boolean },
): boolean {
  if (!kernel) return false;
  const editor = kernel.editor;

  // 双链（DEV-023）：有选区经内核 wikilink 节点插入 [[选区]]；
  // 无选区插入 `[[` 骨架，交由内核 [[ 补全菜单确认目标页面。
  if (id === FORMAT_WIKILINK) {
    const target = selectionText.trim();
    if (target) {
      void editor.chain().focus().insertWikilink({ target }).run();
    } else {
      void editor.chain().focus().insertContent('[[').run();
    }
    return true;
  }

  if (!selectionText.trim() && !options?.allowEmptySelection) return false;
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
      const href = window.prompt(LINK_URL_PROMPT);
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
