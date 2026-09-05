/**
 * 保存调度器：编辑 → 防抖 N ms → 回调（序列化与写文件由调用方组合）。
 * flush() 立即落盘待保存内容；cancel() 丢弃；hasPending() 探询。
 */
export interface SaveScheduler {
  /** 登记一次内容变更（重启计时器） */
  schedule(markdown: string): void;
  /** 立即执行待保存内容（无待保存则静默） */
  flush(): Promise<void>;
  /** 丢弃待保存内容 */
  cancel(): void;
  /** 是否有待保存内容 */
  hasPending(): boolean;
  /** 保存回调是否正在执行（防重入） */
  isSaving(): boolean;
}

export interface SaveSchedulerOptions {
  /** 防抖毫秒数（默认 500） */
  delayMs?: number;
  /** 内容变更即登记（无防抖语义差异，保留扩展位） */
  onSave: (markdown: string) => void | Promise<void>;
  /** 保存失败回调（吞掉异常会掩盖问题，这里必须显式上报） */
  onError?: (error: unknown) => void;
}

export function createSaveScheduler(options: SaveSchedulerOptions): SaveScheduler {
  const delay = options.delayMs ?? 500;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: string | null = null;
  let saving = false;

  const run = async () => {
    if (pending === null || saving) return;
    const content = pending;
    pending = null;
    saving = true;
    try {
      await options.onSave(content);
    } catch (e) {
      options.onError?.(e);
    } finally {
      saving = false;
    }
    // flush 期间若有新内容到达，继续执行
    if (pending !== null && timer === null) {
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, delay);
    }
  };

  return {
    schedule(markdown: string) {
      pending = markdown;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, delay);
    },
    async flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await run();
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
    },
    hasPending() {
      return pending !== null;
    },
    isSaving() {
      return saving;
    },
  };
}
