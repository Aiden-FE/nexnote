// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { LivePreview } from '../src/editor/source/LivePreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const container = document.createElement('div');
document.body.append(container);

beforeAll(() => {
  Object.defineProperty(document, 'compatMode', { configurable: true, value: 'CSS1Compat' });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.innerHTML = '';
  vi.useRealTimers();
});

function mount(markdown: string): void {
  root = createRoot(container);
  act(() => {
    root!.render(
      <LivePreview
        markdown={markdown}
        sourcePath="预览页.md"
        onNavigate={() => undefined}
        scrollRef={{ current: null }}
      />,
    );
  });
}

const tokens = (): number =>
  container.querySelectorAll('[data-testid="live-preview"] [class*="hljs-"]').length;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

describe('DEV-029 实时预览代码块高亮', () => {
  it('common 语言即时高亮（与块渲染同一注册表）', () => {
    mount('```typescript\nconst value: number = 1;\n```\n');
    expect(tokens()).toBeGreaterThan(0);
  });

  it('懒加载语言（Dockerfile）在语法就绪后高亮', async () => {
    mount('```dockerfile\nFROM node:22\nRUN echo hi\n```\n');
    await settle();
    expect(tokens()).toBeGreaterThan(0);
  });

  it('未知语言降级纯文本且预览不报错', async () => {
    mount('```not-a-language\nplain text body\n```\n');
    await settle();
    expect(tokens()).toBe(0);
    expect(container.querySelector('[data-testid="preview-error"]')).toBeNull();
    expect(container.textContent).toContain('plain text body');
  });
});
