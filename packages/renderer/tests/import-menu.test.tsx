// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/features/sidebar/page-tree';
import { sidebarPanelRegistry } from '../src/registries';
import { usePageTreeStore } from '../src/stores/page-tree-store';
import { useTabStore } from '../src/stores/tab-store';
import { useUiStore } from '../src/stores/ui-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let invokeSpy: ReturnType<typeof vi.fn>;
let importCalls: Array<{ channel: string; payload: unknown }> = [];

function installBridge(): void {
  invokeSpy = vi.fn(async (channel: string, payload?: unknown) => {
    importCalls.push({ channel, payload });
    if (channel === 'fs:createNote') {
      return { ok: true, data: { path: '新建文档.md', name: '新建文档.md' } };
    }
    if (channel === 'docx:import' || channel === 'binary:import') {
      return { ok: true, data: { path: 'imported', sha256: 'x' } };
    }
    return { ok: true, data: null };
  });
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: invokeSpy,
    on: () => () => undefined,
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

beforeEach(() => {
  importCalls = [];
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
  installBridge();
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

describe('DEV-085 页面树「导入」下拉菜单', () => {
  it('工具栏有独立的导入触发按钮，与新建并存', async () => {
    const view = await mountPageTree();
    expect(view.querySelector('[data-testid="tree-new-note"]')).not.toBeNull();
    expect(view.querySelector('[data-testid="tree-new-note-menu"]')).not.toBeNull();
    expect(view.querySelector('[data-testid="tree-import-menu"]')).not.toBeNull();
  });

  it('展开菜单显示三项导入，按徽标区分 docx/xlsx/xmind', async () => {
    const view = await mountPageTree();
    const trigger = view.querySelector<HTMLElement>('[data-testid="tree-import-menu"]')!;
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(view.querySelector('[data-testid="import-menu"]')).toBeNull();

    act(() => trigger.click());
    const menu = view.querySelector('[data-testid="import-menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.getAttribute('role')).toBe('menu');

    const items = [...menu!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('导入 DOCX');
    expect(items[1].textContent).toContain('导入 XLSX');
    expect(items[2].textContent).toContain('导入 XMIND');
    // 徽标
    const badgeOf = (item: HTMLElement): string | null | undefined =>
      item.querySelector<HTMLElement>('[aria-hidden="true"]')?.textContent;
    expect(badgeOf(items[0])).toBe('DOCX');
    expect(badgeOf(items[1])).toBe('XLSX');
    expect(badgeOf(items[2])).toBe('XMIND');
  });

  it('点击 XLSX 项触发 binary:import（kind=xlsx）', async () => {
    const view = await mountPageTree();
    act(() => view.querySelector<HTMLElement>('[data-testid="tree-import-menu"]')!.click());
    await act(async () => {
      view.querySelector<HTMLElement>('[data-testid="import-xlsx"]')!.click();
    });
    expect(importCalls.some((c) => c.channel === 'binary:import' && (c.payload as { kind?: string }).kind === 'xlsx')).toBe(true);
  });

  it('点击 DOCX 项触发 docx:import', async () => {
    const view = await mountPageTree();
    act(() => view.querySelector<HTMLElement>('[data-testid="tree-import-menu"]')!.click());
    await act(async () => {
      view.querySelector<HTMLElement>('[data-testid="import-docx"]')!.click();
    });
    expect(importCalls.some((c) => c.channel === 'docx:import')).toBe(true);
  });

  it('点击 XMIND 项触发 binary:import（kind=mindmap）', async () => {
    const view = await mountPageTree();
    act(() => view.querySelector<HTMLElement>('[data-testid="tree-import-menu"]')!.click());
    await act(async () => {
      view.querySelector<HTMLElement>('[data-testid="import-xmind"]')!.click();
    });
    expect(importCalls.some((c) => c.channel === 'binary:import' && (c.payload as { kind?: string }).kind === 'mindmap')).toBe(true);
  });

  it('Esc 关闭菜单并把焦点回到触发按钮', async () => {
    const view = await mountPageTree();
    const trigger = view.querySelector<HTMLElement>('[data-testid="tree-import-menu"]')!;
    act(() => trigger.click());
    expect(view.querySelector('[data-testid="import-menu"]')).not.toBeNull();
    act(() => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(view.querySelector('[data-testid="import-menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});