import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { FsChangeEvent } from '@nexnote/shared';

const { watchMock } = vi.hoisted(() => ({ watchMock: vi.fn() }));
vi.mock('chokidar', () => ({ watch: (...args: unknown[]) => watchMock(...args) }));

import { VaultWatchService } from '../src/fs/watch-service';

class FakeWatcher extends EventEmitter {
  close = vi.fn(async () => undefined);
}

describe('VaultWatchService sync 失败传播（mock chokidar）', () => {
  it('初始扫描 error 时 sync() reject，不把“已就绪”当成功', async () => {
    const watcher = new FakeWatcher();
    watchMock.mockReturnValueOnce(watcher);
    const service = new VaultWatchService({
      getRoot: () => '/vault',
      emit: () => undefined as unknown as FsChangeEvent,
    });

    const pending = service.sync();
    await new Promise((resolve) => setTimeout(resolve, 0)); // 等 runSync 注册监听后再注入 error
    watcher.emit('error', new Error('EACCES watch denied'));
    await expect(pending).rejects.toThrow('EACCES watch denied');
    expect(service.watched).toBeNull();
    expect(watcher.close).toHaveBeenCalledOnce();
  });

  it('ready 事件发出之前 sync() 不得 resolve', async () => {
    const watcher = new FakeWatcher();
    watchMock.mockReturnValueOnce(watcher);
    const service = new VaultWatchService({
      getRoot: () => '/vault',
      emit: () => undefined as unknown as FsChangeEvent,
    });

    let settled = false;
    const pending = service.sync().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    watcher.emit('ready');
    await pending;
    expect(settled).toBe(true);
    await service.stop();
  });

  it('sync 失败后再次 sync 仍可执行（串行链不被前次失败卡死）', async () => {
    const failing = new FakeWatcher();
    const healthy = new FakeWatcher();
    watchMock.mockReturnValueOnce(failing).mockReturnValueOnce(healthy);
    let root: string | null = '/vault';
    const service = new VaultWatchService({ getRoot: () => root, emit: () => undefined });

    const first = service.sync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    failing.emit('error', new Error('boom'));
    await expect(first).rejects.toThrow('boom');
    expect(service.watched).toBeNull();

    // 不显式 stop；失败路径必须已清理自身，下次同 root sync 要真正新建 watcher。
    const second = service.sync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    healthy.emit('ready');
    await expect(second).resolves.toBeUndefined();
    expect(service.watched).toBe('/vault');
    root = null;
    await service.sync();
    expect(service.watched).toBeNull();
  });
});
