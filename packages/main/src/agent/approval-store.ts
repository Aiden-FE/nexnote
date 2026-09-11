import type { AgentApprovalDecision } from '@nexnote/shared';
interface Pending {
  tool: string;
  runId: string;
  expiresAt: number;
  decision?: AgentApprovalDecision;
  waiter?: (decision: AgentApprovalDecision) => void;
}
export const APPROVAL_TTL_MS = 5 * 60_000;
export class ApprovalStore {
  private readonly pending = new Map<string, Pending>();
  request(id: string, tool: string, runId = '', ttl = APPROVAL_TTL_MS): number {
    const expiresAt = Date.now() + Math.min(Math.max(0, ttl), APPROVAL_TTL_MS);
    this.pending.set(id, { tool, runId, expiresAt });
    return expiresAt;
  }
  respond(id: string, decision: AgentApprovalDecision): boolean {
    const p = this.pending.get(id);
    if (!p || p.expiresAt <= Date.now() || p.decision !== undefined) {
      this.pending.delete(id);
      return false;
    }
    p.decision = decision;
    p.waiter?.(decision);
    return true;
  }
  wait(id: string, tool: string, runId: string): Promise<AgentApprovalDecision> {
    const p = this.pending.get(id);
    if (!p || p.tool !== tool || p.runId !== runId || p.expiresAt <= Date.now()) {
      this.pending.delete(id);
      return Promise.reject(new Error('APPROVAL_EXPIRED'));
    }
    if (p.decision) return Promise.resolve(p.decision);
    return new Promise((resolve, reject) => {
      p.waiter = resolve;
      setTimeout(
        () => {
          if (this.pending.get(id) !== p || p.decision) return;
          this.pending.delete(id);
          reject(new Error('APPROVAL_EXPIRED'));
        },
        Math.max(0, p.expiresAt - Date.now()),
      );
    });
  }
  consume(id: string, tool: string, runId = ''): boolean {
    const p = this.pending.get(id);
    this.pending.delete(id);
    return (
      !!p &&
      p.tool === tool &&
      p.runId === runId &&
      p.expiresAt > Date.now() &&
      p.decision === 'approved'
    );
  }
  /** 终止挂起的等待者（取消/超时清理）：以 denied 结算，调用方按拒绝处理。 */
  private settle(p: Pending, decision: AgentApprovalDecision): void {
    if (p.decision === undefined) p.decision = decision;
    p.waiter?.(decision);
    p.waiter = undefined;
  }
  revoke(id: string): void {
    const p = this.pending.get(id);
    this.pending.delete(id);
    if (p) this.settle(p, 'denied');
  }
  revokeRun(runId: string): void {
    for (const [id, p] of this.pending) {
      if (p.runId === runId) {
        this.pending.delete(id);
        this.settle(p, 'denied');
      }
    }
  }
  pendingCount(): number {
    return this.pending.size;
  }
}
