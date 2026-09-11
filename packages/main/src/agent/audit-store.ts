import type { AgentAuditRecord } from '@nexnote/shared';
const MAX_RECORDS = 500;
export class AuditStore {
  private readonly records: AgentAuditRecord[] = [];
  append(record: AgentAuditRecord): void { this.records.push({ ...record }); if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS); }
  list(): AgentAuditRecord[] { return this.records.map((r) => ({ ...r })); }
}
