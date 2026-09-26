import { describe, expect, it, vi } from 'vitest';
import { ApprovalStore } from '../src/agent/approval-store';
import { AuditStore } from '../src/agent/audit-store';
import { ToolRegistry, type AgentTool } from '../src/agent/tool-registry';
import { validatePayload } from '../src/ipc/validation';
import { createBuiltinTools } from '../src/agent/builtin-tools';
import type { GitRepairAction } from '@nexnote/shared';

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
  // Chat Dock 的真实载荷：缺少这两个字段的白名单会让每次发送都被判为「未知字段」。
  it('agent payload accepts the full Chat Dock payload', () => {
    expect(
      validatePayload('agent:run:chat', {
        messages: [{ role: 'user', content: 'x' }],
        skillIds: [],
        contextText: '',
        permissionMode: 'edit',
        contextPaths: ['notes/page.md'],
      }),
    ).toBeNull();
  });
  it('agent payload rejects an invalid permissionMode', () => {
    expect(
      validatePayload('agent:run:chat', {
        messages: [{ role: 'user', content: 'x' }],
        permissionMode: 'admin',
      }),
    ).toMatchObject({ code: 'IPC_PAYLOAD_INVALID' });
  });
  it('agent payload rejects non-string contextPaths', () => {
    expect(
      validatePayload('agent:run:chat', {
        messages: [{ role: 'user', content: 'x' }],
        contextPaths: [1],
      }),
    ).toMatchObject({ code: 'IPC_PAYLOAD_INVALID' });
  });
  it('approval payload rejects invalid decision', () => {
    expect(
      validatePayload('agent:approval:respond', { approvalId: 'a', decision: 'later' }),
    ).toMatchObject({ code: 'IPC_PAYLOAD_INVALID' });
  });
});

// git_doctor_repair 工具：验证 doctor.prepare+execute 被正确调用，且 ctx.approval 必传。
describe('git_doctor_repair agent tool', () => {
  function buildRegistry(doctor: {
    diagnose?: () => Promise<{ plan: { action: GitRepairAction | null } }>;
    prepare: (action: GitRepairAction) => Promise<{ ticket: string; ticketExpiresAt: number }>;
    execute: (ticket: string) => Promise<{ message: string }>;
  }) {
    return new ToolRegistry(
      createBuiltinTools({
        retrieve: async () => ({ degraded: false, sources: [] }),
        listPages: () => [],
        doctor: {
          diagnose:
            doctor.diagnose ?? (async () => ({ plan: { action: 'preserve-local-and-abort' } })),
          prepare: async (action) => ({
            ...(await doctor.prepare(action)),
            diagnosis: {} as never,
          }),
          execute: async (ticket) => ({
            ...(await doctor.execute(ticket)),
            status: {} as never,
          }),
        },
      }),
    );
  }

  it('未注入 doctor 时不注册 git_doctor_repair（向后兼容）', () => {
    const reg = new ToolRegistry(
      createBuiltinTools({
        retrieve: async () => ({ degraded: false, sources: [] }),
        listPages: () => [],
      }),
    );
    expect(reg.get('git_doctor_repair')).toBeUndefined();
  });

  it('approval 缺失时拒绝执行', async () => {
    const prepare = vi.fn();
    const execute = vi.fn();
    const reg = buildRegistry({
      prepare: async (_a) => ({ ticket: 't', ticketExpiresAt: Date.now() }),
      execute: async (_t) => ({ message: 'm' }),
    });
    await expect(
      reg.execute(
        'git_doctor_repair',
        { action: 'preserve-local-and-abort' },
        { runId: 'r', scenario: 'chat', permissionMode: 'edit' },
      ),
    ).rejects.toThrow(/审批通过后/);
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('approval 通过后串行调用 prepare+execute 并返回 doctor 结果', async () => {
    const prepare = vi.fn(async (_action: GitRepairAction) => ({
      diagnosis: {} as never,
      ticket: 'ticket-1',
      ticketExpiresAt: Date.now() + 60_000,
    }));
    const execute = vi.fn(async (_ticket: string) => ({
      message: '已中止未完成的 rebase/merge',
    }));
    const reg = buildRegistry({ prepare, execute });
    const result = await reg.execute(
      'git_doctor_repair',
      { action: 'preserve-local-and-abort' },
      {
        runId: 'r',
        scenario: 'chat',
        permissionMode: 'edit',
        approval: { approvalId: 'a-1' },
      },
    );
    expect(prepare).toHaveBeenCalledWith('preserve-local-and-abort');
    expect(execute).toHaveBeenCalledWith('ticket-1');
    expect(result).toMatchObject({
      ticket: 'ticket-1',
      action: 'preserve-local-and-abort',
      message: '已中止未完成的 rebase/merge',
    });
  });

  it('Agent 不能把医生推荐的保留笔记改成放弃本地改动', async () => {
    const prepare = vi.fn(async (_action: GitRepairAction) => ({
      ticket: 'ticket-1',
      ticketExpiresAt: Date.now() + 60_000,
    }));
    const execute = vi.fn(async (_ticket: string) => ({ message: 'unexpected' }));
    const reg = buildRegistry({ prepare, execute });
    await expect(
      reg.execute(
        'git_doctor_repair',
        { action: 'force-abort-rebase-or-merge' },
        { runId: 'r', scenario: 'chat', permissionMode: 'edit', approval: { approvalId: 'a' } },
      ),
    ).rejects.toMatchObject({ code: 'DOCTOR_ACTION_MISMATCH' });
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('input 缺 action 字段被拒', async () => {
    const reg = buildRegistry({ prepare: vi.fn(), execute: vi.fn() });
    await expect(
      reg.execute(
        'git_doctor_repair',
        {},
        { runId: 'r', scenario: 'chat', permissionMode: 'edit', approval: { approvalId: 'a' } },
      ),
    ).rejects.toThrow(/输入必须是/);
  });
});
