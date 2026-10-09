// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { translate, CATALOGS } from '@nexnote/shared';
import { commandRegistry } from '../src/registries';
import '../src/features/commands/builtin';

/** 命令 title / category 存消息目录 key，按语言成文（ADR-0023）。 */
const zh = (key: string) => translate(CATALOGS['zh-CN'], key, 'zh-CN');

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
    expect(zh(expandAll!.title)).toBe('全部展开章节');
    expect(zh(expandAll!.category)).toBe('编辑器');
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
});
