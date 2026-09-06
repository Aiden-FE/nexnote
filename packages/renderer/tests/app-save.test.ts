import { describe, expect, it, vi } from 'vitest';
import { registerAppSaveListener, requestAppSave } from '../src/editor/app-save';

describe('app-wide editor save workflow', () => {
  it('waits for every mounted EditorView flush before resolving', async () => {
    const target = new EventTarget();
    let finishFirst!: () => void;
    const first = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const second = vi.fn(async () => undefined);
    const unregisterFirst = registerAppSaveListener(target, first);
    const unregisterSecond = registerAppSaveListener(target, second);

    let resolved = false;
    const saving = requestAppSave(target).then(() => {
      resolved = true;
    });
    await Promise.resolve();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(resolved).toBe(false);

    finishFirst();
    await saving;
    expect(resolved).toBe(true);

    unregisterFirst();
    unregisterSecond();
  });

  it('unregistered editors no longer participate in saves', async () => {
    const target = new EventTarget();
    const flush = vi.fn(async () => undefined);
    const unregister = registerAppSaveListener(target, flush);
    unregister();

    await requestAppSave(target);
    expect(flush).not.toHaveBeenCalled();
  });
});
