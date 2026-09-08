import { randomUUID } from 'node:crypto';

/**
 * 面向 onboarding 向导的 vault 操作控制器。
 * - 每个 WebContents sender 独立拥有一个 AbortController，保证向导 UI 关闭/切页时可取消。
 * - operationId 用于识别某一次具体操作（create/open/clone），主进程用它定位 AbortSignal。
 * - sender 关闭时该 sender 下所有 pending 操作自动取消并释放资源。
 */
export class VaultOperationsController {
  private readonly bySender = new Map<
    number,
    { controller: AbortController; operationId: string; kind: string }[]
  >();

  /** 为指定 sender 登记一个新操作，返回 operationId + signal。 */
  start(senderId: number, kind: string): { operationId: string; signal: AbortSignal } {
    const operationId = randomUUID();
    const controller = new AbortController();
    const list = this.bySender.get(senderId) ?? [];
    list.push({ controller, operationId, kind });
    this.bySender.set(senderId, list);
    return { operationId, signal: controller.signal };
  }

  /** 取消指定 sender 下的某个 operation。返回是否找到了并取消。 */
  cancel(senderId: number, operationId: string): boolean {
    const list = this.bySender.get(senderId);
    if (!list) return false;
    const entry = list.find((item) => item.operationId === operationId);
    if (!entry) return false;
    const filtered = list.filter((item) => item.operationId !== operationId);
    if (filtered.length === 0) {
      this.bySender.delete(senderId);
    } else {
      this.bySender.set(senderId, filtered);
    }
    try {
      entry.controller.abort();
    } catch {
      /* abortable listener self-contained */
    }
    return true;
  }

  /** sender 销毁时调用：取消该 sender 下所有操作并释放。 */
  disposeSender(senderId: number): void {
    const list = this.bySender.get(senderId);
    if (!list) return;
    for (const entry of list) {
      try {
        entry.controller.abort();
      } catch {
        /* listener self-contained */
      }
    }
    this.bySender.delete(senderId);
  }

  /** 操作完成（无论成功失败）后调用，释放对应 AbortController。 */
  finish(senderId: number, operationId: string): void {
    const list = this.bySender.get(senderId);
    if (!list) return;
    const filtered = list.filter((entry) => entry.operationId !== operationId);
    if (filtered.length === 0) {
      this.bySender.delete(senderId);
    } else {
      this.bySender.set(senderId, filtered);
    }
  }
}
