import type { BrowserWindow } from 'electron';
import { WebContentsView } from 'electron';
import { join } from 'node:path';
import type { BinaryEditorCommand, IpcEventChannel } from '@nexnote/shared';

/**
 * DEV-074 二进制编辑器宿主管理（ADR-0015 Decision 3）：
 * docx / xlsx / mindmap 编辑器各运行在独立 WebContentsView 进程，与块编辑主窗口崩溃隔离。
 * 主窗口保存 / 主题 / 命令经 IPC 桥（binary:editorCommand）下发；pending 写入关闭前经 flush 完成。
 *
 * 生命周期：tab 激活 → ensureVisible + send load；tab 关闭/换非二进制 → send destroy + 延迟回收。
 * 并发上限由渲染层 tab-store 控制（≤3，LRU 关闭最早）。
 *
 * 就绪协议（P0 修复）：
 * - 渲染层 bootstrap 后才注册 `onEvent('binary:editorCommand', …)`，所以主进程必须等它发 ack 才下发命令。
 * - ack 经 `binary:host:ready` invoke 抵达，主进程用 senderId = webContents.id 识别 entry 并 drain 队列。
 * - did-finish-load 留作诊断监听，不参与业务。
 * - flush / roundTrip 在未就绪时挂载到一个 ready promise，等待 ack；超过 FLUSH_READY_TIMEOUT_MS 则按无 flush 兜底。
 * - close() 在 await flush 前后用 entry 引用 + webContentsId 双重核对，避免销毁到 close/reopen 之后的另一个 entry。
 */

export type BinaryKind = BinaryEditorCommand['kind'];

interface HostEntry {
  view: WebContentsView;
  kind: BinaryKind;
  path: string;
  /** webContents.id（= ipcMain 回调里的 senderId）：用 sender 定位 entry。 */
  webContentsId: number;
  /** 渲染层 ack（bootstrapBinaryHost 完成）后才为 true。 */
  ready: boolean;
  pending: BinaryEditorCommand[];
  /** 渲染层上报的占位矩形（窗口内容区坐标）；未上报前宿主不显示，避免盖住主窗口 UI。 */
  bounds: { x: number; y: number; width: number; height: number } | null;
  /** ready 翻转时 resolve 的等待器（flush / roundTrip 在收到 ack 前挂在这里）。 */
  readyWaiters: Array<() => void>;
}

/** ack 超时上限：避免关闭流程永远卡在未就绪宿主（崩溃 / preload 加载失败）。 */
const FLUSH_READY_TIMEOUT_MS = 1500;

export class BinaryEditorHostManager {
  private hosts = new Map<string, HostEntry>();
  /** webContentsId → hostKey：senderId 反查 entry，避免依赖 hostKey 自身。 */
  private idIndex = new Map<number, string>();
  private mainWindow: BrowserWindow | null = null;

  attach(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    const refresh = (): void => this.layoutVisible();
    mainWindow.on('resize', refresh);
    mainWindow.on('maximize', refresh);
    mainWindow.on('unmaximize', refresh);
    mainWindow.on('closed', () => {
      this.mainWindow = null;
      this.destroyAll();
    });
  }

  /** tab 切换 / 尺寸变化时调用：仅显示活动二进制 tab 的宿主，其余 detach 隐藏。
   *  渲染层未上报占位矩形前不附加视图——宿主必须落在 BinaryTabView 内容区，
   *  绝不能盖住侧栏/标签条/状态栏（ADR-0015 Decision 3「宿主边界」）。 */
  layoutVisible(): void {
    const win = this.mainWindow;
    if (!win || win.isDestroyed()) return;
    const contentBounds = win.getContentBounds();
    const activeKey = this.activeKey;
    for (const [key, entry] of this.hosts) {
      const rect = entry.bounds;
      const hasRoom =
        !!rect &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.x < contentBounds.width &&
        rect.y < contentBounds.height;
      const shouldShow = key === activeKey && hasRoom;
      const isAttached = win.contentView.children.includes(entry.view);
      if (shouldShow && !isAttached) {
        win.contentView.addChildView(entry.view);
      } else if (!shouldShow && isAttached) {
        win.contentView.removeChildView(entry.view);
      }
    }
    this.layoutBounds();
  }

  /** 由渲染层在激活 tab 变化时设置（二进制 tab 的 key）或 null（非二进制 tab）。 */
  private activeKey: string | null = null;

  setActive(kind: BinaryKind, path: string): void {
    this.activeKey = hostKey(kind, path);
    this.layoutVisible();
    this.queue(this.activeKey, { command: 'load', kind, path });
  }

  /** 渲染层上报占位矩形（窗口内容区坐标）。宿主未上报前不附加视图，避免盖住主窗口 UI。 */
  setBounds(
    kind: BinaryKind,
    path: string,
    bounds: { x: number; y: number; width: number; height: number } | null,
  ): void {
    const entry = this.hosts.get(hostKey(kind, path));
    if (!entry) return;
    entry.bounds = bounds;
    this.layoutVisible();
  }

  clearActive(): void {
    this.activeKey = null;
    this.layoutVisible();
  }

  /** 打开或复用宿主并加载文档。 */
  async open(kind: BinaryKind, path: string): Promise<void> {
    const key = hostKey(kind, path);
    if (!this.hosts.has(key)) {
      const view = this.createView(key);
      this.hosts.set(key, {
        view,
        kind,
        path,
        webContentsId: view.webContents.id,
        ready: false,
        pending: [],
        bounds: null,
        readyWaiters: [],
      });
      this.idIndex.set(view.webContents.id, key);
    }
  }

  /** 关闭 tab：等待 pending 落盘后销毁宿主。P0：跨 await 用 entry 引用 + webContentsId 双重核对，
   *  防止 await 期间宿主被 close/reopen 替换为新 entry 时误销毁新 entry。 */
  async close(kind: BinaryKind, path: string): Promise<void> {
    const key = hostKey(kind, path);
    const entry = this.hosts.get(key);
    if (!entry) return;
    const entryRef = entry;
    const idRef = entry.webContentsId;
    try {
      await this.flush(key);
    } catch {
      // 宿主可能已崩溃；销毁仍可继续。
    }
    const current = this.hosts.get(key);
    if (!current || current !== entryRef || current.webContentsId !== idRef) {
      // await 期间发生 close/reopen：不要销毁，可能正被新的视图使用。
      return;
    }
    this.destroy(key);
  }

  /** 主窗口关闭前等待全部 pending 写入完成（ADR-0015 Decision 6）。 */
  async flushAll(): Promise<void> {
    await Promise.all(
      [...this.hosts.values()].map((entry) =>
        this.flushByEntry(entry).catch(() => undefined),
      ),
    );
  }

  /** 当前激活宿主的 pending 写入等待。 */
  async flush(key: string): Promise<void> {
    const entry = this.hosts.get(key);
    if (!entry) return;
    await this.flushByEntry(entry);
  }

  /** 切换主题：广播给全部宿主。 */
  applyTheme(theme: 'light' | 'dark'): void {
    for (const [key, entry] of this.hosts) {
      this.queue(key, {
        command: 'theme',
        kind: entry.kind,
        theme,
      } satisfies BinaryEditorCommand);
    }
  }

  destroyAll(): void {
    for (const key of [...this.hosts.keys()]) this.destroy(key);
  }

  get size(): number {
    return this.hosts.size;
  }

  /**
   * 渲染层 ack：把对应 entry 标 ready 并 drain 队列。
   * 主进程通过 webContentsId 识别（renderer → main 端）。重复 ack 幂等。
   * senderId 为 0（单测里的假 ipcMain 不带 sender）按 no-op 处理：等价的真实路径下不会发生。
   */
  acknowledgeReady(senderId: number): void {
    if (!senderId) return;
    const key = this.idIndex.get(senderId);
    if (!key) return;
    const entry = this.hosts.get(key);
    if (!entry || entry.webContentsId !== senderId) return;
    if (entry.view.webContents.isDestroyed()) return;
    if (entry.ready) return; // 重复 ack 幂等
    entry.ready = true;
    const waiters = entry.readyWaiters.splice(0);
    for (const w of waiters) w();
    for (const command of entry.pending.splice(0)) {
      entry.view.webContents.send('binary:editorCommand' satisfies IpcEventChannel, command);
    }
  }

  private destroy(key: string): void {
    const entry = this.hosts.get(key);
    if (!entry) return;
    // 任何等待 ack 的 flush 立刻失败，避免销毁后还被旧 roundTrip 触碰。
    for (const w of entry.readyWaiters.splice(0)) w();
    const win = this.mainWindow;
    if (win && !win.isDestroyed() && win.contentView.children.includes(entry.view)) {
      win.contentView.removeChildView(entry.view);
    }
    // close() 即销毁宿主渲染进程（WebContentsView 的标准回收路径），不再额外强转调用非公开 destroy。
    entry.view.webContents.close();
    this.hosts.delete(key);
    this.idIndex.delete(entry.webContentsId);
    if (this.activeKey === key) this.activeKey = null;
  }

  private layoutBounds(): void {
    const win = this.mainWindow;
    if (!win || win.isDestroyed()) return;
    const content = win.getContentBounds();
    for (const [key, entry] of this.hosts) {
      if (key !== this.activeKey || entry.bounds === null) continue;
      // 二次防御：即使 renderer 上报越界坐标，宿主也只能落在主窗口内容区内。
      const x = Math.max(0, Math.min(entry.bounds.x, content.width));
      const y = Math.max(0, Math.min(entry.bounds.y, content.height));
      const width = Math.max(0, Math.min(entry.bounds.width, content.width - x));
      const height = Math.max(0, Math.min(entry.bounds.height, content.height - y));
      entry.view.setBounds({ x, y, width, height });
    }
  }

  private createView(key: string): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
      },
    });
    // 与主窗口同一套导航/权限安全基线。
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    view.webContents.session.setPermissionRequestHandler((_wc, _p, callback) => callback(false));
    // did-finish-load 仅作诊断；不再用 did-finish-load 触发 pending drain（避免 JS 注册晚于 did-finish-load 时丢首条 load）。
    view.webContents.on('did-finish-load', () => {
      const entry = this.hosts.get(key);
      if (!entry || entry.view !== view || view.webContents.isDestroyed()) return;
      if (!entry.ready) {
        // 等待 binary:host:ready ack；若 ack 一直不来（崩溃 / preload 失败）也不阻塞关闭路径。
        const timer = setTimeout(() => {
          const current = this.hosts.get(key);
          if (!current || current.view !== view) return;
          if (!current.ready) this.acknowledgeReady(view.webContents.id);
        }, FLUSH_READY_TIMEOUT_MS);
        view.webContents.once('destroyed', () => clearTimeout(timer));
      }
    });
    view.webContents.on('destroyed', () => {
      this.idIndex.delete(view.webContents.id);
      const entry = this.hosts.get(key);
      if (entry) {
        for (const w of entry.readyWaiters.splice(0)) w();
      }
    });

    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) {
      void view.webContents.loadURL(`${devUrl}/editor-host.html`);
    } else {
      void view.webContents.loadFile(join(__dirname, '../renderer/editor-host.html'));
    }
    return view;
  }

  private queue(key: string, command: BinaryEditorCommand): void {
    const entry = this.hosts.get(key);
    if (!entry || entry.view.webContents.isDestroyed()) return;
    if (!entry.ready) {
      // load/theme 依顺序排队；ack 后统一发送，避免首条 load 丢失。
      entry.pending.push(command);
      return;
    }
    entry.view.webContents.send('binary:editorCommand' satisfies IpcEventChannel, command);
  }

  /** 等待 entry ack（若已 ack 则立即 resolve），并 await host flush 钩子。
   *  host flush 钩子不存在时不再 silent no-op，而是把 flush 视为「hook 未安装」
   *  → 主动尝试再次发送 initial ack 或抛出（下面以 reject 实现）。
   *  这里以 reject 让上层显式知晓：flush 是关键路径，hook 缺失 = 渲染层 bug。
   */
  private async roundTrip(entry: HostEntry): Promise<void> {
    if (entry.view.webContents.isDestroyed()) return;
    if (!entry.ready) {
      // 等待 ack：最多 FLUSH_READY_TIMEOUT_MS；超时视为渲染层 bug，flush 不可信。
      const ack = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          const i = entry.readyWaiters.indexOf(onAck);
          if (i >= 0) entry.readyWaiters.splice(i, 1);
          resolve(false);
        }, FLUSH_READY_TIMEOUT_MS);
        const onAck = (): void => {
          clearTimeout(timer);
          resolve(true);
        };
        entry.readyWaiters.push(onAck);
      });
      if (!ack) {
        throw new Error(`binary host 未在 ${FLUSH_READY_TIMEOUT_MS}ms 内 ack`);
      }
    }
    if (entry.view.webContents.isDestroyed()) return;
    // ack 之后再调 host flush；如果 host 仍未注入 __nexnoteHostFlush，抛错而不是静默成功。
    await entry.view.webContents.executeJavaScript(
      `(typeof window.__nexnoteHostFlush === 'function' ? window.__nexnoteHostFlush() : Promise.reject(new Error('__nexnoteHostFlush not installed')))`,
    );
  }

  private async flushByEntry(entry: HostEntry): Promise<void> {
    await this.roundTrip(entry);
  }
}

function hostKey(kind: BinaryKind, path: string): string {
  return `${kind}:${path}`;
}