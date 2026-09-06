import { useEffect, useState } from 'react';
import type { IndexStatus } from '@nexnote/shared';
import { invoke, onEvent } from '../../lib/ipc';

interface LinkCountsState {
  path: string | null;
  in: number;
  out: number;
}

/**
 * DEV-005 ↔ DEV-004 联调：从 Link Index 读取当前页面的真实入链/出链数。
 * 索引每次增量重建完成（index:statusChanged ready）后刷新，保证标签/链接改动实时反映。
 * 计数按 filePath 键控：切页期间不显示上一页的陈旧数据。
 */
export function useLinkCounts(filePath: string | null): { in: number; out: number } {
  const [state, setState] = useState<LinkCountsState>({ path: null, in: 0, out: 0 });

  useEffect(() => {
    if (!filePath) return;
    let alive = true;
    const load = (): void => {
      void invoke('index:pageSummary', { path: filePath })
        .then((summary) => {
          if (alive && summary) {
            setState({ path: filePath, in: summary.inboundLinks, out: summary.outboundLinks });
          }
        })
        .catch(() => undefined);
    };
    load();
    const off = onEvent('index:statusChanged', (status: IndexStatus) => {
      if (status.phase === 'ready') load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [filePath]);

  return state.path === filePath ? { in: state.in, out: state.out } : { in: 0, out: 0 };
}
