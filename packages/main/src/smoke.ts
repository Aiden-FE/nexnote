import { app, ipcMain } from 'electron';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { WindowManager } from './window';

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
    ipcMain.handle('smoke:mkdtemp', async () => {
      try {
        const dir = await mkdtemp(path.join(tmpdir(), 'nexnote-smoke-vault-'));
        return { ok: true, path: dir };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });
    // 模拟「外部进程」直接写磁盘（不经 fs IPC），验证 chokidar 实时同步
    ipcMain.handle(
      'smoke:writeFile',
      async (_event, payload: unknown) => {
        try {
          const { root, rel, content } = payload as { root: string; rel: string; content: string };
          const abs = path.join(root, rel);
          await mkdir(path.dirname(abs), { recursive: true });
          await writeFile(abs, content, 'utf8');
          return { ok: true, path: abs };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
    );
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
    const allPassed = finalReport.checks.every((c) => c.passed);
    if (!allPassed) process.exitCode = 1;
    console.log(
      `[smoke] ${finalReport.checks.filter((c) => c.passed).length}/${finalReport.checks.length} checks passed; report written to ${this.deps.outputDir}`,
    );
    setTimeout(() => app.quit(), 300);
  }
}
