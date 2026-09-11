import { describe, expect, it } from 'vitest';
import { ApprovalStore } from '../src/agent/approval-store';
import { AuditStore } from '../src/agent/audit-store';
import { ToolRegistry, type AgentTool } from '../src/agent/tool-registry';
import { validatePayload } from '../src/ipc/validation';

const readTool = (name = 'search_notes'): AgentTool => ({
  definition: { name, description: name, access: 'read', requiresApproval: false, inputSchema: {} },
  execute: async (input) => input,
});

describe('agent runtime blocker contracts', () => {
  it('approval request returns bounded expiry', () => {
    const s = new ApprovalStore();
    expect(s.request('a', 't', 'r')).toBeGreaterThan(Date.now());
  });
  it('approval approve responds true', () => {
    const s = new ApprovalStore();
    s.request('a', 't', 'r');
    expect(s.respond('a', 'approved')).toBe(true);
  });
  it('approval deny responds true', () => {
    const s = new ApprovalStore();
    s.request('a', 't', 'r');
    expect(s.respond('a', 'denied')).toBe(true);
  });
  it('unknown approval responds false', () => {
    expect(new ApprovalStore().respond('x', 'approved')).toBe(false);
  });
  it('duplicate response is rejected', () => {
    const s = new ApprovalStore();
    s.request('a', 't', 'r');
    s.respond('a', 'approved');
    expect(s.respond('a', 'denied')).toBe(false);
  });
  it('consume approved is true', () => {
    const s = new ApprovalStore();
    s.request('a', 't', 'r');
    s.respond('a', 'approved');
    expect(s.consume('a', 't', 'r')).toBe(true);
  });
  it('consume is one shot', () => {
    const s = new ApprovalStore();
    s.request('a', 't', 'r');
    s.respond('a', 'approved');
    s.consume('a', 't', 'r');
    expect(s.consume('a', 't', 'r')).toBe(false);
  });
  it('consume binds tool', () => {
    const s = new ApprovalStore();
    s.request('a', 't', 'r');
    s.respond('a', 'approved');
    expect(s.consume('a', 'other', 'r')).toBe(false);
  });
  it('consume binds run', () => {
    const s = new ApprovalStore();
    s.request('a', 't', 'r');
    s.respond('a', 'approved');
    expect(s.consume('a', 't', 'other')).toBe(false);
  });
  it('expired approval cannot wait', async () => {
    const s = new ApprovalStore();
    s.request('a', 't', 'r', 0);
    await expect(s.wait('a', 't', 'r')).rejects.toThrow('APPROVAL_EXPIRED');
  });
  it('expired approval cannot consume', () => {
    const s = new ApprovalStore();
    s.request('a', 't', 'r', 0);
    s.respond('a', 'approved');
    expect(s.consume('a', 't', 'r')).toBe(false);
  });
  it('revoke removes approval', () => {
    const s = new ApprovalStore();
    s.request('a', 't', 'r');
    s.revoke('a');
    expect(s.pendingCount()).toBe(0);
  });
  it('revokeRun removes only matching run', () => {
    const s = new ApprovalStore();
    s.request('a', 't', 'r');
    s.request('b', 't', 'other');
    s.revokeRun('r');
    expect(s.pendingCount()).toBe(1);
  });
  it('revoke settles waiter', async () => {
    const s = new ApprovalStore();
    s.request('a', 't', 'r');
    const p = s.wait('a', 't', 'r');
    s.revokeRun('r');
    await expect(p).resolves.toBe('denied');
  });
  it('audit stores records', () => {
    const s = new AuditStore();
    s.append({ runId: 'r', scenario: 'chat', event: 'run', status: 'completed', at: 1 });
    expect(s.list()).toHaveLength(1);
  });
  it('audit returns copies', () => {
    const s = new AuditStore();
    s.append({ runId: 'r', scenario: 'chat', event: 'run', status: 'completed', at: 1 });
    const x = s.list();
    x[0]!.runId = 'changed';
    expect(s.list()[0]!.runId).toBe('r');
  });
  it('audit ring retains newest 500', () => {
    const s = new AuditStore();
    for (let i = 0; i < 501; i++)
      s.append({ runId: String(i), scenario: 'chat', event: 'run', status: 'completed', at: i });
    expect(s.list()[0]!.runId).toBe('1');
  });
  it('audit does not add input', () => {
    const s = new AuditStore();
    s.append({
      runId: 'r',
      scenario: 'chat',
      event: 'tool',
      status: 'allowed',
      tool: 'search_notes',
      at: 1,
    });
    expect(JSON.stringify(s.list())).not.toContain('input');
  });
  it('registry lists only registered tools', () => {
    expect(new ToolRegistry([readTool()]).list().map((x) => x.name)).toEqual(['search_notes']);
  });
  it('registry executes registered read tool', async () => {
    await expect(
      new ToolRegistry([readTool()]).execute(
        'search_notes',
        { q: 'x' },
        { runId: 'r', scenario: 'chat' },
      ),
    ).resolves.toEqual({ q: 'x' });
  });
  it('registry denies missing tool', async () => {
    await expect(
      new ToolRegistry([]).execute('search_notes', {}, { runId: 'r', scenario: 'chat' }),
    ).rejects.toMatchObject({ code: 'TOOL_NOT_FOUND' });
  });
  it('registry denies writes', async () => {
    const t = {
      ...readTool('write'),
      definition: { ...readTool('write').definition, access: 'write' as const },
    };
    await expect(
      new ToolRegistry([t]).execute('write', {}, { runId: 'r', scenario: 'chat' }),
    ).rejects.toMatchObject({ code: 'TOOL_WRITE_DISABLED' });
  });
  it('agent payload rejects unknown fields', () => {
    expect(validatePayload('agent:run:chat', { messages: [], nope: true })).toMatchObject({
      code: 'IPC_PAYLOAD_INVALID',
    });
  });
  it('agent payload rejects malformed messages', () => {
    expect(validatePayload('agent:run:chat', { messages: [{ role: 'system' }] })).toMatchObject({
      code: 'IPC_PAYLOAD_INVALID',
    });
  });
  it('agent payload accepts valid messages', () => {
    expect(
      validatePayload('agent:run:chat', { messages: [{ role: 'user', content: 'x' }] }),
    ).toBeNull();
  });
  it('approval payload rejects invalid decision', () => {
    expect(
      validatePayload('agent:approval:respond', { approvalId: 'a', decision: 'later' }),
    ).toMatchObject({ code: 'IPC_PAYLOAD_INVALID' });
  });
});
