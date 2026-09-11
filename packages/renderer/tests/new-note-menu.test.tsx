// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '../src/features/sidebar/page-tree';
import { sidebarPanelRegistry } from '../src/registries';
import { usePageTreeStore } from '../src/stores/page-tree-store';
import { useTabStore } from '../src/stores/tab-store';
import { useUiStore } from '../src/stores/ui-store';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Handler = (payload: Record<string, unknown>) => unknown;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let createdPayloads: Array<Record<string, unknown>> = [];

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

async function mountPageTree(): Promise<HTMLDivElement> {
  const Panel = sidebarPanelRegistry.get('pages')?.render;
  if (!Panel) throw new Error('pages sidebar panel is not registered');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<Panel />);
  });
  return container;
}

function activeTab() {
  const state = useTabStore.getState();
  return state.tabs.find((tab) => tab.id === state.activeTabId);
}

function openMenu(view: HTMLElement): HTMLElement {
  const trigger = view.querySelector<HTMLElement>('[data-testid="tree-new-note-menu"]');
  if (!trigger) throw new Error('new-note menu trigger not found');
  act(() => trigger.click());
  return trigger;
}

beforeEach(() => {
  createdPayloads = [];
  usePageTreeStore.setState({
    entries: [],
    status: 'ready',
    error: null,
    query: '',
    tagFilter: null,
    tagFiles: null,
    selectedPath: null,
  });
  useTabStore.setState({ tabs: [], activeTabId: null });
  useUiStore.setState({ treeCollapsedDirs: [], treeShowAllFiles: false });
  installBridge({
    'fs:createNote': (payload) => {
      createdPayloads.push(payload);
      return { path: '新建文档.md', name: '新建文档.md', kind: 'file', size: 0 };
    },
  });
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  delete (window as unknown as { nexnote?: unknown }).nexnote;
});

describe('页面树「新建」下拉菜单', () => {
  it('展开菜单显示两种格式，带徽标与悬停说明', async () => {
    const view = await mountPageTree();
    const trigger = view.querySelector<HTMLElement>('[data-testid="tree-new-note-menu"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(view.querySelector('[data-testid="new-note-menu"]')).toBeNull();

    act(() => trigger!.click());
    const menu = view.querySelector('[data-testid="new-note-menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.getAttribute('role')).toBe('menu');
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');

    const items = [...menu!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('新建文档（块编辑）');
    expect(items[1].textContent).toContain('新建 Markdown（源码模式）');
    expect(items[2].textContent).toContain('导入 DOCX');
    // 格式徽标（块 / MD）
    const badgeOf = (item: HTMLElement): string | null | undefined =>
      item.querySelector<HTMLElement>('[aria-hidden="true"]')?.textContent;
    expect(badgeOf(items[0])).toBe('块');
    expect(badgeOf(items[1])).toBe('MD');
    // 悬停说明格式差异
    expect(items[0].getAttribute('title')).toContain('块编辑');
    expect(items[0].getAttribute('title')).toContain('所见即所得');
    expect(items[1].getAttribute('title')).toContain('源码模式');
    expect(items[1].getAttribute('title')).toContain('实时预览');
  });

  it('默认项（块编辑）经 fs:createNote 新建并按块编辑模式打开', async () => {
    const view = await mountPageTree();
    openMenu(view);

    await act(async () => {
      view.querySelector<HTMLElement>('[data-testid="new-note-native-block"]')!.click();
    });

    expect(createdPayloads).toEqual([{ parentDir: '', format: 'native-block' }]);
    const tab = activeTab();
    expect(tab?.kind).toBe('page');
    expect(tab?.pagePath).toBe('新建文档.md');
    expect(tab?.format).toBe('native-block');
    expect(tab?.editorMode).toBe('block');
    // 选中后菜单关闭
    expect(view.querySelector('[data-testid="new-note-menu"]')).toBeNull();
  });

  it('Markdown 项经同一 fs:createNote 新建，打开的 tab 进入源码模式', async () => {
    const view = await mountPageTree();
    openMenu(view);

    await act(async () => {
      view.querySelector<HTMLElement>('[data-testid="new-note-markdown"]')!.click();
    });

    expect(createdPayloads).toEqual([{ parentDir: '', format: 'markdown' }]);
    const tab = activeTab();
    expect(tab?.kind).toBe('page');
    expect(tab?.pagePath).toBe('新建文档.md');
    expect(tab?.editorMode).toBe('source');
  });

  it('主按钮保持原单一按钮行为：直接新建（块编辑），不展开菜单', async () => {
    const view = await mountPageTree();
    const main = view.querySelector<HTMLElement>('[data-testid="tree-new-note"]');
    expect(main).not.toBeNull();

    await act(async () => main!.click());

    expect(createdPayloads).toEqual([{ parentDir: '', format: 'native-block' }]);
    expect(activeTab()?.pagePath).toBe('新建文档.md');
    expect(activeTab()?.format).toBe('native-block');
    expect(activeTab()?.editorMode).toBe('block');
    expect(view.querySelector('[data-testid="new-note-menu"]')).toBeNull();
  });

  it('键盘可用：↓ 打开并聚焦首项，↑/↓ 移动，Esc 关闭并回到触发按钮', async () => {
    const view = await mountPageTree();
    const trigger = view.querySelector<HTMLElement>('[data-testid="tree-new-note-menu"]')!;
    act(() => trigger.focus());
    act(() =>
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
    );
    const menu = view.querySelector('[data-testid="new-note-menu"]');
    expect(menu).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const items = [...menu!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(document.activeElement).toBe(items[0]);

    act(() =>
      items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
    );
    expect(document.activeElement).toBe(items[1]);
    act(() =>
      items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })),
    );
    expect(document.activeElement).toBe(items[0]);

    act(() =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(view.querySelector('[data-testid="new-note-menu"]')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });
});
