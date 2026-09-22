// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrontmatterData } from '@nexnote/kernel';
import { STANDARD_FIELD_CATALOG } from '@nexnote/kernel';
import { FieldEditor } from '../src/features/frontmatter/FieldEditor';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const nativeInputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

function renderFieldEditor(data: FrontmatterData) {
  const onChange = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <FieldEditor data={data} onChange={onChange} knownTags={[]} onRename={() => undefined} />,
    );
  });
  const openCatalog = () => {
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="add-field-trigger"]')?.click();
    });
  };
  const item = (key: string) =>
    document.querySelector<HTMLButtonElement>(
      `[data-testid="field-catalog-item"][data-field="${key}"]`,
    );
  return {
    onChange,
    root,
    container,
    openCatalog,
    item,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('字段删除行为（DEV-079）', () => {
  it('自定义字段删除直接移除，无需确认', () => {
    const { container, onChange } = renderFieldEditor({ title: 'T', category: 'x' });
    const row = container.querySelector('[data-testid="frontmatter-field-category"]');
    const removeBtn = row?.querySelector('button[aria-label="删除字段"]');
    expect(removeBtn).not.toBeNull();
    act(() => {
      removeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(expect.not.objectContaining({ category: expect.anything() }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ title: 'T' }));
  });

  it('标准字段删除需点击 trash 进入确认态，确认后才调用 onChange', () => {
    const { container, onChange } = renderFieldEditor({ title: 'T', updated: new Date() });
    const row = container.querySelector('[data-testid="frontmatter-field-updated"]');
    const removeBtn = row?.querySelector('button[aria-label="删除字段"]');
    expect(removeBtn).not.toBeNull();
    // 第一次点击 → 确认态，不调用 onChange
    act(() => {
      removeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onChange).not.toHaveBeenCalled();
    // 确认态出现
    const confirm = container.querySelector('[data-testid="field-remove-confirm-updated"]');
    expect(confirm).not.toBeNull();
    // 点击「删除」按钮
    const confirmDelete = [...confirm!.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '删除',
    );
    expect(confirmDelete).toBeDefined();
    act(() => {
      confirmDelete!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(expect.not.objectContaining({ updated: expect.anything() }));
  });

  it('标准字段删除确认态点「取消」不调用 onChange', () => {
    const { container, onChange } = renderFieldEditor({ created: new Date(), custom: 'v' });
    const row = container.querySelector('[data-testid="frontmatter-field-created"]');
    const removeBtn = row?.querySelector('button[aria-label="删除字段"]');
    act(() => {
      removeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const confirm = container.querySelector('[data-testid="field-remove-confirm-created"]');
    const cancel = [...confirm!.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '取消',
    );
    act(() => {
      cancel!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onChange).not.toHaveBeenCalled();
    // 确认态消失，trash 按钮恢复
    expect(container.querySelector('[data-testid="field-remove-confirm-created"]')).toBeNull();
  });

  it('标准字段删除后目录中该项恢复可添加（disabled 解除）', () => {
    const { openCatalog, item, onChange, root } = renderFieldEditor({
      title: 'T',
      confidence: 0.5,
    });
    // 先删除 confidence
    const row = document.querySelector('[data-testid="frontmatter-field-confidence"]');
    const removeBtn = row?.querySelector('button[aria-label="删除字段"]');
    act(() => {
      removeBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const confirm = document.querySelector('[data-testid="field-remove-confirm-confidence"]');
    const confirmDelete = [...confirm!.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '删除',
    );
    act(() => {
      confirmDelete!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // onChange 被调用且不含 confidence
    expect(onChange).toHaveBeenCalledWith(
      expect.not.objectContaining({ confidence: expect.anything() }),
    );
    // 用删除后的新 data 重新渲染（模拟父组件受控更新），目录中 confidence 应恢复可添加
    const nextData = onChange.mock.calls[0]![0] as FrontmatterData;
    act(() => {
      root.render(
        <FieldEditor
          data={nextData}
          onChange={() => undefined}
          knownTags={[]}
          onRename={() => undefined}
        />,
      );
    });
    openCatalog();
    expect(item('confidence')?.disabled).toBe(false);
  });
});

describe('字段目录选择器（DEV-025）', () => {
  it('DEV-080：目录列出 6 个标准字段（type 已移除），带类型与说明', () => {
    const { openCatalog, item } = renderFieldEditor({ title: '已有标题' });
    expect(document.querySelector('[data-testid="field-catalog"]')).toBeNull();
    openCatalog();
    expect(document.querySelector('[data-testid="field-catalog"]')).not.toBeNull();
    for (const field of STANDARD_FIELD_CATALOG) {
      const row = item(field.key);
      expect(row, field.key).not.toBeNull();
      expect(row?.textContent ?? '').toContain(field.description);
    }
  });

  it('已存在的标准字段禁用并标「已添加」，未存在字段可点击', () => {
    const { openCatalog, item, onChange } = renderFieldEditor({ title: '已有标题' });
    openCatalog();
    const titleRow = item('title');
    expect(titleRow?.disabled).toBe(true);
    expect(titleRow?.textContent).toContain('已添加');
    act(() => {
      item('tags')?.click();
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tags: [] }));
    // 添加后目录关闭
    expect(document.querySelector('[data-testid="field-catalog"]')).toBeNull();
  });

  it('字段行 hover 说明 tooltip 与目录定义一致（集中一处）', () => {
    const { openCatalog, item } = renderFieldEditor({});
    openCatalog();
    for (const field of STANDARD_FIELD_CATALOG) {
      expect(item(field.key)?.getAttribute('title')).toBe(field.description);
    }
  });

  it('底部「自定义字段」入口保留自由命名', () => {
    const { openCatalog, onChange } = renderFieldEditor({});
    openCatalog();
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="field-catalog-custom"]')?.click();
    });
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid="field-catalog-custom-input"]',
    );
    expect(input).not.toBeNull();
    act(() => {
      if (input && nativeInputSetter) {
        nativeInputSetter.call(input, 'category');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ category: '' }));
  });
});
