/**
 * Live Preview 渲染调度（DEV-020 源码模式）。
 *
 * 源码编辑 → 防抖 ~200ms → 用最新文本调用 render。
 * render 是异步的（TipTap setMarkdown）：旧版本完成后通过 isCurrent()
 * 自查，过期结果一律丢弃，绝不覆盖更新内容。
 */
export interface PreviewScheduler {
  /** 登记一次源码变更（重置计时器，只保留最新文本） */
  schedule(text: string): void;
  /** 销毁：取消未触发的渲染，之后所有 isCurrent() 均为 false */
  destroy(): void;
}

export interface PreviewSchedulerOptions {
  /** 防抖毫秒数（默认 200） */
  delayMs?: number;
  /** 渲染回调：收到当前文本与「是否仍是最新版本」的探针 */
  render: (text: string, isCurrent: () => boolean) => void | Promise<void>;
}

export function createPreviewScheduler(options: PreviewSchedulerOptions): PreviewScheduler {
  const delay = options.delayMs ?? 200;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: string | null = null;
  let token = 0;
  let destroyed = false;

  const flush = (): void => {
    const text = pending;
    pending = null;
    if (destroyed || text === null) return;
    token += 1;
    const myToken = token;
    const isCurrent = (): boolean => !destroyed && token === myToken;
    void options.render(text, isCurrent);
  };

  return {
    schedule(text: string) {
      if (destroyed) return;
      pending = text;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, delay);
    },
    destroy() {
      destroyed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
    },
  };
}
