import { describe, expect, it } from 'vitest';
import { VaultCloneController } from '../src/vault/vault-clone-controller';
import { VaultOperationsController } from '../src/vault/vault-operations-controller';

describe('VaultOperationsController', () => {
  it('start 返回 operationId + 可中止的 signal', () => {
    const c = new VaultOperationsController();
    const { operationId, signal } = c.start(1, 'create');
    expect(operationId).toBeTruthy();
    expect(signal.aborted).toBe(false);
    c.cancel(1, operationId);
    expect(signal.aborted).toBe(true);
  });

  it('cancel 只取消匹配 sender 的 operation', () => {
    const c = new VaultOperationsController();
    const a = c.start(1, 'create');
    const b = c.start(2, 'clone');
    expect(c.cancel(1, a.operationId)).toBe(true);
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
  });

  it('cancel 对未知 operationId / 未知 sender 返回 false', () => {
    const c = new VaultOperationsController();
    expect(c.cancel(1, 'unknown-id')).toBe(false);
    expect(c.cancel(99, 'x')).toBe(false);
  });

  it('disposeSender 取消该 sender 全部操作并释放', () => {
    const c = new VaultOperationsController();
    const a = c.start(1, 'create');
    const b = c.start(1, 'open');
    c.disposeSender(1);
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(true);
    expect(c.cancel(1, a.operationId)).toBe(false); // 已释放
  });

  it('finish 释放单个操作，不影响同 sender 其他操作', () => {
    const c = new VaultOperationsController();
    const a = c.start(1, 'create');
    const b = c.start(1, 'open');
    c.finish(1, a.operationId);
    expect(c.cancel(1, a.operationId)).toBe(false); // 已释放
    expect(b.signal.aborted).toBe(false); // 另一个仍在
    expect(c.cancel(1, b.operationId)).toBe(true);
  });
});

describe('VaultCloneController', () => {
  it('createToken 后 consume 成功且一次性', () => {
    const c = new VaultCloneController();
    const token = c.createToken(1, 'https://github.com/a/b.git', '/Users/me');
    expect(c.consume(token, 1, 'https://github.com/a/b.git', '/Users/me')).toEqual({ ok: true });
    // 二次消费失败
    expect(c.consume(token, 1, 'https://github.com/a/b.git', '/Users/me')).toMatchObject({
      ok: false,
      reason: 'INVALID_TOKEN',
    });
  });

  it('consume 绑定 sender：其他 sender 无法消费', () => {
    const c = new VaultCloneController();
    const token = c.createToken(1, 'url', '/tmp');
    expect(c.consume(token, 2, 'url', '/tmp')).toEqual({ ok: false, reason: 'SENDER_MISMATCH' });
    // 原 sender 仍可消费
    expect(c.consume(token, 1, 'url', '/tmp')).toEqual({ ok: true });
  });

  it('consume 校验 url / targetDir 完全匹配', () => {
    const c = new VaultCloneController();
    const token = c.createToken(1, 'https://github.com/a/b.git', '/Users/me');
    expect(c.consume(token, 1, 'https://github.com/a/b.git', '/Users/elsewhere')).toMatchObject({
      ok: false,
      reason: 'PARAM_MISMATCH',
    });
    expect(c.consume(token, 1, 'https://github.com/evil/malicious.git', '/Users/me')).toMatchObject({
      ok: false,
      reason: 'PARAM_MISMATCH',
    });
  });

  it('disposeSender 销毁该 sender 所有令牌', () => {
    const c = new VaultCloneController();
    const t1 = c.createToken(1, 'a', '/x');
    c.createToken(1, 'b', '/xy');
    c.disposeSender(1);
    expect(c.consume(t1, 1, 'a', '/x')).toEqual({ ok: false, reason: 'INVALID_TOKEN' });
  });

  it('令牌库大小受限（每 sender 上限 8，超出驱逐最旧）', () => {
    const c = new VaultCloneController();
    const tokens: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      tokens.push(c.createToken(1, `url-${i}`, `/dir-${i}`));
    }
    expect(c._size()).toBeLessThanOrEqual(8);
    // 最旧的几个已被驱逐，最新的可消费
    const oldest = tokens[0];
    expect(c.consume(oldest, 1, 'url-0', '/dir-0')).toEqual({ ok: false, reason: 'INVALID_TOKEN' });
    const newest = tokens[tokens.length - 1];
    expect(c.consume(newest, 1, `url-${tokens.length - 1}`, `/dir-${tokens.length - 1}`)).toEqual({
      ok: true,
    });
  });
});