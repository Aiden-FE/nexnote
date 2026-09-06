import { beforeEach, describe, expect, it } from 'vitest';
// @vitest-environment happy-dom
import { useIndexStore } from '../src/stores/index-store';

type BridgeResult = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };

beforeEach(() => {
  useIndexStore.getState().reset();
});

describe('index async loading', () => {
  it('clears stale tags and exposes error state for legacy fallback', async () => {
    useIndexStore.setState({ tags: [{ tag: 'stale', pageCount: 1, descendantPageCount: 1, path: ['stale'] }] });
    (window as unknown as { nexnote: { invoke: () => Promise<BridgeResult> } }).nexnote = {
      invoke: async () => ({ ok: false, error: { code: 'INDEX_DOWN', message: 'down' } }),
    };
    await useIndexStore.getState().loadTags();
    expect(useIndexStore.getState().tags).toEqual([]);
    expect(useIndexStore.getState().tagsStatus).toBe('error');
  });

  it('reset invalidates backlinks from the previous vault even for the same page path', async () => {
    let resolve!: (value: BridgeResult) => void;
    (window as unknown as { nexnote: { invoke: () => Promise<BridgeResult> } }).nexnote = {
      invoke: () => new Promise((done) => { resolve = done; }),
    };
    const pending = useIndexStore.getState().loadBacklinks('same.md');
    useIndexStore.getState().reset();
    // New vault happens to have the same path; the old result must remain invalid.
    useIndexStore.setState({ backlinksFor: 'same.md', backlinksStatus: 'loading' });
    resolve({ ok: true, data: [{ fromPath: 'old.md' }] });
    await pending;
    expect(useIndexStore.getState().backlinks).toEqual([]);
    expect(useIndexStore.getState().backlinksStatus).toBe('loading');
  });

  it('reset invalidates a pending tag load from the previous vault session', async () => {
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

  it('loads the graph once and marks it stale when the index becomes ready', async () => {
    const graph = { pages: [], links: [] };
    (window as unknown as { nexnote: { invoke: () => Promise<BridgeResult> } }).nexnote = {
      invoke: async () => ({ ok: true, data: graph }),
    };
    await useIndexStore.getState().loadGraph();
    expect(useIndexStore.getState().graph).toBe(graph);
    expect(useIndexStore.getState().graphStatus).toBe('ready');

    useIndexStore.getState().applyStatusEvent({
      phase: 'ready',
      pagesTotal: 1,
      pagesIndexed: 1,
      mode: 'incremental',
    });
    expect(useIndexStore.getState().graph).toBe(graph);
    expect(useIndexStore.getState().graphStatus).toBe('stale');
  });

  it('reset invalidates a pending graph load from the previous vault session', async () => {
    let resolve!: (value: BridgeResult) => void;
    (window as unknown as { nexnote: { invoke: () => Promise<BridgeResult> } }).nexnote = {
      invoke: () => new Promise((done) => { resolve = done; }),
    };
    const pending = useIndexStore.getState().loadGraph();
    useIndexStore.getState().reset();
    resolve({ ok: true, data: { pages: [{ path: 'old.md' }], links: [] } });
    await pending;
    expect(useIndexStore.getState().graph).toEqual({ pages: [], links: [] });
    expect(useIndexStore.getState().graphStatus).toBe('idle');
  });
});
