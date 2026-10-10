// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { translate, CATALOGS } from '@nexnote/shared';
import { commandRegistry } from '../src/registries';
import '../src/features/commands/builtin';

/** 命令 title / category 存消息目录 key，按语言成文（ADR-0023）。 */
const text = (language: 'zh-CN' | 'en-US', key: string) =>
  translate(CATALOGS[language], key, language);
const zh = (key: string) => text('zh-CN', key);

/**
 * DEV-021：删除文件浏览占位页后，⌘K 面板不应再有「打开 Vault 文件浏览」命令。
 */
describe('内置命令（DEV-021 移除文件浏览占位）', () => {
  it('命令面板无 tab.files 文件浏览命令', () => {
    expect(commandRegistry.get('tab.files')).toBeUndefined();
  });

  it('内置命令标题不含 vault / Vault 字样（用户文案统一「知识库」）', () => {
    for (const command of commandRegistry.all()) {
      expect(zh(command.title), command.id).not.toMatch(/vault/i);
    }
  });

  it('命令面板仅提供“全部展开章节”，不提供无差别全部折叠', () => {
    const expandAll = commandRegistry.get('editor.expandAllHeadings');
    expect(expandAll).toBeDefined();
    expect(zh(expandAll!.title)).toBe(text('zh-CN', 'command.editor.expandAllHeadings'));
    expect(zh(expandAll!.category)).toBe(text('zh-CN', 'command.category.editor'));
    expect(
      commandRegistry
        .all()
        .filter((command) =>
          /全部折叠|collapse all/i.test(
            `${zh(command.title)} ${zh(command.category)} ${command.keywords.join(' ')}`,
          ),
        ),
    ).toEqual([]);
  });

  it('en-US 标题与分类按词典成文且无中文残留', () => {
    const expandAll = commandRegistry.get('editor.expandAllHeadings');
    expect(expandAll).toBeDefined();
    const enTitle = text('en-US', expandAll!.title);
    const enCategory = text('en-US', expandAll!.category);
    expect(enTitle).not.toBe(zh(expandAll!.title));
    expect(enCategory).not.toBe(zh(expandAll!.category));
    expect(enTitle).not.toMatch(/[一-鿿]/);
    expect(enCategory).not.toMatch(/[一-鿿]/);
    for (const command of commandRegistry.all()) {
      const rendered = `${text('en-US', command.title)} ${text('en-US', command.category)}`;
      expect(rendered, command.id).not.toMatch(/[一-鿿]/);
    }
  });
});
