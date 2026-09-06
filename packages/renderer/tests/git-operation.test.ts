import { describe, expect, it, vi } from 'vitest';
import { invokeSyncOperation } from '../src/features/git/operation';

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
});
