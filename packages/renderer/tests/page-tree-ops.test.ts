// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { createPage } from '../src/features/editor/create-page';
import {
  createFolderIn,
  deleteEntry,
  moveEntry,
  renameEntry,
} from '../src/features/sidebar/page-tree/ops';
import { usePageTreeStore } from '../src/stores/page-tree-store';
import { useTabStore } from '../src/stores/tab-store';

type Handler = (payload: Record<string, unknown>) => unknown;

function installBridge(handlers: Record<string, Handler>): void {
  (
    window as unknown as {
      nexnote: {
        invoke(channel: string, payload: Record<string, unknown>): Promise<unknown>;
        on(): () => void;
      };
    }
  ).nexnote = {
    async invoke(channel, payload) {
      const handler = handlers[channel];
      if (!handler) throw new Error(`unexpected IPC channel: ${channel}`);
      return { ok: true, data: handler(payload) };
    },
    on() {
      return () => undefined;
    },
  };
}

function resetStores(): void {
  usePageTreeStore.setState({
    entries: [],
    status: 'ready',
    error: null,
    query: '',
    tagFilter: null,
    tagFiles: null,
    selectedPath: null,
  });
  useTabStore.setState({
    panes: {
      left: { id: 'left', tabs: [], activeTabId: null },
      right: { id: 'right', tabs: [], activeTabId: null },
    },
    activePaneId: 'left',
    splitEnabled: false,
    splitRatio: 0.5,
  });
}

describe('页面树的应用内文件操作同步', () => {
  beforeEach(() => {
    resetStores();
    installBridge({
      'fs:exists': () => false,
      'fs:writeTextFile': () => undefined,
      'fs:renameLinked': () => ({ updated: [] }),
      'fs:mkdir': () => undefined,
      'fs:delete': () => undefined,
    });
  });

  it('createPage 写入成功后立即加入树，不依赖 chokidar 回流', async () => {
    await createPage('树同步页');

    expect(usePageTreeStore.getState().entries).toContainEqual({
      name: '树同步页.md',
      path: '树同步页.md',
      kind: 'file',
    });
  });

  it('重命名成功后立即移除旧路径并加入新路径', async () => {
    usePageTreeStore.setState({ entries: [{ name: 'old.md', path: 'old.md', kind: 'file' }] });

    await renameEntry('old.md', 'file', '新名');

    expect(usePageTreeStore.getState().entries).toEqual([
      { name: '新名.md', path: '新名.md', kind: 'file' },
    ]);
  });

  it('移动成功后立即用目标路径更新树', async () => {
    usePageTreeStore.setState({ entries: [{ name: 'old.md', path: 'old.md', kind: 'file' }] });

    await moveEntry('old.md', '归档');

    expect(usePageTreeStore.getState().entries).toEqual([
      { name: 'old.md', path: '归档/old.md', kind: 'file' },
    ]);
  });

  it('新建文件夹成功后立即加入树', async () => {
    await createFolderIn('', []);

    expect(usePageTreeStore.getState().entries).toContainEqual({
      name: '新建文件夹',
      path: '新建文件夹',
      kind: 'directory',
    });
  });

  it('删除成功后立即从树移除，不等待 unlink 事件', async () => {
    usePageTreeStore.setState({
      entries: [{ name: '删除我.md', path: '删除我.md', kind: 'file' }],
    });
    window.confirm = () => true;

    await deleteEntry('删除我.md', '删除我');

    expect(usePageTreeStore.getState().entries).toEqual([]);
  });
});
