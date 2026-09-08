import { buildKernelExtensions, createMarkdownManager, parseMarkdown } from '@nexnote/kernel';

let manager: ReturnType<typeof createMarkdownManager> | null = null;

/** 切回块编辑模式前执行整页解析；普通未闭合 Markdown 仍由 parser 宽容接受。 */
export function parseWholePage(markdown: string): { ok: true } | { ok: false; message: string } {
  try {
    manager ??= createMarkdownManager(buildKernelExtensions({}));
    parseMarkdown(manager, markdown);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
