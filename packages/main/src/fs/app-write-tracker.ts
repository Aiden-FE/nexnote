/**
 * 应用写入登记（origin 追踪的根源修复，DEV-020 冲突误判）：
 *
 * 主进程在「应用自身写入落盘」的每个落盘点登记绝对路径；vault watcher
 * 产生 change/add 事件时查询该登记，命中则给 FsChangeEvent 打上
 * `origin: 'app'`。渲染层据此绝不把应用自身写入弹成外部修改冲突
 * （旧方案仅靠内容基线比对，在 awaitWriteFinish 延迟窗口内继续输入时会误判）。
 *
 * - TTL：登记只保留一小段时间（覆盖 chokidar awaitWriteFinish 的延迟即可）
 * - 上限：有界 Map 防止超长会话内存泄漏；超出时逐出最旧登记
 */
export const APP_WRITE_TTL_MS = 10_000;
export const APP_WRITE_MAX_ENTRIES = 500;

export class AppWriteTracker {
  /** 插入序 = 登记时间序（record 时先删后插刷新顺序），供逐出最旧条目。 */
  private readonly recent = new Map<string, number>();

  constructor(
    private readonly ttlMs: number = APP_WRITE_TTL_MS,
    private readonly maxEntries: number = APP_WRITE_MAX_ENTRIES,
    private readonly now: () => number = Date.now,
  ) {}

  /** 登记一次应用写入落盘（绝对路径）。 */
  record(absPath: string): void {
    const now = this.now();
    this.pruneExpired(now);
    // 先删后插：重复登记刷新插入序（最新写入排在最后）
    this.recent.delete(absPath);
    this.recent.set(absPath, now);
    while (this.recent.size > this.maxEntries) {
      const oldest = this.recent.keys().next().value;
      if (oldest === undefined) break;
      this.recent.delete(oldest);
    }
  }

  /** 该绝对路径是否在 TTL 内由应用写入过。 */
  isRecent(absPath: string): boolean {
    const recordedAt = this.recent.get(absPath);
    if (recordedAt === undefined) return false;
    if (this.now() - recordedAt > this.ttlMs) {
      this.recent.delete(absPath);
      return false;
    }
    return true;
  }

  private pruneExpired(now: number): void {
    for (const [entryPath, recordedAt] of this.recent) {
      if (now - recordedAt > this.ttlMs) this.recent.delete(entryPath);
    }
  }
}
