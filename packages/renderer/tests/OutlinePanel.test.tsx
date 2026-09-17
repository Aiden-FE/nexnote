// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutlinePanel } from '../src/editor/OutlinePanel';
import type { OutlineEntry } from '../src/editor/outline';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
});

describe('OutlinePanel', () => {
  it('显示空态且关闭按钮回调宿主', () => {
    const { onClose } = render([]);
    expect(document.querySelector('[data-testid="outline-empty"]')?.textContent).toContain(
      '暂无标题',
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
});
