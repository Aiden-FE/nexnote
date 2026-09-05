import { BrowserWindow, nativeTheme, screen, shell } from 'electron';
import { join } from 'node:path';
import type { IpcEventChannel, IpcEventMap } from '@nexnote/shared';
import type { AppStore, WindowBounds } from './vault/app-store';

export interface WindowManagerDeps {
  getAppStore: () => AppStore;
  devTools: boolean;
}

const MIN_WIDTH = 960;
const MIN_HEIGHT = 600;
const DEFAULT_WIDTH = 1360;
const DEFAULT_HEIGHT = 860;

/** 校验保存的窗口边界仍落在可用显示区内。 */
function sanitizeBounds(saved: WindowBounds | null): WindowBounds | null {
  if (!saved) return null;
  if (saved.width < MIN_WIDTH || saved.height < MIN_HEIGHT) return null;
  try {
    const display = screen.getDisplayMatching({
      x: saved.x ?? 0,
      y: saved.y ?? 0,
      width: saved.width,
      height: saved.height,
    });
    const wa = display.workArea;
    const overlaps =
      (saved.x ?? wa.x) < wa.x + wa.width &&
      (saved.x ?? wa.x) + saved.width > wa.x &&
      (saved.y ?? wa.y) < wa.y + wa.height &&
      (saved.y ?? wa.y) + saved.height > wa.y;
    return overlaps ? saved : null;
  } catch {
    return null;
  }
}

function isAllowedUrl(url: string): boolean {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl && url.startsWith(devUrl)) return true;
  try {
    return new URL(url).protocol === 'file:';
  } catch {
    return false;
  }
}

/**
 * 主窗口管理。多窗口/子窗口在后续票扩展：新增 createXxxWindow 并维护 id→window 映射。
 * 安全基线：contextIsolation + sandbox + nodeIntegration:false，仅 preload 桥接。
 */
export class WindowManager {
  private mainWindow: BrowserWindow | null = null;

  constructor(private readonly deps: WindowManagerDeps) {}

  createMainWindow(): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) return this.mainWindow;
    const store = this.deps.getAppStore();
    const saved = sanitizeBounds(store.get().windowBounds);

    const win = new BrowserWindow({
      width: saved?.width ?? DEFAULT_WIDTH,
      height: saved?.height ?? DEFAULT_HEIGHT,
      x: saved?.x,
      y: saved?.y,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#17171a' : '#ffffff',
      title: 'NexNote',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
      },
    });

    win.once('ready-to-show', () => win.show());

    win.on('close', () => {
      if (!win.isMinimized() && win.isVisible()) {
        const b = win.getBounds();
        store.setWindowBounds({
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          maximized: win.isMaximized(),
        });
      }
    });
    win.on('closed', () => {
      this.mainWindow = null;
    });

    // 安全加固：新窗口一律拒绝（外链用系统浏览器打开）
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    // 导航仅允许渲染层自身 origin（防意外跳转逃离沙箱）
    win.webContents.on('will-navigate', (event, url) => {
      if (!isAllowedUrl(url)) event.preventDefault();
    });
    // 权限请求全部拒绝（MVP 无需任何 Web 权限）
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
      callback(false);
    });

    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) {
      void win.loadURL(devUrl);
      if (this.deps.devTools) win.webContents.openDevTools({ mode: 'detach' });
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'));
    }

    this.mainWindow = win;
    return win;
  }

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow : null;
  }

  sendToMainWindow<C extends IpcEventChannel>(channel: C, payload: IpcEventMap[C]): void {
    const win = this.getMainWindow();
    if (win) win.webContents.send(channel, payload);
  }

  focusMain(): void {
    const win = this.getMainWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  }
}
