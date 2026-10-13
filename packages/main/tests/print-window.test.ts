import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { printHtml } from '../src/print/print-window';

describe('printHtml', () => {
  it('passes print options through and resolves with the Electron callback result', async () => {
    const print = vi
      .fn()
      .mockImplementation(
        (_options: unknown, callback: (accepted: boolean, reason?: string) => void) => {
          callback(false, 'Print job canceled');
        },
      );
    const setTitle = vi.fn();
    const fakeWindow = {
      setTitle,
      webContents: { print },
    } as unknown as BrowserWindow;

    const outcome = await printHtml(fakeWindow, { title: '打印文档', html: '<p>ok</p>' });

    expect(setTitle).toHaveBeenCalledWith('打印文档');
    expect(print).toHaveBeenCalledWith(
      { silent: false, printBackground: true },
      expect.any(Function),
    );
    expect(outcome).toEqual({ accepted: false, failureReason: 'Print job canceled' });
  });
});
