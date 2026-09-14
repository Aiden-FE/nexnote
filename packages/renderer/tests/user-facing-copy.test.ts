import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (path: string) => readFileSync(resolve(import.meta.dirname, '../src', path), 'utf8');

describe('用户可见文案清理', () => {
  it('命令面板不暴露票据标识或占位标题', () => {
    const source = src('features/commands/builtin.ts');
    expect(source).not.toMatch(/DEV-\d{3}/);
    expect(source).not.toContain('检查更新（占位）');
  });

  it('AI 设置不暴露开发票据或调试面板', () => {
    const source = src('features/ai/AiSettingsSection.tsx');
    expect(source).not.toMatch(/DEV-\d{3}/);
    expect(source).not.toContain('调试面板');
    expect(source).not.toContain('ai-debug-section');
  });

  it('活跃的占位视图不包含内核版本或票据说明', () => {
    const source = src('pages/PlaceholderPage.tsx');
    expect(source).not.toMatch(/DEV-\d{3}|KERNEL_VERSION|占位页面/);
    expect(source).toContain('此文档格式暂不支持直接编辑或预览');
  });

  it('设置和属性提示使用正式产品文案', () => {
    expect(src('features/settings/index.tsx')).toContain('实验性功能，当前版本尚未启用');
    expect(src('features/frontmatter/PropertiesPanel.tsx')).toContain('置信度尚未计算');
  });
});
