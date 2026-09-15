import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgentRunEvent, ChatStreamEvent } from '@nexnote/shared';
import { AiStore } from '../src/ai/ai-store';
import { AiService } from '../src/ai/ai-service';
import {
  createProviderRequestSpy,
  startMockOpenAiServer,
  type MockOpenAiServer,
} from '../src/ai/testing';
import type { SecretVault } from '../src/ai/secret-store';
import { OpenAIProtocolAdapter } from '../src/ai/provider/openai';
import type { ChatTool } from '../src/ai/provider/types';
import { AgentGateway } from '../src/agent/gateway';
import { AuditStore } from '../src/agent/audit-store';
import { ToolRegistry } from '../src/agent/tool-registry';
import { createBuiltinTools } from '../src/agent/builtin-tools';

const CHAT_PATH = '/v1/chat/completions';
const roots: string[] = [];
let mock: MockOpenAiServer;

beforeAll(async () => {
  mock = await startMockOpenAiServer({ embeddingDimensions: 2 });
});
afterAll(async () => {
  await mock.close();
});
afterEach(async () => {
  mock.nextToolCall = undefined;
  mock.toolsUnsupported = false;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fakeVault(): SecretVault {
  const secrets = new Map<string, string>();
  return {
    available: true,
    put: (account, secret) => void secrets.set(account, secret),
    get: (account) => secrets.get(account) ?? null,
    delete: (account) => void secrets.delete(account),
  };
}

async function tmp(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'nexnote-tool-loop-'));
  roots.push(root);
  return root;
}

/** Real AiService (real adapter + SDK) wired to the mock provider through a request spy. */
async function configuredAi() {
  const dir = await tmp();
  const spy = createProviderRequestSpy(mock.url);
  const store = new AiStore(path.join(dir, 'ai.json'), fakeVault());
  const ai = new AiService({ store, sendEvent: () => undefined, fetchImpl: spy.fetch });
  const baseUrl = `${mock.url}/v1`;
  const credentialToken = ai.submitCredential('sk-tool-loop', baseUrl);
  const { id } = ai.saveProfile(undefined, {
    name: 'tool loop provider',
    kind: 'openai-compatible',
    baseUrl,
    defaultModel: 'gpt-4o-mini',
    credentialToken,
  });
  ai.setDefaultProfile(id);
  ai.setFeatureAssignment('chat', { profileId: id, model: 'gpt-4o-mini' });
  expect(spy.count()).toBe(0);
  return { ai, spy };
}

interface RunEvent {
  runId: string;
  scenario: string;
  event: AgentRunEvent;
}

interface Harness {
  gateway: AgentGateway;
  audit: AuditStore;
  events: RunEvent[];
  of: <T extends AgentRunEvent['type']>(
    type: T,
  ) => Array<RunEvent & { event: Extract<AgentRunEvent, { type: T }> }>;
}

function harness(ai: AiService, tools: ToolRegistry): Harness {
  const events: RunEvent[] = [];
  const audit = new AuditStore();
  const gateway = new AgentGateway({
    ai,
    tools,
    audit,
    sendEvent: (_channel, payload) => events.push(payload as RunEvent),
  });
  const of = <T extends AgentRunEvent['type']>(type: T) =>
    events.filter(
      (e): e is RunEvent & { event: Extract<AgentRunEvent, { type: T }> } => e.event.type === type,
    );
  return { gateway, audit, events, of };
}

function registryOf(retrieve: (query: string) => Promise<unknown>) {
  return new ToolRegistry(
    createBuiltinTools({
      retrieve: async (query) => {
        const result = (await retrieve(query)) as {
          degraded: boolean;
          sources: Array<{ path: string; title: string; snippet: string; score: number }>;
        };
        return result;
      },
      listPages: () => [{ path: 'a.md', title: 'A' }],
    }),
  );
}

const sourcesResult = {
  degraded: false,
  sources: [{ path: 'notes/a.md', title: 'A', snippet: 'alpha', score: 1 }],
};

async function waitForRun(
  events: Harness['events'],
  runId: string,
  timeoutMs = 8000,
): Promise<void> {
  await vi.waitFor(
    () => {
      const terminal = events.find(
        (e) => e.runId === runId && (e.event.type === 'done' || e.event.type === 'error'),
      );
      if (!terminal) throw new Error('run not finished yet');
    },
    { timeout: timeoutMs, interval: 20 },
  );
}

describe('DEV-032 SDK 原生工具循环', () => {
  it('adapter 驱动模型 tool_calls → 执行 → 结果回传 → 续答的多轮闭环', async () => {
    mock.nextToolCall = { name: 'search_notes', arguments: { query: 'alpha' } };
    const executed: unknown[] = [];
    const tool: ChatTool = {
      name: 'search_notes',
      description: 'search',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      execute: async (input) => {
        executed.push(input);
        return { sources: ['a.md'] };
      },
    };
    const events: ChatStreamEvent[] = [];
    const adapter = new OpenAIProtocolAdapter({
      baseUrl: `${mock.url}/v1`,
      apiKey: 'sk-mock',
      kind: 'openai-compatible',
    });
    const handle = adapter.chatCompletionStream(
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'find' }], tools: [tool] },
      (event) => events.push(event),
    );
    await handle.done;

    // Tool parsed input reached execute; loop continued and produced the final answer.
    expect(executed).toEqual([{ query: 'alpha' }]);
    expect(events.some((e) => e.type === 'tool' && e.tool === 'search_notes')).toBe(true);
    expect(events.filter((e) => e.type === 'delta').length).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ type: 'done' });

    // Exactly two provider round-trips: the tool-call turn and the continuation turn.
    const chats = mock.requests.filter((r) => r.url === CHAT_PATH);
    expect(chats).toHaveLength(2);
    const second = chats[1]!.body as { messages: Array<{ role: string }> };
    expect(second.messages.some((m) => m.role === 'tool')).toBe(true);
  });

  it('gateway 全链路：模型调用只读工具、审计留摘要、无计划外 provider 请求', async () => {
    const { ai, spy } = await configuredAi();
    mock.nextToolCall = { name: 'search_notes', arguments: { query: 'alpha' } };
    const retrievals: string[] = [];
    const tools = registryOf(async (query) => {
      retrievals.push(query);
      return sourcesResult;
    });
    const { gateway, audit, of, events } = harness(ai, tools);

    const { runId } = await gateway.run('chat', {
      messages: [{ role: 'user', content: 'alpha 是什么' }],
    });
    await waitForRun(events, runId);

    // Tool actually executed through the registry with the model-provided input.
    expect(retrievals).toEqual(['alpha']);
    // Result returned to the model and the run completed without error.
    expect(of('error')).toHaveLength(0);
    expect(events.some((e) => e.runId === runId && e.event.type === 'done')).toBe(true);
    expect(of('tool').map((e) => e.event.status)).toEqual(
      expect.arrayContaining(['started', 'completed']),
    );
    const completed = of('tool').find((e) => e.event.status === 'completed');
    expect(completed?.event.summary).toBe('1 sources');

    // Audit: name + safe result summary, no raw input/result leakage; no approval for read tools.
    const toolRecords = audit.list().filter((r) => r.event === 'tool');
    expect(toolRecords.map((r) => r.status)).toEqual(['allowed', 'completed']);
    expect(toolRecords.at(-1)?.summary).toBe('1 sources');
    expect(JSON.stringify(audit.list())).not.toContain('alpha 是什么');
    expect(JSON.stringify(audit.list())).not.toContain('notes/a.md');

    // request-spy: 1 tool-call turn + 1 continuation; no embeddings / probe requests.
    expect(spy.count(CHAT_PATH)).toBe(2);
    expect(spy.paths().filter((p) => p !== CHAT_PATH)).toEqual([]);
  });

  it('写工具经 SDK 循环触发审批，批准后执行且审计可见', async () => {
    const { ai } = await configuredAi();
    mock.nextToolCall = { name: 'search_notes', arguments: { query: 'alpha' } };
    let executed = 0;
    const gated = createBuiltinTools({
      retrieve: async () => {
        executed += 1;
        return sourcesResult;
      },
      listPages: () => [],
    }).map((tool) =>
      tool.definition.name === 'search_notes'
        ? { ...tool, definition: { ...tool.definition, requiresApproval: true } }
        : tool,
    );
    const { gateway, audit, of, events } = harness(ai, new ToolRegistry(gated));

    const { runId } = await gateway.run('chat', {
      messages: [{ role: 'user', content: 'alpha' }],
    });
    const approval = await vi.waitFor(() => {
      const [event] = of('approvalRequired');
      if (!event) throw new Error('approval not requested yet');
      return event;
    });
    expect(approval.event.tool).toBe('search_notes');
    expect(gateway.respondApproval(approval.event.approvalId, 'approved')).toBe(true);
    await waitForRun(events, runId);

    expect(executed).toBe(1);
    expect(
      audit
        .list()
        .filter((r) => r.event === 'approval')
        .map((r) => r.status),
    ).toEqual(['started', 'approved']);
    expect(audit.list().some((r) => r.event === 'tool' && r.status === 'completed')).toBe(true);
  });

  it('拒绝写工具审批：工具不执行，事件与审计标记 denied', async () => {
    const { ai } = await configuredAi();
    mock.nextToolCall = { name: 'search_notes', arguments: { query: 'alpha' } };
    let executed = 0;
    const gated = createBuiltinTools({
      retrieve: async () => {
        executed += 1;
        return sourcesResult;
      },
      listPages: () => [],
    }).map((tool) =>
      tool.definition.name === 'search_notes'
        ? { ...tool, definition: { ...tool.definition, requiresApproval: true } }
        : tool,
    );
    const { gateway, audit, of, events } = harness(ai, new ToolRegistry(gated));

    const { runId } = await gateway.run('chat', {
      messages: [{ role: 'user', content: 'alpha' }],
    });
    const approval = await vi.waitFor(() => {
      const [event] = of('approvalRequired');
      if (!event) throw new Error('approval not requested yet');
      return event;
    });
    gateway.respondApproval(approval.event.approvalId, 'denied');
    await waitForRun(events, runId);

    expect(executed).toBe(0);
    expect(of('tool').some((e) => e.event.status === 'denied')).toBe(true);
    expect(
      audit
        .list()
        .filter((r) => r.event === 'approval')
        .map((r) => r.status),
    ).toEqual(['started', 'denied']);
  });

  it('供应商不支持 tools 时降级：去掉工具重试一次并显式留痕', async () => {
    const { ai, spy } = await configuredAi();
    mock.toolsUnsupported = true;
    const tools = registryOf(async () => sourcesResult);
    const { gateway, audit, of, events } = harness(ai, tools);

    const { runId } = await gateway.run('chat', {
      messages: [{ role: 'user', content: 'alpha' }],
    });
    await waitForRun(events, runId);

    // Degradation is explicit (event + audit), never silent.
    expect(of('fallback').length).toBeGreaterThanOrEqual(1);
    expect(
      audit.list().filter((r) => r.event === 'fallback' && r.code === 'PROVIDER_TOOLS_UNSUPPORTED'),
    ).toHaveLength(1);
    // No intermediate error surfaced to the renderer; the run completes.
    expect(of('error')).toHaveLength(0);
    expect(events.some((e) => e.runId === runId && e.event.type === 'done')).toBe(true);
    // First request carried tools (rejected 400), the retry carried none and succeeded.
    expect(spy.count(CHAT_PATH)).toBe(2);
    const withTools = mock.requests.filter(
      (r) => r.url === CHAT_PATH && Array.isArray((r.body as { tools?: unknown[] })?.tools),
    );
    expect(withTools.length).toBeGreaterThanOrEqual(1);
    const lastChat = mock.requests.filter((r) => r.url === CHAT_PATH).at(-1);
    expect((lastChat?.body as { tools?: unknown[] })?.tools).toBeUndefined();
  });

  it('统一注册表：重复注册抛错，Skill 与 Agent 工具同处登记并可扩展', async () => {
    const registry = new ToolRegistry([]);
    const def = (name: string) => ({
      name,
      description: name,
      access: 'read' as const,
      requiresApproval: false,
      inputSchema: {},
    });
    registry.registerAgentTool({ definition: def('agent_tool'), execute: async () => 'a' });
    registry.registerSkill({ definition: def('skill.retrieval-fts'), execute: async () => 's' });
    expect(registry.list().map((t) => t.name)).toEqual(['agent_tool', 'skill.retrieval-fts']);
    expect(registry.get('skill.retrieval-fts')).toBeDefined();
    await expect(
      registry.execute('skill.retrieval-fts', {}, { runId: 'r', scenario: 'chat' }),
    ).resolves.toBe('s');
    expect(() =>
      registry.registerAgentTool({ definition: def('agent_tool'), execute: async () => 'x' }),
    ).toThrowError(/重复注册/);
  });
});
