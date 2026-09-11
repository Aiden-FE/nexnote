import { invoke } from '../../lib/ipc';
import { openDocumentTab } from '../../lib/open-document';
import { usePageTreeStore } from '../../stores/page-tree-store';
import { sanitizePageTitle, titleFromPath } from '../../editor/title-sync';

/** 新建 Markdown 页面（空 vault 可直接从命令面板创建并进入编辑器）。 */
export async function createPage(title = '未命名页面') {
  const safe = sanitizePageTitle(title);
  let path = `${safe}.md`;
  let seq = 2;
  while (await invoke('fs:exists', { path })) {
    path = `${safe} ${seq}.md`;
    seq += 1;
  }
  const actualTitle = titleFromPath(path);
  await invoke('fs:writeTextFile', {
    path,
    content: `# ${actualTitle}\n\n`,
    createParentDirs: true,
  });
  // 应用自身已确认写入成功：立即更新树，避免依赖异步 watcher 回流造成可见滞后。
  usePageTreeStore.getState().applyEvent({ kind: 'add', path });
  await openDocumentTab(path, actualTitle);
  return path;
}
