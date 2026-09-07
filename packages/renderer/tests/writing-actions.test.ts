import { describe, expect, it } from 'vitest';
import {
  WRITING_ACTIONS,
  WRITING_ACTION_MAP,
  buildWritingMessages,
  fromAiActionId,
  toAiActionId,
} from '../src/features/ai/writing';

describe('AI 写作六动作定义', () => {
  it('包含六个动作且 id 唯一', () => {
    expect(WRITING_ACTIONS).toHaveLength(6);
    const ids = WRITING_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(6);
  });

  it('替换类为 改写/润色/缩写，追加类为 扩写/查漏补缺/补充论据', () => {
    expect(WRITING_ACTION_MAP.rewrite.kind).toBe('replace');
    expect(WRITING_ACTION_MAP.polish.kind).toBe('replace');
    expect(WRITING_ACTION_MAP.condense.kind).toBe('replace');
    expect(WRITING_ACTION_MAP.expand.kind).toBe('append');
    expect(WRITING_ACTION_MAP.fillgaps.kind).toBe('append');
    expect(WRITING_ACTION_MAP.evidence.kind).toBe('append');
  });

  it('每个动作都有快捷键字母与斜杠关键词', () => {
    for (const action of WRITING_ACTIONS) {
      expect(action.modKey).toMatch(/^[a-z]$/);
      expect(action.keywords.length).toBeGreaterThan(0);
      expect(action.systemPrompt.length).toBeGreaterThan(10);
    }
  });

  it('用户提示携带目标文本与上下文', () => {
    const messages = buildWritingMessages(WRITING_ACTION_MAP.rewrite, {
      target: '这是选中的句子',
      contextBlock: '【当前文档】\n文档正文',
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[1]!.role).toBe('user');
    expect(messages[1]!.content).toContain('这是选中的句子');
    expect(messages[1]!.content).toContain('文档正文');
  });

  it('动作 id 编解码（ai: 前缀）', () => {
    expect(toAiActionId('rewrite')).toBe('ai:rewrite');
    expect(fromAiActionId('ai:expand')).toBe('expand');
    expect(fromAiActionId('other:thing')).toBeNull();
    expect(fromAiActionId('ai:notanaction')).toBeNull();
  });
});
