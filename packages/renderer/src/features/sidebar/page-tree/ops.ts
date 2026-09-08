import { sanitizeEntryName } from '@nexnote/shared';
import type { DirEntry } from '@nexnote/shared';
import { invoke } from '../../../lib/ipc';
import { requestAppSave } from '../../../editor/app-save';
import { getTabStore, openPageInActivePane } from '../../../stores/tab-store';
import { usePageTreeStore } from '../../../stores/page-tree-store';
import { displayName, isMarkdown } from '../../../page-tree/tree-utils';

/**
 * 页面树操作（DEV-003）：全部经主进程 IPC；文件系统变化由 chokidar 事件回流刷新树。
 * tab 联动（重命名 retarget / 删除关闭）在操作成功后执行。
 */

export async function createNoteIn(parentDir: string): Promise<string> {
  const info = await invoke('fs:createNote', { parentDir });
  openPageInActivePane(info.path, displayName({ name: info.name, kind: 'file' }));
  return info.path;
}

/** 在 parentDir 下创建不重名的文件夹，返回最终路径。 */
export async function createFolderIn(parentDir: string, existing: DirEntry[]): Promise<string> {
  const siblings = new Set(
    existing
      .filter((e) =>
        parentDir === '' ? !e.path.includes('/') : e.path.startsWith(`${parentDir}/`),
      )
      .map((e) => e.name),
  );
  let name = '新建文件夹';
  for (let i = 2; siblings.has(name); i += 1) name = `新建文件夹 ${i}`;
  const path = parentDir === '' ? name : `${parentDir}/${name}`;
  await invoke('fs:mkdir', { path, recursive: false });
  usePageTreeStore.getState().applyEvent({ kind: 'addDir', path });
  return path;
}

/** 重命名/移动（同 vault）。newName 不带路径；自动补 .md。 */
export async function renameEntry(
  fromPath: string,
  kind: 'file' | 'directory',
  newNameRaw: string,
): Promise<void> {
  let name = newNameRaw.trim();
  if (name.length === 0) return;
  if (kind === 'file' && isMarkdown(fromPath) && !isMarkdown(name)) name = `${name}.md`;
  const sanitized = sanitizeEntryName(kind === 'file' ? name.replace(/\.md$/i, '') : name);
  if (!sanitized.ok) throw new Error(sanitized.reason);
  const finalName =
    kind === 'file' && isMarkdown(fromPath) ? `${sanitized.value}.md` : sanitized.value;
  const parent = fromPath.slice(0, Math.max(0, fromPath.lastIndexOf('/')));
  const toPath = parent.length === 0 ? finalName : `${parent}/${finalName}`;
  if (toPath === fromPath) return;
  await requestAppSave(window);
  await invoke('fs:renameLinked', { from: fromPath, to: toPath });
  const tree = usePageTreeStore.getState();
  tree.applyEvent({ kind: kind === 'directory' ? 'unlinkDir' : 'unlink', path: fromPath });
  tree.applyEvent({ kind: kind === 'directory' ? 'addDir' : 'add', path: toPath });
  getTabStore().getState().retargetTabs(fromPath, toPath, sanitized.value);
}

/** 拖拽移动：from → 目标目录 targetDir（'' = 根）。 */
export async function moveEntry(fromPath: string, targetDir: string): Promise<void> {
  const name = fromPath.slice(fromPath.lastIndexOf('/') + 1);
  const toPath = targetDir === '' ? name : `${targetDir}/${name}`;
  if (toPath === fromPath) return;
  if (targetDir === fromPath || targetDir.startsWith(`${fromPath}/`)) {
    throw new Error('不能移动到自身或其子目录内');
  }
  await requestAppSave(window);
  await invoke('fs:renameLinked', { from: fromPath, to: toPath });
  const kind =
    usePageTreeStore.getState().entries.find((entry) => entry.path === fromPath)?.kind ?? 'file';
  const tree = usePageTreeStore.getState();
  tree.applyEvent({ kind: kind === 'directory' ? 'unlinkDir' : 'unlink', path: fromPath });
  tree.applyEvent({ kind: kind === 'directory' ? 'addDir' : 'add', path: toPath });
  const stem = name.replace(/\.md$/i, '');
  getTabStore().getState().retargetTabs(fromPath, toPath, stem);
}

/** 删除（优先系统回收站；不可用时主进程回退 .trash/）。返回是否执行。 */
export async function deleteEntry(path: string, name: string): Promise<boolean> {
  const ok = window.confirm(`删除「${name}」？\n将移入系统回收站（不可用时移入 .trash/）。`);
  if (!ok) return false;
  await requestAppSave(window);
  await invoke('fs:delete', { path, toTrash: true });
  const kind =
    usePageTreeStore.getState().entries.find((entry) => entry.path === path)?.kind ?? 'file';
  usePageTreeStore
    .getState()
    .applyEvent({ kind: kind === 'directory' ? 'unlinkDir' : 'unlink', path });
  getTabStore().getState().closeTabsForPath(path);
  return true;
}

export async function revealInFinder(path: string): Promise<void> {
  await invoke('fs:revealInFinder', { path });
}
