// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOGS, translate } from '@nexnote/shared';
import { OutlinePanel } from '../src/editor/OutlinePanel';
import type { OutlineEntry } from '../src/editor/outline';
import { setLanguage } from '../src/lib/i18n';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const text = (language: 'zh-CN' | 'en-US', key: string): string =>
  translate(CATALOGS[language], key, language);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(entries: OutlineEntry[], onNavigate = vi.fn(), onClose = vi.fn()) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(<OutlinePanel entries={entries} onNavigate={onNavigate} onClose={onClose} />),
  );
  return { onNavigate, onClose };
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  setLanguage('zh-CN');
});

describe('OutlinePanel', () => {
  it('显示空态且关闭按钮回调宿主', () => {
    const { onClose } = render([]);
    expect(document.querySelector('[data-testid="outline-empty"]')?.textContent).toContain(
      text('zh-CN', 'outline.empty'),
    );
    act(() => document.querySelector<HTMLButtonElement>('[data-testid="outline-close"]')?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('按标题级别缩进；点击定位并立即高亮当前标题', () => {
    const entries: OutlineEntry[] = [
      { id: 'top', level: 1, text: 'Top', ordinal: 0, from: 0, to: 5 },
      { id: 'nested', level: 3, text: 'Nested', ordinal: 1, from: 6, to: 16 },
    ];
    const { onNavigate } = render(entries);
    const top = document.querySelector<HTMLButtonElement>('[data-testid="outline-entry-top"]')!;
    const nested = document.querySelector<HTMLButtonElement>(
      '[data-testid="outline-entry-nested"]',
    )!;

    expect(Number.parseInt(nested.style.paddingLeft)).toBeGreaterThan(
      Number.parseInt(top.style.paddingLeft),
    );
    act(() => nested.click());
    expect(onNavigate).toHaveBeenCalledWith(entries[1]);
    expect(nested.dataset.active).toBe('true');
    expect(top.dataset.active).toBeUndefined();
  });

  it('顶栏图标可收缩为小图标并再展开（DEV-048）', () => {
    const entries: OutlineEntry[] = [
      { id: 'top', level: 1, text: 'Top', ordinal: 0, from: 0, to: 5 },
    ];
    render(entries);
    const panel = () => document.querySelector('[data-testid="outline-panel"]')!;
    const toggle = () =>
      document.querySelector<HTMLButtonElement>('[data-testid="outline-toggle"]')!;

    expect(toggle().getAttribute('aria-expanded')).toBe('true');

    act(() => toggle().click());
    expect(panel().getAttribute('data-collapsed')).toBe('true');
    expect(document.querySelector('[data-testid="outline-entry-top"]')).toBeNull();
    expect(document.querySelector('[data-testid="outline-close"]')).toBeNull();
    const expand = document.querySelector<HTMLButtonElement>('[data-testid="outline-expand"]')!;
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(expand.getAttribute('aria-label')).toBe(text('zh-CN', 'outline.expand'));

    act(() => expand.click());
    expect(panel().hasAttribute('data-collapsed')).toBe(false);
    expect(document.querySelector('[data-testid="outline-entry-top"]')).not.toBeNull();
  });

  it('renders empty state and controls in English without CJK residue (ADR-0023)', () => {
    setLanguage('en-US');
    render([]);
    expect(document.querySelector('[data-testid="outline-empty"]')?.textContent).toContain(
      text('en-US', 'outline.empty'),
    );

    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="outline-toggle"]')!;
    act(() => toggle.click());
    const expand = document.querySelector<HTMLButtonElement>('[data-testid="outline-expand"]')!;
    expect(expand.getAttribute('aria-label')).toBe(text('en-US', 'outline.expand'));
    expect(document.querySelector('[data-testid="outline-panel"]')?.textContent ?? '').not.toMatch(
      /[一-鿿]/,
    );
  });
});
