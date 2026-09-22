import { describe, expect, it } from 'vitest';
import {
  reduceSyncProgress,
  conflictHoverText,
  initialPhaseMessage,
  isBusyPhase,
  SYNC_CLEAR_AFTER_MS,
} from '../src/features/git/state-machine';

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
    expect(initialPhaseMessage('fetching')).toContain('拉取');
    expect(initialPhaseMessage('rebasing')).toContain('对齐');
    expect(initialPhaseMessage('merging')).toContain('合并');
    expect(initialPhaseMessage('pushing')).toContain('推送');
  });

  it('conflictHoverText: no files falls back to actionable message', () => {
    const text = conflictHoverText({ conflict: true });
    expect(text).toContain('冲突');
    expect(text).toContain('点击');
    expect(text).toContain('诊断');
  });

  it('conflictHoverText: lists conflict files when provided', () => {
    const text = conflictHoverText({ conflict: true }, ['a.md', 'b.md']);
    expect(text).toContain('a.md');
    expect(text).toContain('b.md');
  });

  it('conflictHoverText: truncates long lists with count suffix', () => {
    const files = Array.from({ length: 8 }, (_, i) => `f${i}.md`);
    const text = conflictHoverText({ conflict: true }, files);
    // 只显示前 5 个 + 总数
    expect(text).toContain('f4.md');
    expect(text).not.toContain('f5.md');
    expect(text).toContain('等 8 个');
  });

  it('conflictHoverText: empty when no conflict', () => {
    expect(conflictHoverText({ conflict: false })).toBe('');
  });
});
