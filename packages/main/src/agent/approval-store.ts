import type { AgentApprovalDecision } from '@nexnote/shared';
interface Pending { tool: string; expiresAt: number; decision?: AgentApprovalDecision }
export const APPROVAL_TTL_MS = 5 * 60_000;
export class ApprovalStore {
  private readonly pending = new Map<string, Pending>();
  request(id: string, tool: string, ttl = APPROVAL_TTL_MS): number { const expiresAt = Date.now() + Math.min(ttl, APPROVAL_TTL_MS); this.pending.set(id, { tool, expiresAt }); return expiresAt; }
  respond(id: string, decision: AgentApprovalDecision): boolean { const p = this.pending.get(id); if (!p || p.expiresAt <= Date.now()) { this.pending.delete(id); return false; } p.decision = decision; return true; }
  consume(id: string, tool: string): boolean { const p = this.pending.get(id); this.pending.delete(id); return !!p && p.tool === tool && p.expiresAt > Date.now() && p.decision === 'approved'; }
  revoke(id: string): void { this.pending.delete(id); }
}
