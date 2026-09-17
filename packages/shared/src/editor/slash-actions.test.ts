import { describe, expect, it } from 'vitest';
import { SHARED_SLASH_ACTIONS, SLASH_ACTION_GROUP_ORDER, sharedSlashAction } from './slash-actions';

describe('共享快捷插入动作模型（DEV-052）', () => {
  it('声明稳定的四组及 H1-H6、列表、结构和行内动作能力', () => {
    expect(SLASH_ACTION_GROUP_ORDER).toEqual(['基础块', '插入', 'AI', '插件']);
    expect(SHARED_SLASH_ACTIONS.filter((action) => action.kind === 'block-type')).toHaveLength(12);
    expect(sharedSlashAction('wikilink')?.kind).toBe('inline');
    expect(sharedSlashAction('table')?.kind).toBe('structure');
    expect(sharedSlashAction('table')?.modes).toEqual(['block', 'source']);
    expect(sharedSlashAction('heading1')?.modes).toContain('block');
  });

  it('中文、英文和 Markdown 记号别名指向同一语义动作', () => {
    expect(sharedSlashAction('heading2')?.aliases).toEqual(
      expect.arrayContaining(['h2', 'heading 2', '##', '二级标题']),
    );
    expect(sharedSlashAction('taskList')?.aliases).toEqual(
      expect.arrayContaining(['task', 'todo', '- [ ]', '任务']),
    );
  });
});
