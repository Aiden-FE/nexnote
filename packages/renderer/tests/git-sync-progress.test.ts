import { describe, expect, it } from 'vitest';
import { CATALOGS, setCurrentLanguage, translate } from '@nexnote/shared';
import {
  reduceSyncProgress,
  conflictHoverText,
  initialPhaseMessage,
  isBusyPhase,
  SYNC_CLEAR_AFTER_MS,
} from '../src/features/git/state-machine';

const text = (language: 'zh-CN' | 'en-US', key: string, params?: Record<string, string | number>) =>
  translate(CATALOGS[language], key, language, params);

describe('DEV-076 git sync state machine', () => {
  const doneResult = reduceSyncProgress({ phase: null, phaseMessage: null }, { phase: 'done', message: null });

  it('isBusyPhase: done and error are both terminal (not busy)', () => {
    expect(isBusyPhase('fetching')).toBe(true);
    expect(isBusyPhase('rebasing')).toBe(true);
    expect(isBusyPhase('merging')).toBe(true);
    expect(isBusyPhase('pushing')).toBe(true);
    expect(isBusyPhase('done')).toBe(false);
    expect(isBusyPhase('error')).toBe(false);
    expect(isBusyPhase(null)).toBe(false);
  });

  it('reduceSyncProgress on done returns clearAfterMs, so renderer ends spinner', () => {
    expect(doneResult.phase).toBe('done');
    expect(doneResult.clearAfterMs).toBe(SYNC_CLEAR_AFTER_MS);
  });

  it('reduceSyncProgress on error is a terminal state and ends spinner', () => {
    const result = reduceSyncProgress(
      { phase: 'fetching', phaseMessage: '正在拉取…' },
      { phase: 'error', message: 'CONFLICT: merge conflict detected' },
    );
    expect(result.phase).toBe('error');
    expect(result.clearAfterMs).toBe(SYNC_CLEAR_AFTER_MS);
    expect(isBusyPhase(result.phase)).toBe(false);
  });

  it('progress stages do not request clear (phase remains visible)', () => {
    const result = reduceSyncProgress(
      { phase: 'fetching', phaseMessage: '...' },
      { phase: 'pushing', message: '正在推送…' },
    );
    expect(result.phase).toBe('pushing');
    expect(result.clearAfterMs).toBeNull();
    expect(isBusyPhase(result.phase)).toBe(true);
  });

  it('initialPhaseMessage has text for every non-terminal phase', () => {
    expect(initialPhaseMessage('fetching')).toBe(text('zh-CN', 'git.progress.fetching'));
    expect(initialPhaseMessage('rebasing')).toBe(text('zh-CN', 'git.progress.rebasing'));
    expect(initialPhaseMessage('merging')).toBe(text('zh-CN', 'git.progress.merging'));
    expect(initialPhaseMessage('pushing')).toBe(text('zh-CN', 'git.progress.pushing'));
  });

  it('conflictHoverText: no files falls back to actionable message', () => {
    const hover = conflictHoverText({ conflict: true });
    expect(hover).toContain(text('zh-CN', 'git.conflict.base'));
    expect(hover).toContain(text('zh-CN', 'git.conflict.openDiagnostics'));
  });

  it('conflictHoverText: lists conflict files when provided', () => {
    const hover = conflictHoverText({ conflict: true }, ['a.md', 'b.md']);
    expect(hover).toContain('a.md');
    expect(hover).toContain('b.md');
  });

  it('conflictHoverText: truncates long lists with count suffix', () => {
    const files = Array.from({ length: 8 }, (_, i) => `f${i}.md`);
    const hover = conflictHoverText({ conflict: true }, files);
    // 只显示前 5 个 + 总数
    expect(hover).toContain('f4.md');
    expect(hover).not.toContain('f5.md');
    expect(hover).toContain(text('zh-CN', 'git.conflict.moreFiles', { count: 8 }));
  });

  it('conflictHoverText: empty when no conflict', () => {
    expect(conflictHoverText({ conflict: false })).toBe('');
  });

  it('en-US progress and conflict hover are catalog-driven without CJK (ADR-0023)', () => {
    setCurrentLanguage('en-US');
    try {
      for (const phase of ['fetching', 'rebasing', 'merging', 'pushing'] as const) {
        expect(initialPhaseMessage(phase), phase).toBe(
          text('en-US', `git.progress.${phase}`),
        );
      }
      const empty = conflictHoverText({ conflict: true });
      expect(empty).toContain(text('en-US', 'git.conflict.base'));
      expect(empty).toContain(text('en-US', 'git.conflict.openDiagnostics'));
      const listed = conflictHoverText({ conflict: true }, ['a.md', 'b.md']);
      expect(listed).toContain('a.md');
      expect(listed).toContain('b.md');
      const files = Array.from({ length: 8 }, (_, i) => `f${i}.md`);
      const truncated = conflictHoverText({ conflict: true }, files);
      expect(truncated).toContain(text('en-US', 'git.conflict.moreFiles', { count: 8 }));
      expect([empty, listed, truncated].join('\n')).not.toMatch(/[\u4e00-\u9fff]/);
    } finally {
      setCurrentLanguage('zh-CN');
    }
  });
});
