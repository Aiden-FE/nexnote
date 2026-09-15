// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorKernelInstance } from '@nexnote/kernel';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { LivePreview } from '../src/editor/source/LivePreview';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const kernels: EditorKernelInstance[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const kernel of kernels.splice(0)) kernel.destroy();
  document.body.replaceChildren();
});

function mountEditor(markdown: string): HTMLElement {
  const host = document.createElement('div');
  host.className = 'nexnote-editor-host';
  document.body.append(host);
  kernels.push(createEditor(host, { initialMarkdown: markdown }));
  return host;
}

function mountPreview(markdown: string): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      <LivePreview
        markdown={markdown}
        sourcePath="待办.md"
        onNavigate={() => undefined}
        scrollRef={{ current: null }}
      />,
    );
  });
  return container;
}

const taskMarkdown =
  '- [ ] **重点** [链接](https://example.com)\n  - [x] 嵌套\n\n- [x] 多行\n  第二行';

describe('DEV-043 task checkbox 对齐结构', () => {
  it('编辑区为每个任务保留 label/input 与内容首行的稳定结构', () => {
    const host = mountEditor(taskMarkdown);
    const items = host.querySelectorAll('ul[data-type="taskList"] > li');

    expect(items.length).toBeGreaterThanOrEqual(2);
    for (const item of items) {
      expect(item.querySelector(':scope > label > input[type="checkbox"]')).toBeTruthy();
      expect(item.querySelector(':scope > div')).toBeTruthy();
      expect(item.querySelector(':scope > label')?.style.marginTop).toBe('');
    }
    expect(items[0].querySelector(':scope > label > input')?.checked).toBe(false);
    expect(items[1].querySelector(':scope > label > input')?.checked).toBe(true);
    expect(items[0].querySelector('ul[data-type="taskList"] input')?.checked).toBe(true);
  });

  it('预览区复用相同的 taskList 结构并保留行内内容', () => {
    const preview = mountPreview(taskMarkdown);
    const list = preview.querySelector('.nexnote-markdown-preview ul[data-type="taskList"]');
    expect(list).toBeTruthy();
    expect(list?.querySelectorAll(':scope > li').length).toBeGreaterThanOrEqual(1);
    expect(list?.querySelector(':scope > li > label > input[type="checkbox"]')).toBeTruthy();
    expect(list?.querySelector('strong')?.textContent).toContain('重点');
    expect(list?.querySelector('a[href="https://example.com"]')).toBeTruthy();
    expect(
      [...preview.querySelectorAll('input[type="checkbox"]')].some(
        (input) => (input as HTMLInputElement).checked,
      ),
    ).toBe(true);
  });
});

describe('DEV-043 task checkbox CSS 合同', () => {
  it('编辑区与预览区共享首行行盒对齐规则，不使用固定 margin-top 补偿', () => {
    const css = readFileSync(resolve(__dirname, '../src/globals.css'), 'utf8');
    expect(css).toMatch(
      /\.nexnote-editor-host \.ProseMirror ul\[data-type='taskList'\] li,\s*\n\.nexnote-markdown-preview \.ProseMirror ul\[data-type='taskList'\] li\s*\{/,
    );
    expect(css).toMatch(
      /label\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*height:\s*1lh;/s,
    );
    expect(css).not.toMatch(/taskList['\]]+\s+label\s*\{[^}]*margin-top\s*:/s);
  });
});
