import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiConfigState, AgentRunEvent } from '@nexnote/shared';
import { AgentGateway } from '../src/agent/gateway';
import { AuditStore } from '../src/agent/audit-store';
import { ToolRegistry, type AgentTool } from '../src/agent/tool-registry';
import type { ChatStreamHandle } from '../src/ai/provider/types';

const SECRET = 'sk-agent-e2e-secret';

const aiState: AiConfigState = {
  profiles: [
    {
      id: 'profile-1',
      name: 'fake',
      kind: 'openai-compatible',
      baseUrl: 'http://fake.local',
      defaultModel: 'fake-model',
      params: {},
      hasApiKey: true,
      keyStorage: 'system-credential',
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  defaultProfileId: 'profile-1',
  features: {
    chat: { profileId: 'profile-1', model: 'fake-model' },
    writing: null,
    embedding: null,
  },
  needsOnboarding: false,
  embeddingFingerprint: null,
  embeddingGeneration: 0,
};

type StreamFactory = (
  messages?: Array<{ role: string; content: string }>,
  onEvent?: (event: AgentRunEvent) => void,
) => ChatStreamHandle;

const immediateStream: StreamFactory = () => ({
  abort: vi.fn(),
  done: Promise.resolve().then(() => undefined),
});

function deferredStream() {
  let resolve!: () => void;
  const done = new Promise<void>((r) => {
    resolve = r;
  });
  return { handle: { abort: vi.fn(), done }, resolve };
}

function readTool(name: string, onExecute?: (input: unknown) => void): AgentTool {
  return {
    definition: {
      name,
      description: name,
      access: 'read',
      requiresApproval: false,
      inputSchema: {},
    },
    // A secret inside the result proves audit records never capture tool output.
    execute: async (input) => {
      onExecute?.(input);
      return { ok: true, input, secret: SECRET };
    },
  };
}

const writeTool: AgentTool = {
  definition: {
    name: 'write_note',
    description: 'write',
    access: 'write',
    requiresApproval: true,
    inputSchema: {},
  },
  execute: async () => ({ written: true }),
};

interface SetupOptions {
  stream?: StreamFactory;
  tools?: AgentTool[];
  skills?: {
    retrieve: (options: { query: string; skillIds?: string[]; budgetChars: number }) => Promise<{
      usedSkillIds: string[];
      sources: Array<{ path: string }>;
      degraded: boolean;
      contextText: string;
    }>;
  };
}

function setup(options: SetupOptions = {}) {
  const events: Array<{ runId: string; scenario: string; event: AgentRunEvent }> = [];
  const audit = new AuditStore();
  const ai = {
    getState: () => aiState,
    // The fake provider stands in for the network; the gateway never sees its internals.
    openChatStream: (
      opts: { messages: Array<{ role: string; content: string }> },
      onEvent: (event: AgentRunEvent) => void,
    ): ChatStreamHandle =>
      options.stream
        ? options.stream(opts.messages, onEvent)
        : immediateStream(opts.messages, onEvent),
  };
  const gateway = new AgentGateway({
    ai: ai as never,
    tools: options.tools ? new ToolRegistry(options.tools) : undefined,
    skills: options.skills as never,
    audit,
    sendEvent: (_channel, payload) =>
      events.push(payload as { runId: string; scenario: string; event: AgentRunEvent }),
  });
  const of = <T extends AgentRunEvent['type']>(type: T) =>
    events.filter(
      (e): e is { runId: string; scenario: string; event: Extract<AgentRunEvent, { type: T }> } =>
        e.event.type === type,
    );
  return { gateway, events, audit, of };
}

const request = { messages: [{ role: 'user' as const, content: 'find notes' }] };

afterEach(() => {
  vi.useRealTimers();
});

describe('AgentGateway end-to-end lifecycle', () => {
  it('completes a run exactly once through the real runtime', async () => {
    const { gateway, of, audit } = setup({ stream: () => immediateStream() });
    const { runId } = await gateway.run('chat', request);
    await new Promise((r) => setTimeout(r, 10));
    expect(of('start')).toHaveLength(1);
    // The fake provider resolves silently; lifecycle completion is audited once.
    const runRecords = audit.list().filter((r) => r.event === 'run' && r.runId === runId);
    expect(runRecords).toHaveLength(1);
    expect(runRecords[0]).toMatchObject({ status: 'completed' });
  });

  it('cancelling before runtime completion never records completed', async () => {
    const deferred = deferredStream();
    const { gateway, audit } = setup({ stream: () => deferred.handle });
    const { runId } = await gateway.run('chat', request);
    expect(gateway.cancel(runId)).toBe(true);
    expect(gateway.cancel(runId)).toBe(false); // second cancel is a no-op
    deferred.resolve();
    await deferred.handle.done;
    await new Promise((r) => setTimeout(r, 10));
    expect(audit.list().filter((r) => r.status === 'cancelled')).toHaveLength(1);
    expect(audit.list().some((r) => r.status === 'completed')).toBe(false);
  });

  it('a runtime throw surfaces the provider code and audits the failure once', async () => {
    const { gateway, of, audit } = setup({
      stream: () => {
        throw Object.assign(new Error('provider down'), { code: 'PROVIDER_DOWN' });
      },
    });
    await gateway.run('chat', request);
    expect(of('error')).toHaveLength(1);
    expect(of('error')[0]?.event).toMatchObject({ type: 'error', code: 'PROVIDER_DOWN' });
    const failed = audit.list().filter((r) => r.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.code).toBe('PROVIDER_DOWN');
  });

  it('the 10-minute TTL expires an abandoned run exactly once', async () => {
    vi.useFakeTimers();
    const deferred = deferredStream();
    const { gateway, of, audit } = setup({
      stream: () => {
        // The provider never finishes: an abandoned stream can only end via TTL.
        return deferred.handle;
      },
    });
    await gateway.run('chat', request);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await Promise.resolve();
    expect(of('error')).toHaveLength(1);
    expect(of('error')[0]?.event).toMatchObject({ type: 'error', code: 'TTL_EXPIRED' });
    const runRecords = audit.list().filter((r) => r.event === 'run');
    expect(runRecords).toHaveLength(1);
    expect(runRecords[0]).toMatchObject({ status: 'failed', code: 'TTL_EXPIRED' });
    deferred.resolve();
    await deferred.handle.done;
    await Promise.resolve();
    expect(audit.list().filter((r) => r.event === 'run')).toHaveLength(1); // done after expiry changes nothing
  });

  it('chat and debug drive their scenario allowlisted tools through the real loop', async () => {
    const executed: Array<{ scenario: string; name: string; input: unknown }> = [];
    const providerMessages: Array<Array<{ role: string; content: string }>> = [];
    const { gateway } = setup({
      tools: [
        readTool('search_notes', (input) =>
          executed.push({ scenario: '', name: 'search_notes', input }),
        ),
        readTool('list_pages', () =>
          executed.push({ scenario: '', name: 'list_pages', input: {} }),
        ),
      ],
      stream: (messages) => {
        providerMessages.push(messages!);
        return immediateStream(messages);
      },
    });
    await gateway.run('chat', request);
    await gateway.run('debug', request);
    await new Promise((r) => setTimeout(r, 10));
    // chat: only search_notes; debug: search_notes + list_pages (profile-driven).
    expect(executed.map((e) => e.name)).toEqual(['search_notes', 'search_notes', 'list_pages']);
    // The system prompt and tool results are main-process constructed context.
    expect(providerMessages[0]?.[0]).toMatchObject({ role: 'system' });
    expect(providerMessages[1]?.at(-1)?.content).toContain('【工具结果】');
  });

  it('a tool outside the scenario allowlist fails closed with audit and no input leakage', async () => {
    const deferred = deferredStream();
    const { gateway, audit } = setup({
      tools: [readTool('search_notes')],
      stream: () => deferred.handle,
    });
    // No user turn → no pre-tool phase; the run stays active for direct executeTool calls.
    const { runId } = await gateway.run('chat', { messages: [] });
    await new Promise((r) => setTimeout(r, 0));
    await expect(
      gateway.executeTool(runId, 'unregistered_tool', { query: SECRET }),
    ).rejects.toMatchObject({ code: 'TOOL_NOT_ALLOWED' });
    const denied = audit.list().filter((r) => r.event === 'tool' && r.status === 'denied');
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ tool: 'unregistered_tool', code: 'TOOL_NOT_ALLOWED' });
    expect(JSON.stringify(audit.list())).not.toContain(SECRET);
    deferred.resolve();
  });

  it('approving a write tool executes it exactly once and audits the approval', async () => {
    const deferred = deferredStream();
    let executeCount = 0;
    const approvingTool: AgentTool = {
      ...writeTool,
      definition: { ...writeTool.definition, name: 'search_notes', access: 'read' },
      execute: async () => {
        executeCount += 1;
        return { written: true };
      },
    };
    const { gateway, of, audit } = setup({
      tools: [approvingTool],
      stream: () => deferred.handle,
    });
    const { runId } = await gateway.run('chat', { messages: [] });
    const pending = gateway.executeTool(runId, 'search_notes', { body: SECRET });
    const approval = await vi.waitFor(() => {
      const [event] = of('approvalRequired');
      if (!event) throw new Error('approvalRequired not emitted yet');
      return event;
    });
    expect(gateway.respondApproval(approval.event.approvalId, 'approved')).toBe(true);
    await expect(pending).resolves.toEqual({ written: true });
    expect(executeCount).toBe(1);
    const approvalRecords = audit.list().filter((r) => r.event === 'approval');
    expect(approvalRecords).toHaveLength(2); // started + approved
    expect(approvalRecords[1]).toMatchObject({ status: 'approved', tool: 'search_notes' });
    expect(JSON.stringify(audit.list())).not.toContain(SECRET);
    deferred.resolve();
  });

  it('deny, TTL expiry, and run cancel each close a pending approval', async () => {
    vi.useFakeTimers();
    const deferred = deferredStream();
    const gatedTool: AgentTool = {
      ...writeTool,
      definition: { ...writeTool.definition, name: 'search_notes', access: 'read' },
    };
    const { gateway, of, audit } = setup({
      tools: [gatedTool],
      stream: () => deferred.handle,
    });
    const { runId } = await gateway.run('chat', { messages: [] });
    await vi.advanceTimersByTimeAsync(0);

    // deny
    const deniedCall = gateway.executeTool(runId, 'search_notes', {});
    const deniedApproval = await vi.waitFor(() => of('approvalRequired').at(-1) ?? undefined);
    gateway.respondApproval(deniedApproval!.event.approvalId, 'denied');
    await expect(deniedCall).rejects.toMatchObject({ code: 'APPROVAL_DENIED' });

    // TTL expiry of a never-answered approval
    const ttlCall = gateway.executeTool(runId, 'search_notes', {}).catch((error: unknown) => error);
    await vi.waitFor(() => expect(of('approvalRequired')).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await expect(ttlCall).resolves.toMatchObject({ message: 'APPROVAL_EXPIRED' });

    // run cancellation settles the last pending approval as denied
    const cancelledCall = gateway.executeTool(runId, 'search_notes', {});
    await vi.waitFor(() => expect(of('approvalRequired')).toHaveLength(3));
    expect(gateway.cancel(runId)).toBe(true);
    await expect(cancelledCall).rejects.toMatchObject({ code: 'APPROVAL_DENIED' });

    const approvals = audit.list().filter((r) => r.event === 'approval');
    expect(approvals.filter((r) => r.status === 'started')).toHaveLength(3);
    expect(approvals.filter((r) => r.status === 'denied')).toHaveLength(2);
    deferred.resolve();
  });

  it('emits the builtin-fallback event with audit, and consumes requested skillIds', async () => {
    const retrievedOptions: unknown[] = [];
    const { gateway, of, audit } = setup({
      skills: {
        retrieve: async (options) => {
          retrievedOptions.push(options);
          return {
            usedSkillIds: options.skillIds ?? ['builtin.retrieval'],
            sources: [{ path: 'notes/a.md' }],
            degraded: true,
            contextText: `skill context ${SECRET}`,
          };
        },
      },
      stream: () => immediateStream(),
    });
    await gateway.run('chat', { ...request, skillIds: ['builtin.retrieval'], contextText: 'ctx' });
    await new Promise((r) => setTimeout(r, 10));
    expect(retrievedOptions[0]).toMatchObject({
      query: 'find notes',
      skillIds: ['builtin.retrieval'],
    });
    expect(of('fallback')).toHaveLength(1);
    expect(of('context')).toHaveLength(1);
    expect(of('context')[0]?.event).toMatchObject({ degraded: true });
    const fallbackRecords = audit.list().filter((r) => r.event === 'fallback');
    expect(fallbackRecords).toHaveLength(1);
    expect(fallbackRecords[0]).toMatchObject({ code: 'PI_RUNTIME_UNAVAILABLE' });
    // Skill context reaches the provider but never the audit log.
    expect(JSON.stringify(audit.list())).not.toContain(SECRET);
  });
});
