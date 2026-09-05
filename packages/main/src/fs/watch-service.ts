import * as path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { FsChangeEvent } from '@nexnote/shared';
import { EXCLUDED_DIRS } from './fs-service';

/**
 * vault 文件监视（DEV-003）：chokidar 监听当前 vault 根，
 * 把外部/内部文件变化以 fs:changed 事件推给渲染层（页面树实时同步）。
 *
 * - vault 打开/关闭/切换时调用 sync()（由 VaultSession.onChanged 驱动）
 * - ignoreInitial：初始树由 fs:listTree 一次性拉取，避免启动事件风暴
 * - 始终忽略 .nexnote/ .git/ .trash/ node_modules（与树/扫描口径一致）
 * - awaitWriteFinish：合并写文件的抖动（渲染层另有防抖重扫标签）
 */
export class VaultWatchService {
  private watcher: FSWatcher | null = null;
  private watchedRoot: string | null = null;
  private readyPromise: Promise<void> | null = null;

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

  /** root 变化时切换 watcher；root 为 null 时停止监听。幂等。 */
  async sync(): Promise<void> {
    const root = this.deps.getRoot();
    if (root === this.watchedRoot) return;
    await this.stop();
    if (!root) return;

    const toEvent = (kind: FsChangeEvent['kind']) => (absPath: string) => {
      const rel = toRelative(root, absPath);
      if (rel === null || rel.length === 0) return;
      this.deps.emit({ kind, path: rel });
    };

    const watcher = watch(root, {
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
    this.watchedRoot = root;
    // ready = 初始扫描完成（ignoreInitial 下后续变化才开始推送）；测试与调用方可等待
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
