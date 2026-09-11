import type { AgentApprovalDecision } from '@nexnote/shared';
interface Pending {
  tool: string;
  runId: string;
  expiresAt: number;
  decision?: AgentApprovalDecision;
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
    return true;
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
  revoke(id: string): void {
    this.pending.delete(id);
  }
  revokeRun(runId: string): void {
    for (const [id, p] of this.pending) if (p.runId === runId) this.pending.delete(id);
  }
}
