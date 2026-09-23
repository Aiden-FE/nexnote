// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('binary host flush save queue (DEV-074)', () => {
  afterEach(() => {
    vi.resetModules();
    delete (window as unknown as { nexnote?: unknown }).nexnote;
  });

  it('flush waits for edits made while a previous save is in flight', async () => {
    const commands: Array<(payload: unknown) => void> = [];
    const saves: Array<ReturnType<typeof deferred<{ sha256: string }>>> = [];
    const savePayloads: unknown[] = [];
    (window as unknown as { nexnote: unknown }).nexnote = {
      invoke: vi.fn((channel: string, payload?: unknown) => {
        if (channel === 'binary:read') {
          return Promise.resolve({
            ok: true,
            data: { data: { kind: 'xlsx', sheets: [{ name: 'Sheet1' }] }, sha256: 'base', readonly: [] },
          });
        }
        if (channel === 'binary:save') {
          savePayloads.push(payload);
          const next = deferred<{ sha256: string }>();
          saves.push(next);
          return next.promise.then((result) => ({ ok: true, data: result }));
        }
        throw new Error(`unexpected IPC: ${channel}`);
      }),
      on: vi.fn((_channel: string, callback: (payload: unknown) => void) => {
        commands.push(callback);
        return () => undefined;
      }),
    };

    const sessionModule = await import('../src/binary-host/session');
    const stop = sessionModule.bootstrapBinaryHost();
    commands[0]?.({ command: 'load', kind: 'xlsx', path: 'notes/a.xlsx' });
    await vi.waitFor(() => expect(sessionModule.getSession()?.path).toBe('notes/a.xlsx'));

    sessionModule.markDirty({ sheets: [{ name: 'first edit' }] });
    const flush = sessionModule.flushPending();
    await vi.waitFor(() => expect(saves).toHaveLength(1));

    // A newer edit arrives after flush started but while save #1 is pending.
    sessionModule.markDirty({ sheets: [{ name: 'last edit' }] });
    saves[0]!.resolve({ sha256: 'first-sha' });
    await vi.waitFor(() => expect(saves).toHaveLength(2));

    expect(
      (savePayloads[1] as { data: { sheets: Array<{ name: string }> } }).data.sheets[0]?.name,
    ).toBe('last edit');
    let flushed = false;
    void flush.then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);

    saves[1]!.resolve({ sha256: 'last-sha' });
    await expect(flush).resolves.toBeUndefined();
    expect(flushed).toBe(true);
    stop();
  });
});
