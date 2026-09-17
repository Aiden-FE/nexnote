// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor } from '@nexnote/kernel';
import { registerEditor } from '../src/editor/active-editor';
import {
  expandAllCurrentHeadingFolds,
  HEADING_FOLDS_EXPANDED_EVENT,
} from '../src/editor/expand-all';
import { useHeadingFoldAnnouncement } from '../src/editor/use-heading-fold-announcement';
import { createSourceEditor } from '../src/editor/source/codemirror-host';
import { registerSourceEditor } from '../src/editor/source/active-source-editor';
import { sourceFoldState } from '../src/editor/source/heading-fold';
import { useTabStore, type TabDescriptor } from '../src/stores/tab-store';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const originalStore = useTabStore.getState();
const cleanups: Array<() => void | Promise<void>> = [];

function setTabs(tabs: TabDescriptor[], activeTabId: string): void {
  useTabStore.setState({ tabs, activeTabId });
}

function page(id: string, format: 'native-block' | 'markdown'): TabDescriptor {
  return { id, kind: 'page', title: id, format, createdAt: 1 };
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  useTabStore.setState({ tabs: originalStore.tabs, activeTabId: originalStore.activeTabId });
  document.body.innerHTML = '';
});

function Announcement({ tabId }: { tabId: string }) {
  const announcement = useHeadingFoldAnnouncement(tabId);
  return (
    <span
      key={announcement.key}
      role="status"
      aria-live="polite"
      data-testid={`announcement-${tabId}`}
    >
      {announcement.message}
    </span>
  );
}

describe('DEV-056 当前 tab / 当前编辑视图全部展开', () => {
  it('块编辑命令按 activeTabId 精确寻址，不串改后来注册的后台视图', () => {
    const activeParent = document.createElement('div');
    const backgroundParent = document.createElement('div');
    document.body.append(activeParent, backgroundParent);
    const activeKernel = createEditor(activeParent, {
      initialMarkdown: '# A ^a\n\nA body ^ap\n',
    });
    const backgroundKernel = createEditor(backgroundParent, {
      initialMarkdown: '# B ^b\n\nB body ^bp\n',
    });
    const activeRegistration = registerEditor(activeKernel, 'active-block');
    const backgroundRegistration = registerEditor(backgroundKernel, 'background-block');
    cleanups.push(() => {
      backgroundRegistration.unregister();
      activeRegistration.unregister();
      backgroundKernel.destroy();
      activeKernel.destroy();
    });
    activeKernel.toggleBlockFold('a');
    backgroundKernel.toggleBlockFold('b');
    setTabs(
      [page('active-block', 'native-block'), page('background-block', 'native-block')],
      'active-block',
    );

    expect(expandAllCurrentHeadingFolds()).toBe(1);
    expect(activeKernel.isBlockFolded('a')).toBe(false);
    expect(backgroundKernel.isBlockFolded('b')).toBe(true);
  });

  it('相同的展开反馈替换 aria-live 节点且不通知其他 tab', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    cleanups.push(async () => act(async () => root.unmount()));
    await act(async () =>
      root.render(
        <>
          <Announcement tabId="active" />
          <Announcement tabId="background" />
        </>,
      ),
    );
    const activeBefore = host.querySelector('[data-testid="announcement-active"]');
    const backgroundBefore = host.querySelector('[data-testid="announcement-background"]');

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(HEADING_FOLDS_EXPANDED_EVENT, { detail: { tabId: 'active', count: 0 } }),
      );
    });
    const activeFirst = host.querySelector('[data-testid="announcement-active"]');
    expect(activeFirst?.textContent).toBe('当前页面没有折叠章节');
    expect(activeFirst).not.toBe(activeBefore);
    expect(host.querySelector('[data-testid="announcement-background"]')).toBe(backgroundBefore);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(HEADING_FOLDS_EXPANDED_EVENT, { detail: { tabId: 'active', count: 0 } }),
      );
    });
    expect(host.querySelector('[data-testid="announcement-active"]')).not.toBe(activeFirst);
  });

  it('Markdown 命令按 activeTabId 精确寻址，不串改后来注册的后台视图', () => {
    const activeParent = document.createElement('div');
    const backgroundParent = document.createElement('div');
    document.body.append(activeParent, backgroundParent);
    const activeEditor = createSourceEditor(activeParent, {
      initialText: '# A\nA body\n',
      headingFolding: true,
      onChange: () => undefined,
    });
    const backgroundEditor = createSourceEditor(backgroundParent, {
      initialText: '# B\nB body\n',
      headingFolding: true,
      onChange: () => undefined,
    });
    const unregisterActive = registerSourceEditor(activeEditor, 'active-source');
    const unregisterBackground = registerSourceEditor(backgroundEditor, 'background-source');
    cleanups.push(() => {
      unregisterBackground();
      unregisterActive();
      backgroundEditor.destroy();
      activeEditor.destroy();
    });
    activeParent.querySelector<HTMLButtonElement>('.cm-heading-fold-toggle')!.click();
    backgroundParent.querySelector<HTMLButtonElement>('.cm-heading-fold-toggle')!.click();
    setTabs(
      [page('active-source', 'markdown'), page('background-source', 'markdown')],
      'active-source',
    );

    expect(expandAllCurrentHeadingFolds()).toBe(1);
    expect(sourceFoldState(activeEditor.view.state)?.folded.size).toBe(0);
    expect(sourceFoldState(backgroundEditor.view.state)?.folded.size).toBe(1);
  });
});
