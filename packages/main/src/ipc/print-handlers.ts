import { ok } from '@nexnote/shared';
import { join } from 'node:path';
import type { IpcRegistrar } from './registrar';
import { createPrintWindow, printHtml } from '../print/print-window';

/**
 * 打印 handler：验证轻量 payload（长度上限防滥用），然后复用主窗口的渲染层壳
 * 创建隐藏打印窗口。一次只承载一个文档，打印结束立即销毁。
 */
const MAX_HTML_BYTES = 8 * 1024 * 1024;

export function registerPrintHandlers(registrar: IpcRegistrar): void {
  registrar.register('print:document', async ({ title, html }) => {
    if (typeof title !== 'string' || typeof html !== 'string') {
      throw Object.assign(new Error('print:document payload missing'), {
        code: 'IPC_PAYLOAD_INVALID',
      });
    }
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
      throw Object.assign(new Error('print:document html too large'), {
        code: 'PRINT_HTML_TOO_LARGE',
      });
    }
    const printWindow = createPrintWindow();
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    try {
      if (devUrl) await printWindow.window.loadURL(devUrl);
      else await printWindow.window.loadFile(join(__dirname, '../renderer/index.html'));
      const outcome = await printHtml(printWindow.window, { title, html });
      return ok(outcome);
    } finally {
      printWindow.close();
    }
  });
}
