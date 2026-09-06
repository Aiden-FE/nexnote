import * as path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { FsChangeEvent } from '@nexnote/shared';
import { EXCLUDED_DIRS } from './fs-service';

/**
 * vault 文件监视（DEV-003）：chokidar 监听当前 vault 根，
 * 把外部/内部文件变化以 fs:changed 事件推给渲染层（页面树实时同步）。
 *
 * - vault 打开/关闭/切换时调用 sync()（由 VaultSession.onChanged 驱动）
 * - 多次 sync() 串行化（syncChain），快速切换 vault 时不会出现「前一个 watcher 仍活着」
 * - emit 时再校验 getRoot()：若调用方已切换 vault，丢弃该事件
 * - ignoreInitial：初始树由 fs:listTree 一次性拉取，避免启动事件风暴
 * - 始终忽略 .nexnote/ .git/ .trash/ node_modules（与树/扫描口径一致）
 * - awaitWriteFinish：合并写文件的抖动（渲染层另有防抖重扫标签）
 */
export class VaultWatchService {
  private watcher: FSWatcher | null = null;
  private watchedRoot: string | null = null;
  private readyPromise: Promise<void> | null = null;
  private syncChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly deps: {
      getRoot: () => string | null;
      emit: (event: FsChangeEvent) => void;
      onError?: (error: unknown) => void;
    },
  ) {}

  get watched(): string | null {
    return this.watchedRoot;
  }

  /** root 变化时切换 watcher；root 为 null 时停止监听。幂等；多次调用按顺序串行执行。 */
  sync(): Promise<void> {
    const next = this.syncChain.then(() => this.runSync());
    // 串行：即使当前 sync 抛错也继续
    this.syncChain = next.catch(() => undefined);
    return next;
  }

  private async runSync(): Promise<void> {
    const root = this.deps.getRoot();
    if (root === this.watchedRoot) return;
    await this.stop();
    if (!root) return;

    const capturedRoot = root;
    const toEvent = (kind: FsChangeEvent['kind']) => (absPath: string) => {
      // 发送前再校验：调用方已切换 vault 则丢弃
      if (this.deps.getRoot() !== capturedRoot) return;
      const rel = toRelative(capturedRoot, absPath);
      if (rel === null || rel.length === 0) return;
      this.deps.emit({ kind, path: rel });
    };

    const watcher = watch(capturedRoot, {
      ignored: (p: string) => EXCLUDED_DIRS.has(path.basename(p)),
      ignoreInitial: true,
      persistent: false,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
      depth: 32,
    });
    watcher
      .on('add', toEvent('add'))
      .on('change', toEvent('change'))
      .on('unlink', toEvent('unlink'))
      .on('addDir', toEvent('addDir'))
      .on('unlinkDir', toEvent('unlinkDir'))
      .on('error', (e) => this.deps.onError?.(e));
    this.watcher = watcher;
    this.watchedRoot = capturedRoot;
    this.readyPromise = new Promise<void>((resolve) => {
      watcher.once('ready', () => resolve());
    });
  }

  /** 等待当前 watcher 初始扫描完成；未监听时立即返回。 */
  async ready(): Promise<void> {
    await this.readyPromise;
  }

  async stop(): Promise<void> {
    const current = this.watcher;
    this.watcher = null;
    this.watchedRoot = null;
    this.readyPromise = null;
    if (current) await current.close().catch(() => undefined);
  }
}

function toRelative(root: string, absPath: string): string | null {
  const rel = path.relative(root, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}
