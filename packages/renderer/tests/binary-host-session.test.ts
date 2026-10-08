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

    // P0 契约：只有真实用户交互之后的变更才算编辑（见本文件第二个用例）。
    sessionModule.markUserInteraction();
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

  it('载入首帧的 onChange 不算编辑：用户交互前不写盘，交互后才落盘（P0 回归）', async () => {
    // 根因回顾：fortune-sheet / simple-mind-map 在载入数据时会自己 emit 一次
    // onChange（payload 等于刚载入的内容）。宿主若照单全收就会「打开即写盘」——
    // 对 xlsx 更是立刻把磁盘上的表格覆盖掉。
    const commands: Array<(payload: unknown) => void> = [];
    const savePayloads: unknown[] = [];
    (window as unknown as { nexnote: unknown }).nexnote = {
      invoke: vi.fn((channel: string, payload?: unknown) => {
        if (channel === 'binary:read') {
          return Promise.resolve({
            ok: true,
            data: {
              data: {
                kind: 'xlsx',
                sheets: [{ name: 'Sheet1', celldata: [{ r: 0, c: 0, v: { v: 'x' } }] }],
              },
              sha256: 'base',
              readonly: [],
            },
          });
        }
        if (channel === 'binary:save') {
          savePayloads.push(payload);
          return Promise.resolve({ ok: true, data: { sha256: 'next' } });
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
    commands[0]?.({ command: 'load', kind: 'xlsx', path: 'notes/first.xlsx' });
    await vi.waitFor(() => expect(sessionModule.getSession()?.path).toBe('notes/first.xlsx'));

    // 载入回调：内容与磁盘一致，不得落盘。
    sessionModule.markDirty({ sheets: [{ name: 'Sheet1', data: [[{ v: 'x' }]] }] });
    await expect(sessionModule.flushPending()).resolves.toBeUndefined();
    expect(savePayloads).toHaveLength(0);

    // 真实用户交互之后的变更才允许写盘。
    sessionModule.markUserInteraction();
    sessionModule.markDirty({ sheets: [{ name: 'Sheet1', data: [[{ v: 'edited' }]] }] });
    await expect(sessionModule.flushPending()).resolves.toBeUndefined();
    expect(savePayloads).toHaveLength(1);

    // 切换文档后交互标记重置：新文档的载入回调同样不能触发写盘。
    commands[0]?.({ command: 'load', kind: 'xlsx', path: 'notes/second.xlsx' });
    await vi.waitFor(() => expect(sessionModule.getSession()?.path).toBe('notes/second.xlsx'));
    sessionModule.markDirty({ sheets: [{ name: 'Sheet1', data: [[{ v: 'x' }]] }] });
    await expect(sessionModule.flushPending()).resolves.toBeUndefined();
    expect(savePayloads).toHaveLength(1);
    stop();
  });
});
