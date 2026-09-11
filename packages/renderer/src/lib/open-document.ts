import { invoke } from './ipc';
import { openDocx, openPage, getTabStore, type DocumentFormat } from '../stores/tab-store';

/**
 * 统一文档打开入口：所有导航（搜索/面板/图谱/反链/AI 来源/编辑器内链接/页面树）
 * 都经此函数，保证：
 * - `.docx` 打开只读预览 tab；
 * - sidecar 持久格式为 markdown 的文档使用源码编辑器（预览由该视图管理）；
 * - legacy 无 sidecar 文档默认按 native-block 兼容打开。
 */
export async function openDocumentTab(
  pagePath: string,
  title?: string,
): Promise<{ kind: 'page' | 'docx'; format?: DocumentFormat }> {
  if (/\.(docx)$/i.test(pagePath)) {
    openDocx(pagePath, title);
    return { kind: 'docx' };
  }
  // sidecar 是尽力而为：读取失败（无 bridge/无 vault/损坏）时按默认块编辑打开，不让导航中断。
  let metadata: { format?: string } | null = null;
  try {
    metadata = await invoke('document:getMetadata', { path: pagePath });
  } catch {
    metadata = null;
  }
  const format: DocumentFormat = metadata?.format === 'markdown' ? 'markdown' : 'native-block';
  const tab = openPage(pagePath, title);
  getTabStore().getState().updateTab(tab.id, {
    format,
    // Markdown's only mode is source editor; initialize it explicitly.
    editorMode: format === 'markdown' ? 'source' : 'block',
  });
  return { kind: 'page', format };
}
