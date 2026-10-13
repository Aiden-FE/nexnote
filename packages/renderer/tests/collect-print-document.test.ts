import { describe, expect, it } from 'vitest';
import { useTabStore } from '../src/stores/tab-store';
import { printActiveDocument } from '../src/print/collect-print-document';

describe('printActiveDocument routing', () => {
  it('does not print non-page tabs', async () => {
    const tab = useTabStore.getState().tabs[0];
    expect(tab?.kind).not.toBe('page');
    await expect(printActiveDocument()).resolves.toBeUndefined();
  });
});
