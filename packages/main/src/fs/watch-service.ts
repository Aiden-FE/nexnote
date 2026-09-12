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
      getFormat?: (path: string) => Promise<'native-block' | 'markdown' | undefined>;
      /**
       * 应用写入登记查询（主进程 VaultFsService 维护）：change/add 事件命中时
       * 附 origin:'app'，渲染层据此不弹外部修改冲突。TTL 覆盖 awaitWriteFinish
       * 延迟（stabilityThreshold 120ms + 事件分发）远有余量。
       */
      isRecentAppWrite?: (absPath: string) => boolean;
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
      // 应用自身写入（含 renameWithLinks 联动重写的其它文件）：命中登记即标记 origin，
      // 事件在 awaitWriteFinish 延迟后到达，TTL 足以覆盖。未命中时省略 origin（外部事件）。
      const origin =
        (kind === 'change' || kind === 'add') && this.deps.isRecentAppWrite?.(absPath) === true
          ? ('app' as const)
          : undefined;
      if (kind === 'add' && /\.(?:md|markdown)$/i.test(rel) && this.deps.getFormat) {
        void this.deps
          .getFormat(rel)
          .then((format) =>
            this.deps.emit(
              origin ? { kind, path: rel, format, origin } : { kind, path: rel, format },
            ),
          );
      } else {
        this.deps.emit(origin ? { kind, path: rel, origin } : { kind, path: rel });
      }
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
    let resolveReady!: () => void;
    let rejectReady!: (error: unknown) => void;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const onReady = () => resolveReady();
    const onInitialError = (error: unknown) => rejectReady(error);
    watcher.once('ready', onReady);
    watcher.once('error', onInitialError);
    try {
      await this.readyPromise;
    } catch (error) {
      await this.stop();
      throw error;
    } finally {
      watcher.off('ready', onReady);
      watcher.off('error', onInitialError);
    }
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
