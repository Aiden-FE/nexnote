import { describe, expect, it, vi } from 'vitest';

interface FakeWebContents {
  id: number;
  send: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  setWindowOpenHandler: ReturnType<typeof vi.fn>;
  session: { setPermissionRequestHandler: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  executeJavaScript: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const createdViews: Array<{
  webContents: FakeWebContents;
  setBounds: ReturnType<typeof vi.fn>;
}> = [];
let nextWebContentsId = 1;

vi.mock('electron', () => ({
  WebContentsView: class {
    webContents: FakeWebContents;
    setBounds = vi.fn();
    constructor() {
      this.webContents = {
        id: nextWebContentsId++,
        send: vi.fn(),
        isDestroyed: vi.fn(() => false),
        setWindowOpenHandler: vi.fn(),
        session: { setPermissionRequestHandler: vi.fn() },
        on: vi.fn(),
        once: vi.fn(),
        off: vi.fn(),
        loadURL: vi.fn(async () => undefined),
        loadFile: vi.fn(async () => undefined),
        executeJavaScript: vi.fn(async () => undefined),
        close: vi.fn(),
      };
      createdViews.push(this);
    }
  },
}));

import { BinaryEditorHostManager } from '../src/binary/binary-editor-host';

function windowStub() {
  const children: unknown[] = [];
  const win = {
    isDestroyed: vi.fn(() => false),
    on: vi.fn(),
    getContentBounds: vi.fn(() => ({ x: 0, y: 0, width: 900, height: 600 })),
    contentView: {
      children,
      addChildView: vi.fn((view: unknown) => children.push(view)),
      removeChildView: vi.fn((view: unknown) => {
        const index = children.indexOf(view);
        if (index >= 0) children.splice(index, 1);
      }),
    },
  };
  return win;
}

describe('binary host lifecycle and bounds (DEV-074)', () => {
  it('queues load until renderer ack ready, drains only then', async () => {
    const manager = new BinaryEditorHostManager();
    const win = windowStub();
    manager.attach(win as never);

    await manager.open('xlsx', 'sheet.xlsx');
    const view = createdViews.at(-1)!;
    expect(view.webContents.send).not.toHaveBeenCalled();
    expect(win.contentView.addChildView).not.toHaveBeenCalled();

    // open() only creates the host; activation and bounds are driven by the parent.
    manager.setActive('xlsx', 'sheet.xlsx');
    manager.setBounds('xlsx', 'sheet.xlsx', { x: 240, y: 82, width: 550, height: 400 });
    expect(win.contentView.addChildView).toHaveBeenCalledTimes(1);
    expect(view.setBounds).toHaveBeenCalledWith({ x: 240, y: 82, width: 550, height: 400 });

    // Renderer-provided coordinates are clamped to the BrowserWindow content rect.
    manager.setBounds('xlsx', 'sheet.xlsx', { x: 850, y: 570, width: 200, height: 100 });
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 850, y: 570, width: 50, height: 30 });
    manager.setBounds('xlsx', 'sheet.xlsx', { x: 0, y: 0, width: 0, height: 0 });
    expect(win.contentView.removeChildView).toHaveBeenCalledTimes(1);

    // 关键差异：did-finish-load 不再触发 drain；只有 ack 才会。
    const finishLoad = view.webContents.on.mock.calls.find(
      ([event]) => event === 'did-finish-load',
    )?.[1];
    expect(finishLoad).toBeTypeOf('function');
    finishLoad();
    expect(view.webContents.send).not.toHaveBeenCalled();

    // Pull 模型：ack 返回排队的初始命令（页面在订阅之后应用），不走 webContents.send。
    const drained = manager.acknowledgeReady(view.webContents.id);
    expect(drained).toEqual([{ command: 'load', kind: 'xlsx', path: 'sheet.xlsx' }]);
    expect(view.webContents.send).not.toHaveBeenCalled();

    manager.setBounds('xlsx', 'sheet.xlsx', null);
    expect(win.contentView.removeChildView).toHaveBeenCalledTimes(1);
    manager.destroyAll();
  });

  it('delayed bootstrap: flush waits for ack, executes flush hook after ack, rejects on timeout', async () => {
    vi.useFakeTimers();
    try {
      const manager = new BinaryEditorHostManager();
      const win = windowStub();
      manager.attach(win as never);

      await manager.open('xlsx', 'late.xlsx');
      const view = createdViews.at(-1)!;
      manager.setActive('xlsx', 'late.xlsx');

      // 第一次：ack 之前调 flush —— 必须挂起到 ack 到达，再调 host flush 钩子。
      view.webContents.executeJavaScript.mockImplementationOnce(async () => undefined);
      const flushPromise = manager.flush('xlsx:late.xlsx');

      // 推进到 ack 抵达前，executeJavaScript 还未被调用（flush 仍在等待 ack）。
      expect(view.webContents.executeJavaScript).not.toHaveBeenCalled();

      // ack 抵达 → flush 继续 → executeJavaScript 才被调用
      manager.acknowledgeReady(view.webContents.id);
      await flushPromise;
      expect(view.webContents.executeJavaScript).toHaveBeenCalledTimes(1);
      const firstCall = view.webContents.executeJavaScript.mock.calls[0];
      expect(firstCall).toBeDefined();
      expect(String(firstCall![0])).toMatch(/__nexnoteHostFlush/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flush rejects when ack never arrives within timeout', async () => {
    vi.useFakeTimers();
    try {
      const manager = new BinaryEditorHostManager();
      const win = windowStub();
      manager.attach(win as never);

      await manager.open('xlsx', 'never.xlsx');
      const view = createdViews.at(-1)!;
      manager.setActive('xlsx', 'never.xlsx');

      const flushPromise = manager.flush('xlsx:never.xlsx');
      // 立即挂一个 catch，避免 unhandled rejection 干扰后续断言
      const guard = flushPromise.catch((e: unknown) => e);
      // 把定时器走完到 FLUSH_READY_TIMEOUT_MS（1500ms）
      await vi.advanceTimersByTimeAsync(2000);
      const result = await guard;
      expect((result as Error).message).toMatch(/ack/);
      expect(view.webContents.executeJavaScript).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ack is idempotent under senderId', () => {
    const manager = new BinaryEditorHostManager();
    const win = windowStub();
    manager.attach(win as never);
    void manager.open('xlsx', 'idem.xlsx');
    const view = createdViews.at(-1)!;
    manager.setActive('xlsx', 'idem.xlsx');
    const firstDrain = manager.acknowledgeReady(view.webContents.id);
    expect(firstDrain).toEqual([{ command: 'load', kind: 'xlsx', path: 'idem.xlsx' }]);
    // 重复 ack 不重复下发（返回空数组，命令只交付一次）
    expect(manager.acknowledgeReady(view.webContents.id)).toEqual([]);
    // 未知 senderId 直接忽略（不会抛错，返回空数组）
    expect(manager.acknowledgeReady(0)).toEqual([]);
    expect(manager.acknowledgeReady(99999)).toEqual([]);
    manager.destroyAll();
  });

  it('close() preserves the host when pending writes cannot be flushed', async () => {
    const manager = new BinaryEditorHostManager();
    const win = windowStub();
    manager.attach(win as never);
    await manager.open('xlsx', 'unflushed.xlsx');
    const view = createdViews.at(-1)!;
    manager.acknowledgeReady(view.webContents.id);
    view.webContents.executeJavaScript.mockRejectedValueOnce(new Error('flush failed'));

    await expect(manager.close('xlsx', 'unflushed.xlsx')).rejects.toThrow('flush failed');

    expect(manager.size).toBe(1);
    expect(view.webContents.close).not.toHaveBeenCalled();
  });

  it('flushAll() reports failures instead of allowing shutdown to discard pending writes', async () => {
    const manager = new BinaryEditorHostManager();
    const win = windowStub();
    manager.attach(win as never);
    await manager.open('xlsx', 'unflushed-window.xlsx');
    const view = createdViews.at(-1)!;
    manager.acknowledgeReady(view.webContents.id);
    view.webContents.executeJavaScript.mockRejectedValueOnce(new Error('flush failed'));

    await expect(manager.flushAll()).rejects.toThrow('flush failed');

    expect(manager.size).toBe(1);
    expect(view.webContents.close).not.toHaveBeenCalled();
  });

  it('reopening after failed close preserves the live host without reloading its document', async () => {
    const manager = new BinaryEditorHostManager();
    const win = windowStub();
    manager.attach(win as never);
    await manager.open('xlsx', 'retry-close.xlsx');
    const view = createdViews.at(-1)!;
    manager.setActive('xlsx', 'retry-close.xlsx');
    manager.acknowledgeReady(view.webContents.id);
    view.webContents.executeJavaScript.mockRejectedValueOnce(new Error('flush failed'));

    await expect(manager.close('xlsx', 'retry-close.xlsx')).rejects.toThrow('flush failed');
    manager.setActive('xlsx', 'retry-close.xlsx');

    expect(manager.size).toBe(1);
    expect(view.webContents.close).not.toHaveBeenCalled();
    // 初始 load 只交付一次：第一次 ack 已拉走，重开 tab 不会重新 push / 重新交付。
    expect(
      view.webContents.send.mock.calls.filter(([channel]) => channel === 'binary:editorCommand'),
    ).toHaveLength(0);
    expect(manager.acknowledgeReady(view.webContents.id)).toEqual([]);
  });

  it('close() captures entry identity and survives concurrent destroy', async () => {
    const manager = new BinaryEditorHostManager();
    const win = windowStub();
    manager.attach(win as never);
    void manager.open('xlsx', 'doc.xlsx');
    const firstView = createdViews.at(-1)!;
    manager.acknowledgeReady(firstView.webContents.id);

    // 第一次 close 启动：第一次 flush 注入一个挂起 promise。
    let resolveFlush!: (v?: unknown) => void;
    firstView.webContents.executeJavaScript.mockImplementationOnce(
      () =>
        new Promise<unknown>((r) => {
          resolveFlush = r;
        }),
    );
    const closePromise = manager.close('xlsx', 'doc.xlsx');

    // flush 等待期间，另一个 close / destroy 路径已经销毁旧 entry 并清掉 idIndex。
    // 我们模拟：destroyAll 在并发路径执行；idIndex 清掉旧 senderId。
    manager.destroyAll();
    // 此时 map 已空；flush 解除后 close 必须意识到 entry 已不在，不能再 webContents.close()
    resolveFlush();
    await closePromise;

    // 旧的 webContents 不应再被 close 一次（destroy 已经处理过）
    expect(firstView.webContents.close).toHaveBeenCalledTimes(1);
    manager.destroyAll();
  });

  it('slow bootstrap: pending load 不得推送给未订阅的渲染层（「等待加载文档…」卡死回归）', async () => {
    vi.useFakeTimers();
    try {
      const manager = new BinaryEditorHostManager();
      const win = windowStub();
      manager.attach(win as never);

      await manager.open('mindmap', 'slow.xmind');
      const view = createdViews.at(-1)!;
      manager.setActive('mindmap', 'slow.xmind'); // load 进入 pending

      // 渲染层订阅模型：ipcRenderer.on 只收订阅之后的消息；先于订阅的 send 永久丢失，
      // 宿主将永远停在「等待加载文档…」（session 永远为 null）。
      let subscribed = false;
      const received: Array<{ command: string }> = [];
      view.webContents.send.mockImplementation((channel: string, command: { command: string }) => {
        if (channel === 'binary:editorCommand' && subscribed) received.push(command);
      });

      // editor-host.html 加载完成（did-finish-load），但宿主页尚未挂载/订阅（慢机器、冷启动）。
      const finishLoad = view.webContents.on.mock.calls.find(
        ([event]) => event === 'did-finish-load',
      )?.[1];
      expect(finishLoad).toBeTypeOf('function');
      finishLoad();
      await vi.advanceTimersByTimeAsync(2000);

      // 渲染层此刻才完成 bootstrap：先订阅，再发真实 ack。
      subscribed = true;
      const drained = manager.acknowledgeReady(view.webContents.id);

      // ack 响应必须把排队的初始 load 交还给页面（pull 模式），而不是曾经 send 进虚空。
      expect(drained).toEqual([{ command: 'load', kind: 'mindmap', path: 'slow.xmind' }]);
      expect(view.webContents.send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
