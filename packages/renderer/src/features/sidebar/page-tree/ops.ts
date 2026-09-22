import { sanitizeEntryName } from '@nexnote/shared';
import type { DirEntry } from '@nexnote/shared';
import { invoke } from '../../../lib/ipc';
import { openDocumentTab } from '../../../lib/open-document';
import { requestAppSave } from '../../../editor/app-save';
import { getTabStore } from '../../../stores/tab-store';
import { usePageTreeStore } from '../../../stores/page-tree-store';
import { displayName, isMarkdown } from '../../../page-tree/tree-utils';

/**
 * 页面树操作（DEV-003）：全部经主进程 IPC；文件系统变化由 chokidar 事件回流刷新树。
 * tab 联动（重命名 retarget / 删除关闭）在操作成功后执行。
 */

/** 新建笔记的产品格式概念（同 document-domain）：两种格式落盘都是纯标准 Markdown，仅打开模式不同。 */
export type NewNoteFormat = 'native-block' | 'markdown';

/**
 * 新建笔记并打开：native-block（默认）进入块编辑；markdown 进入源码编辑器
 * （模式语义是格式的一部分，持久于 tab 生命周期，ADR-0004）。
 */
export async function createNoteIn(
  parentDir: string,
  format: NewNoteFormat = 'native-block',
): Promise<string> {
  const info = await invoke('fs:createNote', { parentDir, format });
  await openDocumentTab(info.path, displayName({ name: info.name, kind: 'file' }), {
    knownFormat: format,
  });
  return info.path;
}

/** 按 sidecar 中的持久格式打开页面；统一委托 openDocumentTab，避免第二套路由。 */
export async function openDocument(path: string, knownFormat?: NewNoteFormat): Promise<string> {
  await openDocumentTab(path, undefined, knownFormat ? { knownFormat } : undefined);
  return path;
}

/** 经主进程文件选择器导入 DOCX，成功后打开可编辑 tab；取消选择返回 null。 */
export async function importDocxIn(targetDir = ''): Promise<string | null> {
  const result = await invoke('docx:import', { targetDir });
  if (!result) return null;
  await openDocumentTab(result.path);
  return result.path;
}

/** DEV-074：导入 vault 外 .xlsx / .xmind 为仓库内副本，成功后打开对应编辑器 tab。 */
export async function importBinaryIn(
  kind: 'xlsx' | 'mindmap',
  targetDir = '',
): Promise<string | null> {
  const result = await invoke('binary:import', { kind, targetDir });
  if (!result) return null;
  await openDocumentTab(result.path);
  return result.path;
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
  const markdownExtension = fromPath.toLowerCase().endsWith('.markdown') ? '.markdown' : '.md';
  if (kind === 'file' && isMarkdown(fromPath) && !isMarkdown(name))
    name = `${name}${markdownExtension}`;
  const sanitized = sanitizeEntryName(
    kind === 'file' ? name.replace(/\.(?:md|markdown)$/i, '') : name,
  );
  if (!sanitized.ok) throw new Error(sanitized.reason);
  const finalName =
    kind === 'file' && isMarkdown(fromPath)
      ? `${sanitized.value}${markdownExtension}`
      : sanitized.value;
  const parent = fromPath.slice(0, Math.max(0, fromPath.lastIndexOf('/')));
  const toPath = parent.length === 0 ? finalName : `${parent}/${finalName}`;
  if (toPath === fromPath) return;
  await requestAppSave(window);
  const format = usePageTreeStore.getState().entries.find((e) => e.path === fromPath)?.format;
  await invoke('fs:renameLinked', { from: fromPath, to: toPath });
  const tree = usePageTreeStore.getState();
  tree.applyEvent({ kind: kind === 'directory' ? 'unlinkDir' : 'unlink', path: fromPath });
  tree.applyEvent({ kind: kind === 'directory' ? 'addDir' : 'add', path: toPath, format });
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
  const sourceEntry = usePageTreeStore.getState().entries.find((entry) => entry.path === fromPath);
  const format = sourceEntry?.format;
  await invoke('fs:renameLinked', { from: fromPath, to: toPath });
  const kind = sourceEntry?.kind ?? 'file';
  const tree = usePageTreeStore.getState();
  tree.applyEvent({ kind: kind === 'directory' ? 'unlinkDir' : 'unlink', path: fromPath });
  tree.applyEvent({ kind: kind === 'directory' ? 'addDir' : 'add', path: toPath, format });
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
