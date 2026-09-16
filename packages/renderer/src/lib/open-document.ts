import { invoke } from './ipc';
import {
  openDocx,
  openPage,
  getTabStore,
  type DocumentFormat,
  type MarkdownView,
} from '../stores/tab-store';

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
  options?: { knownFormat?: DocumentFormat; initialMarkdownView?: MarkdownView },
): Promise<{ kind: 'page' | 'docx'; format?: DocumentFormat }> {
  if (/\.(docx)$/i.test(pagePath)) {
    openDocx(pagePath, title);
    return { kind: 'docx' };
  }
  // 创建路径可用 knownFormat 跳过 sidecar 查询，避免“先默认后补格式”的第二套路由窗口。
  let format: DocumentFormat = options?.knownFormat ?? 'native-block';
  if (!options?.knownFormat) {
    // sidecar 是尽力而为：读取失败（无 bridge/无 vault/损坏）时按默认块编辑打开，不让导航中断。
    let metadata: { format?: string } | null = null;
    try {
      metadata = await invoke('document:getMetadata', { path: pagePath });
    } catch {
      metadata = null;
    }
    format = metadata?.format === 'markdown' ? 'markdown' : 'native-block';
  }
  const existing = getTabStore()
    .getState()
    .tabs.find((candidate) => candidate.kind === 'page' && candidate.pagePath === pagePath);
  const tab = openPage(pagePath, title);
  const state = getTabStore().getState();
  if (existing) {
    // 已打开的 tab 只刷新路由元数据，保留其 Markdown 视图（如预览视图内导航）。
    state.updateTab(tab.id, {
      format,
      editorMode: format === 'markdown' ? 'source' : 'block',
    });
    return { kind: 'page', format };
  }
  state.updateTab(tab.id, {
    format,
    // Markdown uses its own three-view model; new tabs start in split view unless
    // the navigation source asks to keep the preview view.
    editorMode: format === 'markdown' ? 'source' : 'block',
    ...(format === 'markdown'
      ? {
          markdownView: (options?.initialMarkdownView ?? 'split') as MarkdownView,
          splitRatio: 0.5,
        }
      : {}),
  });
  return { kind: 'page', format };
}
