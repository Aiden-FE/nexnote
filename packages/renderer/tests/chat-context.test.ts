import { describe, expect, it } from 'vitest';
import { assembleChatContext, estimateTokens, type ChatContextChip } from '../src/features/ai/chat/context';

function chip(partial: Partial<ChatContextChip> & Pick<ChatContextChip, 'kind' | 'label' | 'text'>): ChatContextChip {
  return { id: `${partial.kind}-${partial.label}`, ...partial };
}

describe('对话上下文组装', () => {
  it('token 估算：CJK 约 1 字/token，英文约 4 字符/token', () => {
    expect(estimateTokens('你好世界')).toBe(4);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('优先级：选区 > 当前文档 > 页面 > 反链；上下文块带标题', () => {
    const chips: ChatContextChip[] = [
      chip({ kind: 'backlink', label: '反链', text: '反链内容' }),
      chip({ kind: 'document', label: '文档', text: '文档内容' }),
      chip({ kind: 'selection', label: '选区', text: '选区内容' }),
    ];
    const { contextBlock } = assembleChatContext(chips, 6000);
    const sel = contextBlock.indexOf('选区内容');
    const doc = contextBlock.indexOf('文档内容');
    const link = contextBlock.indexOf('反链内容');
    expect(sel).toBeGreaterThanOrEqual(0);
    expect(sel).toBeLessThan(doc);
    expect(doc).toBeLessThan(link);
    expect(contextBlock).toContain('【当前选区');
    expect(contextBlock).toContain('【当前文档');
    expect(contextBlock).toContain('【相关笔记（反向链接）');
  });

  it('超预算时丢弃/截断低优先级内容并标记 truncated', () => {
    const chips: ChatContextChip[] = [
      chip({ kind: 'selection', label: '选区', text: 's' }),
      chip({ kind: 'document', label: '文档', text: '文'.repeat(2000) }),
      chip({ kind: 'backlink', label: '反链', text: '反'.repeat(2000) }),
    ];
    const result = assembleChatContext(chips, 500);
    expect(result.truncated).toBe(true);
    // 选区始终保留
    expect(result.contextBlock).toContain('【当前选区');
    // 高优先级文档有部分内容；最低优先级反链被挤出
    expect(result.contextBlock).toContain('已截断');
    expect(result.contextBlock).not.toContain('【相关笔记（反向链接）');
  });

  it('空 chips 返回空上下文', () => {
    const result = assembleChatContext([], 1000);
    expect(result.contextBlock).toBe('');
    expect(result.truncated).toBe(false);
    expect(result.totalTokens).toBe(0);
  });
});
