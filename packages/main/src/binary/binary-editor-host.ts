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
 */

export type BinaryKind = BinaryEditorCommand['kind'];

interface HostEntry {
  view: WebContentsView;
  kind: BinaryKind;
  path: string;
}

export class BinaryEditorHostManager {
  private hosts = new Map<string, HostEntry>();
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

  /** tab 切换 / 尺寸变化时调用：仅显示活动二进制 tab 的宿主，其余 detach 隐藏。 */
  layoutVisible(): void {
    const win = this.mainWindow;
    if (!win || win.isDestroyed()) return;
    // 激活的二进制 tab（由渲染层设置 activeBinaryHost）；非二进制 tab 显示时 detach 全部。
    const activeKey = this.activeKey;
    for (const [key, entry] of this.hosts) {
      const shouldShow = key === activeKey;
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
    this.send(this.activeKey, { command: 'load', kind, path });
  }

  clearActive(): void {
    this.activeKey = null;
    this.layoutVisible();
  }

  /** 打开或复用宿主并加载文档。 */
  async open(kind: BinaryKind, path: string): Promise<void> {
    const key = hostKey(kind, path);
    if (!this.hosts.has(key)) {
      this.hosts.set(key, { view: this.createView(), kind, path });
    }
    this.setActive(kind, path);
  }

  /** 关闭 tab：等待 pending 落盘后销毁宿主。 */
  async close(kind: BinaryKind, path: string): Promise<void> {
    const key = hostKey(kind, path);
    const entry = this.hosts.get(key);
    if (!entry) return;
    try {
      await this.flush(key);
    } catch {
      // 宿主可能已崩溃；销毁仍可继续。
    }
    this.destroy(key);
  }

  /** 主窗口关闭前等待全部 pending 写入完成（ADR-0015 Decision 6）。 */
  async flushAll(): Promise<void> {
    await Promise.all([...this.hosts.keys()].map((key) => this.flush(key).catch(() => undefined)));
  }

  /** 当前激活宿主的 pending 写入等待。 */
  async flush(key: string): Promise<void> {
    const entry = this.hosts.get(key);
    if (!entry) return;
    await this.roundTrip(key, { command: 'flush', kind: entry.kind, path: entry.path });
  }

  /** 切换主题：广播给全部宿主。 */
  applyTheme(theme: 'light' | 'dark'): void {
    for (const entry of this.hosts.values()) {
      entry.view.webContents.send('binary:editorCommand', {
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

  private destroy(key: string): void {
    const entry = this.hosts.get(key);
    if (!entry) return;
    const win = this.mainWindow;
    if (win && !win.isDestroyed() && win.contentView.children.includes(entry.view)) {
      win.contentView.removeChildView(entry.view);
    }
    (entry.view.webContents as unknown as { destroy?: () => void }).destroy?.();
    entry.view.webContents.close();
    this.hosts.delete(key);
    if (this.activeKey === key) this.activeKey = null;
  }

  private layoutBounds(): void {
    const win = this.mainWindow;
    if (!win || win.isDestroyed()) return;
    const bounds = win.getContentBounds();
    // 宿主占满主窗口内容区；tab 条/工具栏由主窗口渲染层在上方留白。
    for (const [key, entry] of this.hosts) {
      if (key !== this.activeKey) continue;
      entry.view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
      entry.view.setAutoResize({ width: true, height: true });
    }
  }

  private createView(): WebContentsView {
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

    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) {
      void view.webContents.loadURL(`${devUrl}/editor-host.html`);
    } else {
      void view.webContents.loadFile(join(__dirname, '../renderer/editor-host.html'));
    }
    return view;
  }

  private send(key: string, command: BinaryEditorCommand): void {
    const entry = this.hosts.get(key);
    if (!entry || entry.view.webContents.isDestroyed()) return;
    entry.view.webContents.send('binary:editorCommand' satisfies IpcEventChannel, command);
  }

  /**
   * 向宿主发指令并等待回报：宿主完成后调用 window.nexnote.invoke('binary:host:setActive')
   * 之外的轻量回报——这里复用 executeJavaScript 的返回值同步等待，语义最直接。
   */
  private async roundTrip(key: string, command: BinaryEditorCommand): Promise<void> {
    const entry = this.hosts.get(key);
    if (!entry || entry.view.webContents.isDestroyed()) return;
    // 宿主页面在 window 上暴露 __nexnoteHostFlush()（session.ts 装配）；执行它等待 flush 完成。
    try {
      await entry.view.webContents.executeJavaScript(
        `(window.__nexnoteHostFlush ? window.__nexnoteHostFlush() : Promise.resolve())`,
      );
    } catch {
      // 宿主崩溃或尚未就绪：flush 语义尽力而为，不阻塞销毁。
    }
    void command;
  }
}

function hostKey(kind: BinaryKind, path: string): string {
  return `${kind}:${path}`;
}
