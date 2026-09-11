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

function typeCharacter(input: HTMLInputElement, character: string): void {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const nextValue = `${input.value.slice(0, start)}${character}${input.value.slice(end)}`;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('HTMLInputElement value setter is unavailable');
  setter.call(input, nextValue);
  input.setSelectionRange(start + character.length, start + character.length);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  usePageTreeStore.setState({
    entries: [
      { name: '研究', path: '研究', kind: 'directory' },
      { name: '外部笔记.md', path: '研究/外部笔记.md', kind: 'file' },
      { name: '另一页.md', path: '另一页.md', kind: 'file' },
      { name: '导出文档.docx', path: '导出文档.docx', kind: 'file' },
      { name: '旧笔记.markdown', path: '旧笔记.markdown', kind: 'file' },
    ],
    status: 'ready',
    error: null,
    query: '',
    tagFilter: null,
    tagFiles: null,
    selectedPath: '另一页.md',
  });
  useTabStore.setState({ tabs: [], activeTabId: null });
  useUiStore.setState({
    treeCollapsedDirs: [],
    treeShowAllFiles: false,
    treeShowExtensions: false,
  });
  installBridge({ 'fs:renameLinked': () => ({ updated: [] }) });
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

describe('页面树 GUI 回归', () => {
  it('活动页面 tab 优先于旧 selection，并随 tab 切换更新激活态', async () => {
    useTabStore.setState({
      tabs: [
        {
          id: 'tab-external',
          kind: 'page',
          title: '外部笔记',
          pagePath: '研究/外部笔记.md',
          createdAt: 1,
        },
        {
          id: 'tab-other',
          kind: 'page',
          title: '另一页',
          pagePath: '另一页.md',
          createdAt: 2,
        },
      ],
      activeTabId: 'tab-external',
    });
    const view = await mountPageTree();
    const external = view.querySelector('[data-path="研究/外部笔记.md"]');
    const other = view.querySelector('[data-path="另一页.md"]');

    expect(external?.getAttribute('data-active')).toBe('true');
    expect(other?.hasAttribute('data-active')).toBe(false);

    act(() => useTabStore.getState().setActiveTab('tab-other'));

    expect(external?.hasAttribute('data-active')).toBe(false);
    expect(other?.getAttribute('data-active')).toBe('true');
  });

  it('文件后缀按钮切换显示名并更新 store', async () => {
    const view = await mountPageTree();
    expect(view.querySelector('[data-path="另一页.md"]')?.textContent).toContain('另一页');
    expect(view.querySelector('[data-path="旧笔记.markdown"]')?.textContent).toContain('旧笔记');
    expect(view.querySelector('[data-path="导出文档.docx"]')?.textContent).toContain(
      '导出文档.docx',
    );

    act(() =>
      view.querySelector<HTMLButtonElement>('[data-testid="tree-toggle-extensions"]')!.click(),
    );

    expect(useUiStore.getState().treeShowExtensions).toBe(true);
    expect(view.querySelector('[data-path="另一页.md"]')?.textContent).toContain('另一页.md');
    expect(view.querySelector('[data-path="旧笔记.markdown"]')?.textContent).toContain(
      '旧笔记.markdown',
    );
  });

  it('右键重命名后连续输入不会在每个字符后重新全选', async () => {
    const view = await mountPageTree();
    const row = view.querySelector<HTMLElement>('[data-path="研究/外部笔记.md"]');
    expect(row).not.toBeNull();

    act(() => {
      row!.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 20,
        }),
      );
    });
    const renameMenuItem = [...view.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.includes('重命名'),
    );
    expect(renameMenuItem).toBeDefined();

    act(() => renameMenuItem!.click());
    const input = view.querySelector<HTMLInputElement>('[data-testid="tree-rename-input"]');
    expect(input?.value).toBe('外部笔记');
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe(input?.value.length);

    for (const character of '改名后') {
      act(() => typeCharacter(input!, character));
    }
    expect(input?.value).toBe('改名后');
    expect(input?.selectionStart).toBe(3);
    expect(input?.selectionEnd).toBe(3);

    await act(async () => {
      input!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    expect(usePageTreeStore.getState().entries).toContainEqual({
      name: '改名后.md',
      path: '研究/改名后.md',
      kind: 'file',
    });
    expect(view.querySelector('[data-testid="tree-rename-input"]')).toBeNull();
  });
});
