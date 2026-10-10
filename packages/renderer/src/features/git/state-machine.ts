/**
 * GitStatusItem 的状态纯函数（DEV-076）。
 *
 * 抽出 spinner 收尾、doctor 触发、hover 文案的核心判断，
 * 让单元测试不依赖 React 渲染就能覆盖「error 终态收尾」、
 * 「冲突 hover 有内容」这类验收点。
 */

import type { GitStatus } from '@nexnote/shared';
import { tCurrent } from '@nexnote/shared';

export type SyncPhase = 'fetching' | 'rebasing' | 'merging' | 'pushing' | 'done' | 'error';

export interface SyncState {
  phase: SyncPhase | null;
  phaseMessage: string | null;
}

export interface SyncProgressInput {
  phase: SyncPhase;
  message: string | null;
}

export interface SyncProgressResult extends SyncState {
  /**
   * 若需要延迟清理（done/error 都收尾），返回毫秒数；否则 null 表示不清理。
   * renderer 收到非 null 值时 setTimeout 把 phase 重置为 null。
   */
  clearAfterMs: number | null;
}

/** 状态栏 spinner 是否处于"进行中"（非终态）。 */
export function isBusyPhase(phase: SyncPhase | null): boolean {
  return phase !== null && phase !== 'done' && phase !== 'error';
}

/** 终态进入后，多少毫秒内清掉 spinner。done 保留 600ms 给用户感知，error 也按相同节奏收尾。 */
export const SYNC_CLEAR_AFTER_MS = 600;

export function initialPhaseMessage(phase: SyncPhase): string {
  switch (phase) {
    case 'fetching':
      return tCurrent('git.progress.fetching');
    case 'rebasing':
      return tCurrent('git.progress.rebasing');
    case 'merging':
      return tCurrent('git.progress.merging');
    case 'pushing':
      return tCurrent('git.progress.pushing');
    default:
      return tCurrent('git.status.syncing');
  }
}

/**
 * 处理 git:syncProgress 事件。done 与 error 都是终态：
 * 任何终态都会请求清理（clearAfterMs），渲染层据此结束 spinner。
 */
export function reduceSyncProgress(current: SyncState, input: SyncProgressInput): SyncProgressResult {
  const phase = input.phase;
  const phaseMessage = input.message ?? initialPhaseMessage(phase);
  if (phase === 'done' || phase === 'error') {
    return { phase, phaseMessage, clearAfterMs: SYNC_CLEAR_AFTER_MS };
  }
  return { phase, phaseMessage, clearAfterMs: null };
}

/**
 * 冲突徽标的 hover 文案。需要"实质内容"而非空泛一句话：
 * 至少包含「N 个冲突文件」与文件列表；文件过多时截断并追加「等 N 个」。
 */
export function conflictHoverText(
  status: Pick<GitStatus, 'conflict'>,
  conflictFiles: string[] = [],
): string {
  if (!status.conflict) return '';
  const base = tCurrent('git.conflict.base');
  if (conflictFiles.length === 0)
    return `${base}${tCurrent('git.conflict.titleEnd')}${tCurrent('git.conflict.openDiagnostics')}${tCurrent('git.conflict.titleEnd')}`;
  const MAX_INLINE = 5;
  const shown = conflictFiles.slice(0, MAX_INLINE);
  const suffix =
    conflictFiles.length > MAX_INLINE
      ? tCurrent('git.conflict.moreFiles', { count: conflictFiles.length })
      : '';
  return `${base}${tCurrent('git.conflict.titleSeparator')}${shown.join(tCurrent('git.conflict.listSeparator'))}${suffix}${tCurrent('git.conflict.titleEnd')}${tCurrent('git.conflict.openDiagnostics')}${tCurrent('git.conflict.titleEnd')}`;
}

/**
 * 诊断完成后是否应自动弹出 DoctorDialog。
 * 冲突徽标点击、同步失败、doctor 触发三种入口共用：诊断可用即弹出。
 */
export function shouldShowDoctorDialog(diagnosis: unknown): boolean {
  return diagnosis != null;
}
