import { useTabStore } from '../stores/tab-store';
import { getEditorForTab } from '../editor/active-editor';
import { getSourceEditorForTab } from '../editor/source/active-source-editor';
import { t } from '../lib/i18n';
import { printDocument, renderMarkdownForPrint } from './print-document';

/**
 * 当前文档打印入口：根据活动 tab 的持久格式选择数据源。
 *
 * - markdown 文档：取 CodeMirror 当前正文（不含 YAML frontmatter），
 *   用与 LivePreview 同源的内核渲染成打印 HTML；
 * - native-block 文档：直接取块编辑器当前渲染 DOM。
 * 两种文档都走主进程隐藏打印窗口，打印语义一致。
 */
export async function printActiveDocument(): Promise<void> {
  const state = useTabStore.getState();
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId) ?? null;
  if (!tab || tab.kind !== 'page') return;
  try {
    if (tab.format === 'markdown') {
      const editor = getSourceEditorForTab(tab.id);
      if (!editor) throw new Error(t('print.error.unsupported'));
      const markdown = editor.view.state.doc.toString();
      const content = await renderMarkdownForPrint(markdown);
      await printDocument({ title: tab.title, content });
      return;
    }
    const kernel = getEditorForTab(tab.id);
    if (!kernel) throw new Error(t('print.error.unsupported'));
    await printDocument({ title: tab.title, content: kernel.editor.view.dom });
  } catch (error) {
    console.error('[print] printActiveDocument failed', error);
    const message = error instanceof Error ? error.message : String(error);
    window.alert(t('print.error.failed', { message }));
  }
}
