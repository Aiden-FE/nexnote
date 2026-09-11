// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultVaultSettings } from '@nexnote/shared';
import { SourceModeView } from '../src/editor/source/SourceModeView';
import { useSettingsStore } from '../src/stores/settings-store';
import type { TabDescriptor } from '../src/stores/tab-store';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let sourceOnChange: ((text: string) => void) | null = null;

vi.mock('../src/editor/source/codemirror-host', () => ({
  createSourceEditor: (
    _parent: HTMLElement,
    options: { initialText: string; onChange(text: string): void },
  ) => {
    sourceOnChange = options.onChange;
    let text = options.initialText;
    return {
      scrollDOM: document.createElement('div'),
      getText: () => text,
      setText: (next: string) => {
        text = next;
      },
      focus: () => undefined,
      destroy: () => undefined,
    };
  },
}));

vi.mock('../src/editor/source/LivePreview', () => ({
  LivePreview: () => null,
}));

const tab: TabDescriptor = {
  id: 'source-autosave-test',
  kind: 'page',
  title: '源码页',
  pagePath: '源码页.md',
  format: 'markdown',
  editorMode: 'source',
  previewVisible: false,
  createdAt: 1,
};

function installBridge() {
  let writes = 0;
  (window as unknown as { nexnote: unknown }).nexnote = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'fs:readTextFile') return { ok: true, data: '# 源码页\n\n' };
      if (channel === 'fs:stat') {
        return {
          ok: true,
          data: {
            path: tab.pagePath,
            name: tab.pagePath,
            kind: 'file',
            size: 8,
            modifiedAt: 'v1',
          },
        };
      }
      if (channel === 'fs:writeTextFile') {
        writes += 1;
        return {
          ok: true,
          data: {
            path: (payload as { path: string }).path,
            name: tab.pagePath,
            kind: 'file',
            size: (payload as { content: string }).content.length,
            modifiedAt: 'v2',
          },
        };
      }
      if (channel === 'fs:exists') return { ok: true, data: false };
      return { ok: true, data: null };
    }),
    on: () => () => undefined,
  };
  return {
    get writes() {
      return writes;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  sourceOnChange = null;
  useSettingsStore.setState({
    vault: {
      ...defaultVaultSettings(),
      editor: { ...defaultVaultSettings().editor, autoSaveMs: 875 },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { nexnote?: unknown }).nexnote;
  document.body.innerHTML = '';
});

describe('SourceModeView 自动保存配置', () => {
  it('使用 vault.editor.autoSaveMs 防抖，而不是硬编码间隔', async () => {
    const bridge = installBridge();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<SourceModeView tab={tab} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(sourceOnChange).not.toBeNull());

    act(() => sourceOnChange?.('# 源码页\n\n新输入\n'));
    await vi.advanceTimersByTimeAsync(874);
    expect(bridge.writes).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(bridge.writes).toBe(1));

    await act(async () => root.unmount());
  });
});
