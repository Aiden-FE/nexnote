import { invoke } from './ipc';
import { openDocx, openPage, getTabStore } from '../stores/tab-store';

/**
 * 统一文档打开入口：所有导航（搜索/面板/图谱/反链/AI 来源/编辑器内链接/页面树）
 * 都经此函数，保证：
 * - `.docx` 打开只读预览 tab；
 * - sidecar 持久格式为 markdown 的文档默认进入源码模式（重开也保持）。
 */
export async function openDocumentTab(
  pagePath: string,
  title?: string,
): Promise<{ kind: 'page' | 'docx'; editorMode?: 'source' }> {
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
  const tab = openPage(pagePath, title);
  if (metadata?.format === 'markdown') {
    getTabStore().getState().toggleSourceMode(tab.id, true);
    return { kind: 'page', editorMode: 'source' };
  }
  return { kind: 'page' };
}
