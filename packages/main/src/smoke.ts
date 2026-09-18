import { app, ipcMain } from 'electron';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { WindowManager } from './window';
import { startMockOpenAiServer } from './ai/testing';

export interface SmokeCheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface SmokeReport {
  finishedAt: string;
  checks: SmokeCheckResult[];
  captures: string[];
}

/**
 * 冒烟测试控制器（NEXNOTE_SMOKE=1 时启用）：
 * - userData 隔离到 tmp 目录（不污染真实应用数据）
 * - 渲染层经 preload 暴露的 nexnoteSmoke 驱动检查步骤
 * - 主进程负责 capturePage 截图与结果落盘，全部通过时退出码 0
 * 通道 smoke:* 为内部测试通道，不进 shared 公共契约。
 */
export class SmokeController {
  private readonly captures: string[] = [];

  constructor(
    private readonly deps: {
      windows: WindowManager;
      outputDir: string;
    },
  ) {}

  async init(): Promise<void> {
    await mkdir(this.deps.outputDir, { recursive: true });

    // DEV-009：冒烟模式内嵌 mock OpenAI 服务器（127.0.0.1 随机端口）。
    // 渲染层冒烟脚本经 smoke:aiMock 拿到 baseUrl，全链路验证 AI 向导/连通/流式/embedding。
    const mock = await startMockOpenAiServer({ chunkDelayMs: 30 });
    console.log('[smoke] ai mock server at', mock.url);
    ipcMain.handle('smoke:aiMock', () => ({ ok: true, url: `${mock.url}/v1` }));
    // DEV-037：写作流式取消/失败覆盖需要可控的分段延迟与下一次请求失败。
    ipcMain.handle('smoke:aiMockTune', (_event, payload: unknown) => {
      try {
        const tune = (payload ?? {}) as {
          chunkDelayMs?: number;
          failNextChatWith?: number;
          failAfterChunks?: number;
        };
        if (typeof tune.chunkDelayMs !== 'number' || tune.chunkDelayMs < 0) {
          throw new Error('chunkDelayMs must be a non-negative number');
        }
        mock.chunkDelayMs = tune.chunkDelayMs;
        mock.failNextChatWith =
          typeof tune.failNextChatWith === 'number' ? tune.failNextChatWith : undefined;
        mock.failAfterChunks =
          typeof tune.failAfterChunks === 'number' ? tune.failAfterChunks : undefined;
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });
    ipcMain.handle('smoke:mkdtemp', async () => {
      try {
        const dir = await mkdtemp(path.join(tmpdir(), 'nexnote-smoke-vault-'));
        return { ok: true, path: dir };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });
    // 模拟「外部进程」直接写磁盘（不经 fs IPC），验证 chokidar 实时同步
    ipcMain.handle('smoke:writeFile', async (_event, payload: unknown) => {
      try {
        const { root, rel, content } = payload as { root: string; rel: string; content: string };
        const abs = path.join(root, rel);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, content, 'utf8');
        return { ok: true, path: abs };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });
    ipcMain.handle('smoke:seedGraph', async (_event, root: unknown) => {
      try {
        if (typeof root !== 'string') throw new Error('graph vault root is required');
        const groups = ['group-a', 'group-b'] as const;
        await Promise.all(
          groups.flatMap((group) =>
            Array.from({ length: 250 }, async (_, index) => {
              const name = `${group}-node-${index}`;
              const targets = Array.from(
                { length: 4 },
                (_, offset) => `[[graph/${group}/${group}-node-${(index + offset + 1) % 250}]]`,
              ).join(' ');
              const abs = path.join(root, 'graph', group, `${name}.md`);
              await mkdir(path.dirname(abs), { recursive: true });
              await writeFile(
                abs,
                `---\ntags: [smoke/${group}]\n---\n# ${name}\n\n${targets}\n`,
                'utf8',
              );
            }),
          ),
        );
        return { ok: true, pages: 500, links: 2000 };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });
    // DEV-035：窄窗工具栏溢出覆盖需要真实调整窗口尺寸（冒烟专用，不改变窗口下限）。
    ipcMain.handle('smoke:setWindowSize', async (_event, payload: unknown) => {
      try {
        const { width, height } = payload as { width: number; height: number };
        const win = this.deps.windows.getMainWindow();
        if (!win) throw new Error('main window is not available');
        win.setSize(Math.round(width), Math.round(height));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });
    /** Use Electron's focused WebContents input path, not untrusted DOM KeyboardEvents. */
    ipcMain.handle('smoke:pressKey', async (_event, payload: unknown) => {
      try {
        const { key, modifiers } = (payload ?? {}) as { key?: unknown; modifiers?: unknown };
        if (typeof key !== 'string' || !key) throw new Error('key is required');
        const win = this.deps.windows.getMainWindow();
        if (!win) throw new Error('main window is not available');
        win.show();
        win.focus();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const normalized = key === 'Enter' ? 'ENTER' : key === 'ArrowDown' ? 'ARROWDOWN' : key === 'ArrowUp' ? 'ARROWUP' : key.toUpperCase();
        win.webContents.sendInputEvent({
          type: 'keyDown',
          keyCode: normalized,
          modifiers: Array.isArray(modifiers) ? modifiers.filter((item): item is string => typeof item === 'string') : [],
        });
        win.webContents.sendInputEvent({
          type: 'keyUp',
          keyCode: normalized,
          modifiers: Array.isArray(modifiers) ? modifiers.filter((item): item is string => typeof item === 'string') : [],
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });
    ipcMain.handle('smoke:typeText', async (_event, text: unknown) => {
      try {
        if (typeof text !== 'string' || !text) throw new Error('non-empty text is required');
        const win = this.deps.windows.getMainWindow();
        if (!win) throw new Error('main window is not available');
        win.show();
        win.focus();
        await new Promise((resolve) => setTimeout(resolve, 50));
        for (const character of text) {
          // sendInputEvent uses Chromium accelerator names for non-letter keys. A raw
          // character (not a DOM KeyboardEvent) is still required so the focused
          // contenteditable runs its normal beforeinput/input path.
          const keyCode =
            character === '\n'
              ? 'ENTER'
              : character === ' '
                ? 'SPACE'
                : character === '/'
                  ? 'SLASH'
                  : character.toUpperCase();
          win.webContents.sendInputEvent({ type: 'rawKeyDown', keyCode });
          if (character !== '\n')
            win.webContents.sendInputEvent({ type: 'char', keyCode: character });
          win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });
    ipcMain.handle('smoke:capture', async (_event, name: unknown) => {
      try {
        const file = await this.capture(String(name));
        return { ok: true, path: file };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });
    ipcMain.handle('smoke:finish', async (_event, payload: unknown) => {
      try {
        const report = payload as SmokeReport;
        await this.finish(report);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });
  }

  async capture(name: string): Promise<string | null> {
    const win = this.deps.windows.getMainWindow();
    if (!win) return null;
    const image = await win.webContents.capturePage();
    const file = path.join(this.deps.outputDir, `${name}.png`);
    await writeFile(file, image.toPNG());
    this.captures.push(file);
    return file;
  }

  async finish(report: SmokeReport): Promise<void> {
    const finalReport: SmokeReport = { ...report, captures: [...this.captures] };
    await writeFile(
      path.join(this.deps.outputDir, 'results.json'),
      `${JSON.stringify(finalReport, null, 2)}\n`,
      'utf8',
    );
    // 空报告视为 harness 失败：不能因为一次检查都没跑就判定通过。
    const allPassed = finalReport.checks.length > 0 && finalReport.checks.every((c) => c.passed);
    console.log(
      `[smoke] ${finalReport.checks.filter((c) => c.passed).length}/${finalReport.checks.length} checks passed; report written to ${this.deps.outputDir}`,
    );
    // app.quit() 是可取消的优雅退出且不携带退出码；CI 需要确定性失败信号。
    setTimeout(() => app.exit(allPassed ? 0 : 1), 300);
  }
}
