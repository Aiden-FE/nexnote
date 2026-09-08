import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { VaultCloneController } from '../src/vault/vault-clone-controller';
import { VaultOperationsController } from '../src/vault/vault-operations-controller';

/**
 * 模拟 app.on('web-contents-created') 生命周期接线的最小模型，
 * 验证 destroyed 事件触发时两个控制器都调用了 disposeSender。
 */
describe('sender 生命周期回收（web-contents destroyed → disposeSender）', () => {
  it('destroyed 事件触发时 vaultOperations.disposeSender 被调用', () => {
    const ops = new VaultOperationsController();
    const senderId = 42;
    ops.start(senderId, 'create');

    // 模拟 destroyed 事件触发 disposeSender（与 index.ts 中 web-contents-created 接线一致）
    const mockContents = new EventEmitter() as EventEmitter & { id: number };
    mockContents.id = senderId;
    mockContents.on('destroyed', () => {
      ops.disposeSender(mockContents.id);
    });

    // 触发销毁
    mockContents.emit('destroyed');

    // 验证：操作已释放
    expect(ops.cancel(senderId, 'nonexistent')).toBe(false); // 没有可取消的
    // 启动另一个操作应能正常工作（sender 已被清理）
    const { signal } = ops.start(senderId, 'open');
    expect(signal.aborted).toBe(false);
    ops.disposeSender(senderId);
  });

  it('destroyed 事件触发时 vaultClones.disposeSender 被调用', () => {
    const clones = new VaultCloneController();
    const senderId = 7;
    const token = clones.createToken(senderId, 'https://example.com/repo.git', '/tmp/target');
    expect(clones._size()).toBe(1);

    // 模拟 destroyed 事件触发 disposeSender（与 index.ts 中接线一致）
    const mockContents = new EventEmitter() as EventEmitter & { id: number };
    mockContents.id = senderId;
    mockContents.on('destroyed', () => {
      clones.disposeSender(mockContents.id);
    });

    // 触发销毁
    mockContents.emit('destroyed');

    // 验证：令牌已销毁
    expect(clones._size()).toBe(0);
    expect(clones.consume(token, senderId, 'https://example.com/repo.git', '/tmp/target')).toEqual({
      ok: false,
      reason: 'INVALID_TOKEN',
    });
  });

  it('双控制器接线：destroyed 同时清理 operations 和 clones', () => {
    const ops = new VaultOperationsController();
    const clones = new VaultCloneController();
    const senderId = 99;

    // 创建操作 + 令牌
    ops.start(senderId, 'clone');
    clones.createToken(senderId, 'url', '/dir');
    expect(clones._size()).toBe(1);

    // 模拟 index.ts 中的 web-contents-created 接线模式
    const mockContents = new EventEmitter() as EventEmitter & { id: number };
    mockContents.id = senderId;
    mockContents.on('destroyed', () => {
      ops.disposeSender(mockContents.id);
      clones.disposeSender(mockContents.id);
    });

    // 触发销毁
    mockContents.emit('destroyed');

    // 两者都清理
    expect(clones._size()).toBe(0);
    expect(ops.cancel(senderId, 'anything')).toBe(false);
  });

  it('销毁后同 ID 重新创建 sender 不会与旧状态冲突', () => {
    const ops = new VaultOperationsController();
    const clones = new VaultCloneController();
    const senderId = 1;

    // 第一轮：创建 + 销毁
    const oldOp = ops.start(senderId, 'create');
    const oldToken = clones.createToken(senderId, 'old', '/old');
    const mockContents1 = new EventEmitter() as EventEmitter & { id: number };
    mockContents1.id = senderId;
    mockContents1.on('destroyed', () => {
      ops.disposeSender(senderId);
      clones.disposeSender(senderId);
    });
    mockContents1.emit('destroyed');

    // 第二轮：同一 senderId 重新创建（模拟新的 webContents 复用 ID）
    const newOp = ops.start(senderId, 'clone');
    const newToken = clones.createToken(senderId, 'new', '/new');

    expect(newOp.operationId).not.toBe(oldOp.operationId);
    expect(newToken).not.toBe(oldToken);
    // 新令牌可消费
    expect(clones.consume(newToken, senderId, 'new', '/new')).toEqual({ ok: true });
    // 旧操作已中止
    expect(oldOp.signal.aborted).toBe(true);
    // 新操作未中止
    expect(newOp.signal.aborted).toBe(false);

    // 再销毁一次
    const mockContents2 = new EventEmitter() as EventEmitter & { id: number };
    mockContents2.id = senderId;
    mockContents2.on('destroyed', () => {
      ops.disposeSender(senderId);
      clones.disposeSender(senderId);
    });
    mockContents2.emit('destroyed');

    expect(newOp.signal.aborted).toBe(true);
    expect(clones._size()).toBe(0);
  });
});
