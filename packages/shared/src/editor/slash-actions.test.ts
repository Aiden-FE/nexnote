import { describe, expect, it } from 'vitest';
import { SHARED_SLASH_ACTIONS, SLASH_ACTION_GROUP_ORDER, sharedSlashAction } from './slash-actions';
import { filterQuickInsertCandidates, quickInsertCatalog } from './editor-actions';

describe('共享快捷插入动作模型（DEV-052）', () => {
  it('声明稳定的四组及 H1-H6、列表、结构和行内动作能力', () => {
    expect(SLASH_ACTION_GROUP_ORDER).toEqual(['基础块', '插入', 'AI', '插件']);
    expect(
      SHARED_SLASH_ACTIONS.filter((action) => action.quickInsert?.kind === 'block-type'),
    ).toHaveLength(12);
    expect(sharedSlashAction('format:wikilink')?.quickInsert?.kind).toBe('inline');
    expect(sharedSlashAction('insert:table')?.quickInsert?.kind).toBe('structure');
    expect(sharedSlashAction('insert:table')?.modes).toEqual(['block', 'source']);
    expect(sharedSlashAction('block:heading:1')?.modes).toContain('block');
  });

  it('中文、英文和 Markdown 记号别名指向同一语义动作', () => {
    expect(sharedSlashAction('block:heading:2')?.quickInsert?.aliases).toEqual(
      expect.arrayContaining(['h2', 'heading 2', '##', '二级标题']),
    );
    expect(sharedSlashAction('block:task-list')?.quickInsert?.aliases).toEqual(
      expect.arrayContaining(['task', 'todo', '- [ ]', '任务']),
    );
  });

  it('两种编辑模式的能力、别名搜索与上下文过滤共享同一授权边界', () => {
    const candidates = (mode: 'block' | 'source') =>
      quickInsertCatalog(mode).map((action) => ({
        item: action.id,
        id: action.id,
        title: action.name,
        group: action.quickInsert!.group,
        aliases: action.quickInsert!.aliases,
        contract: action.quickInsert!,
        available: true,
      }));
    for (const mode of ['block', 'source'] as const) {
      const abilities = new Set([
        'editable-line',
        'empty-block',
        'explicit-ai',
        'plugin-defined',
      ] as const);
      const search = (query: string, emptyBlock: boolean) =>
        filterQuickInsertCandidates(candidates(mode), query, abilities, emptyBlock);
      expect(search('h2', true)[0]).toBe('block:heading:2');
      expect(search('heading 2', true)[0]).toBe('block:heading:2');
      expect(search('二级标题', true)[0]).toBe('block:heading:2');
      expect(search('h2', false)).not.toContain('block:heading:2');
      expect(search('表格', false)).toContain('insert:table');
      expect(search('不匹配的动作', true)).toEqual([]);
      expect(search('', true)).toContain('block:heading:6');
    }
    expect(quickInsertCatalog('preview')).toEqual([]);
    const unavailable = candidates('block').filter((candidate) => candidate.id === 'insert:table');
    expect(
      filterQuickInsertCandidates(
        unavailable.map((candidate) => ({ ...candidate, available: false })),
        '表格',
        new Set(['editable-line']),
        false,
      ),
    ).toEqual([]);
  });
});
