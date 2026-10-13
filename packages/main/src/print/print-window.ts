import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { PrintDocumentRequest } from '@nexnote/shared';

/**
 * 隐藏打印窗口：加载渲染层壳页后，把打印 HTML 写入该窗口。
 * 一次打印一个实例，打印结束即关闭；壳页与主窗口共用渲染层 origin。
 */
export interface PrintWindowHandle {
  window: BrowserWindow;
  close(): void;
}

export function createPrintWindow(): PrintWindowHandle {
  const win = new BrowserWindow({
    show: false,
    // macOS：打印对话框挂在当前 app 上；窗口本身永不可见。
    skipTaskbar: true,
    title: 'NexNote Print',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  return {
    window: win,
    close(): void {
      if (!win.isDestroyed()) win.destroy();
    },
  };
}

export interface PrintOutcome {
  accepted: boolean;
  failureReason?: string;
}

/** 在打印窗口中调用系统打印对话框，等待用户提交/取消或失败回调。 */
export async function printHtml(
  window: BrowserWindow,
  request: PrintDocumentRequest,
): Promise<PrintOutcome> {
  const win = window;
  win.setTitle(request.title);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome: PrintOutcome): void => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    win.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
      settle({ accepted: success, failureReason: success ? undefined : reason });
    });
  });
}
