import { beforeEach, describe, expect, it } from 'vitest';
// @vitest-environment happy-dom
import { useIndexStore } from '../src/stores/index-store';

type BridgeResult = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };

beforeEach(() => {
  useIndexStore.getState().reset();
});

describe('index tag loading', () => {
  it('clears stale tags and exposes error state for legacy fallback', async () => {
    useIndexStore.setState({ tags: [{ tag: 'stale', pageCount: 1, descendantPageCount: 1, path: ['stale'] }] });
    (window as unknown as { nexnote: { invoke: () => Promise<BridgeResult> } }).nexnote = {
      invoke: async () => ({ ok: false, error: { code: 'INDEX_DOWN', message: 'down' } }),
    };
    await useIndexStore.getState().loadTags();
    expect(useIndexStore.getState().tags).toEqual([]);
    expect(useIndexStore.getState().tagsStatus).toBe('error');
  });

  it('reset invalidates a pending load from the previous vault session', async () => {
    let resolve!: (value: BridgeResult) => void;
    (window as unknown as { nexnote: { invoke: () => Promise<BridgeResult> } }).nexnote = {
      invoke: () => new Promise((done) => { resolve = done; }),
    };
    const pending = useIndexStore.getState().loadTags();
    useIndexStore.getState().reset();
    resolve({ ok: true, data: [{ tag: 'old-vault', pageCount: 1, descendantPageCount: 1, path: ['old-vault'] }] });
    await pending;
    expect(useIndexStore.getState().tags).toEqual([]);
    expect(useIndexStore.getState().tagsStatus).toBe('idle');
  });
});
