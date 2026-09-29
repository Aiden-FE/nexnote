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
let binaryCreatePayloads: Array<Record<string, unknown>> = [];

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
  binaryCreatePayloads = [];
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
    'binary:create': (payload) => {
      binaryCreatePayloads.push(payload);
      return {
        path: `blank.${payload.kind}`,
        name: `blank.${payload.kind}`,
        kind: 'file',
        size: 0,
      };
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

describe('页面树「新建」下拉菜单（DEV-084 含空白二进制，DEV-096 移除导入）', () => {
  it('展开菜单显示 4 种新建格式：块 / MD / 空白 XLSX / XMind（DEV-098 撤销 DOCX）', async () => {
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
    expect(items).toHaveLength(4);
    // DEV-096：导入已从新建菜单移除（统一在顶栏「文件」菜单）
    expect(menu!.textContent).not.toContain('导入');

    // 块 / MD 的徽标仍正确
    const badgeOf = (item: HTMLElement): string | null | undefined =>
      item.querySelector<HTMLElement>('[aria-hidden="true"]')?.textContent;
    expect(badgeOf(items[0])).toBe('块');
    expect(badgeOf(items[1])).toBe('MD');
    // DEV-084（DEV-098 撤销 docx 后两项）：空白二进制的徽标与文案
    expect(items[2].textContent).toContain('新建空白 XLSX');
    expect(badgeOf(items[2])).toBe('XLSX');
    expect(items[3].textContent).toContain('新建空白 XMind');
    expect(badgeOf(items[3])).toBe('XMIND');
  });

  it('默认项（块编辑）经 fs:createNote 新建并按块编辑模式打开', async () => {
    const view = await mountPageTree();
    openMenu(view);

    await act(async () => {
      view.querySelector<HTMLElement>('[data-testid="new-note-native-block"]')!.click();
    });

    expect(createdPayloads).toEqual([{ parentDir: '', format: 'native-block' }]);
    expect(binaryCreatePayloads).toEqual([]);
    const tab = activeTab();
    expect(tab?.kind).toBe('page');
    expect(tab?.pagePath).toBe('新建文档.md');
    expect(tab?.format).toBe('native-block');
    expect(tab?.editorMode).toBe('block');
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
    expect(tab?.editorMode).toBe('source');
  });

  // DEV-084 回归：main 侧 binary:create 早已就绪却无人调用，本票把侧栏菜单接到它。
  // DEV-098 撤销 docx 后仅 xlsx / xmind 两项经侧栏入口触发 binary:create。
  it('空白 XLSX / XMind 两项均通过 binary:create 创建并打开 tab', async () => {
    const view = await mountPageTree();
    for (const expected of [
      // ops.createBinaryIn 约定 'mindmap' 而 NewNoteMenu 的展示用 'xmind'，调用边界翻译一次。
      { testId: 'new-note-xlsx', kind: 'xlsx' as const },
      { testId: 'new-note-xmind', kind: 'mindmap' as const },
    ]) {
      binaryCreatePayloads.length = 0;
      openMenu(view);
      const item = view.querySelector<HTMLElement>(`[data-testid="${expected.testId}"]`);
      expect(item).not.toBeNull();
      act(() => item!.click());
      expect(binaryCreatePayloads).toEqual([{ kind: expected.kind, targetDir: '' }]);
    }
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
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(view.querySelector('[data-testid="new-note-menu"]')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });
});
