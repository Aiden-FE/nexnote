import { describe, expect, it, vi } from 'vitest';
import { invokeSyncOperation, resolveDoctorRecovery } from '../src/features/git/operation';

describe('Git status-bar operations', () => {
  it('uses the pull request callback, whose renderer binding sends {}', async () => {
    const pull = vi.fn(async () => undefined);
    const push = vi.fn(async () => undefined);
    await invokeSyncOperation('pull', { pull, push });
    expect(pull).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
  });

  it('uses the push request callback independently', async () => {
    const pull = vi.fn(async () => undefined);
    const push = vi.fn(async () => undefined);
    await invokeSyncOperation('push', { pull, push });
    expect(push).toHaveBeenCalledOnce();
    expect(pull).not.toHaveBeenCalled();
  });

  it.each([
    ['confirm', 'execute'],
    ['deny', 'dismiss'],
    ['ignore', 'dismiss'],
  ] as const)('doctor recovery %s invokes %s', async (decision, method) => {
    const execute = vi.fn(async () => undefined);
    const dismiss = vi.fn(async () => undefined);
    await resolveDoctorRecovery(decision, { execute, dismiss });
    expect({ execute: execute.mock.calls.length, dismiss: dismiss.mock.calls.length }).toEqual(
      method === 'execute' ? { execute: 1, dismiss: 0 } : { execute: 0, dismiss: 1 },
    );
  });

  it('doctor recovery execute errors propagate without dismissing', async () => {
    const error = new Error('STATE_DRIFT');
    const execute = vi.fn(async () => {
      throw error;
    });
    const dismiss = vi.fn(async () => undefined);
    await expect(resolveDoctorRecovery('confirm', { execute, dismiss })).rejects.toBe(error);
    expect(dismiss).not.toHaveBeenCalled();
  });
});
