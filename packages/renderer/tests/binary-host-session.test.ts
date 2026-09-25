// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('binary host flush save queue (DEV-074)', () => {
  afterEach(() => {
    vi.resetModules();
    delete (window as unknown as { nexnote?: unknown }).nexnote;
  });

  it('BINARY_CONFLICT retains dirty edits and rejects close flushes instead of resolving', async () => {
    const commands: Array<(payload: unknown) => void> = [];
    const savePayloads: unknown[] = [];
    (window as unknown as { nexnote: unknown }).nexnote = {
      invoke: vi.fn((channel: string, payload?: unknown) => {
        if (channel === 'binary:read') {
          return Promise.resolve({
            ok: true,
            data: {
              data: { kind: 'xlsx', sheets: [{ name: 'Sheet1' }] },
              sha256: 'base',
              readonly: [],
            },
          });
        }
        if (channel === 'binary:save') {
          savePayloads.push(payload);
          return Promise.resolve({
            ok: false,
            error: 'external edit detected',
            code: 'BINARY_CONFLICT',
          });
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
    commands[0]?.({ command: 'load', kind: 'xlsx', path: 'notes/conflict.xlsx' });
    await vi.waitFor(() => expect(sessionModule.getSession()?.path).toBe('notes/conflict.xlsx'));

    sessionModule.markDirty({ sheets: [{ name: 'local edit' }] });
    await expect(sessionModule.flushPending()).rejects.toMatchObject({ code: 'BINARY_CONFLICT' });
    expect(sessionModule.getSession()?.conflict).toBe(true);
    expect(savePayloads).toHaveLength(1);

    sessionModule.markDirty({ sheets: [{ name: 'newer local edit' }] });
    await expect(sessionModule.flushPending()).rejects.toMatchObject({ code: 'BINARY_CONFLICT' });
    expect(savePayloads).toHaveLength(1);

    await sessionModule.reloadAfterConflict();
    expect(sessionModule.getSession()).toMatchObject({ conflict: false, sha256: 'base' });
    await expect(sessionModule.flushPending()).resolves.toBeUndefined();
    stop();
  });
});
