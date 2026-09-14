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

describe('字段目录选择器（DEV-025）', () => {
  it('「添加字段」打开目录：7 个标准字段全部可见、带类型与说明', () => {
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
