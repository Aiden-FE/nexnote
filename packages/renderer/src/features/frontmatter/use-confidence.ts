import { useEffect, useState } from 'react';
import type { ConfidenceResult } from '@nexnote/shared';
import { invoke, onEvent } from '../../lib/ipc';

/** DEV-008 keeps scores in SQLite; the panel reads a cache snapshot and never writes frontmatter. */
export function useConfidence(pageId: number | null): ConfidenceResult | null {
  const [state, setState] = useState<{ pageId: number | null; result: ConfidenceResult | null }>({
    pageId: null,
    result: null,
  });

  useEffect(() => {
    if (pageId === null) return;
    let alive = true;
    const load = (): void => {
      void invoke('index:confidence', { pageId })
        .then((result) => {
          if (alive) setState({ pageId, result });
        })
        .catch(() => {
          if (alive) setState({ pageId, result: null });
        });
    };
    load();
    const off = onEvent('index:confidenceChanged', () => load());
    return () => {
      alive = false;
      off();
    };
  }, [pageId]);

  return state.pageId === pageId ? state.result : null;
}
