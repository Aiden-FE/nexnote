import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AgentRunEvent } from '@nexnote/shared';
import { AgentGateway } from '../src/agent/gateway';
import { ToolRegistry, type AgentTool } from '../src/agent/tool-registry';
import { AiService } from '../src/ai/ai-service';
import { AiStore } from '../src/ai/ai-store';
import type { SecretVault } from '../src/ai/secret-store';
import { startMockOpenAiServer, type MockOpenAiServer } from './helpers/mock-openai';

/**
 * DEV-037：writing 场景经真实适配器 + mock provider 的逐片段推送。
 * 覆盖「首片段即显示」的请求层基础（增量 delta）与中途断线的失败语义。
 * 冒烟（真实 Chromium）再覆盖界面侧状态机；两者共用同一 mock 服务器实现。
 */

const roots: string[] = [];
let mock: MockOpenAiServer;

beforeAll(async () => {
  mock = await startMockOpenAiServer({ chunkDelayMs: 5 });
});
afterAll(async () => {
  await mock.close();
});
afterEach(async () => {
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

function readTool(name: string): AgentTool {
  return {
    definition: {
      name,
      description: name,
      access: 'read',
      requiresApproval: false,
      inputSchema: {},
    },
    execute: async (input) => ({ hits: [], input }),
  };
}

/** App-like wiring: 无密钥 Profile 指向 mock（mock 不校验鉴权头），工具注册与生产一致。 */
async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'nexnote-writing-stream-'));
  roots.push(dir);
  const ai = new AiService({
    store: new AiStore(path.join(dir, 'ai.json'), fakeVault()),
    sendEvent: () => undefined,
  });
  const baseUrl = `${mock.url}/v1`;
  const { id } = ai.saveProfile(undefined, {
    name: 'mock provider',
    kind: 'openai-compatible',
    baseUrl,
    defaultModel: 'gpt-4o-mini',
  });
  ai.setDefaultProfile(id);
  ai.setFeatureAssignment('writing', { profileId: id, model: 'gpt-4o-mini' });

  const events: Array<{ runId: string; event: AgentRunEvent }> = [];
  const gateway = new AgentGateway({
    ai,
    tools: new ToolRegistry([readTool('search_notes'), readTool('list_pages')]),
    sendEvent: (_channel, payload) =>
      events.push(payload as { runId: string; event: AgentRunEvent }),
  });
  const runWriting = async () => {
    const { runId } = await gateway.run('writing', {
      actionId: 'rewrite',
      target: '第一块',
      contextText: '【当前文档】\n第一块\n第二块',
    });
    const terminal = () =>
      events.find(
        (e) => e.runId === runId && (e.event.type === 'done' || e.event.type === 'error'),
      );
    const deadline = Date.now() + 15_000;
    while (!terminal() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    const deltas = events
      .filter((e) => e.runId === runId && e.event.type === 'delta')
      .map((e) => (e.event as Extract<AgentRunEvent, { type: 'delta' }>).text);
    return { runId, terminal: terminal()?.event, deltas, paths: mock.requests.map((r) => r.url) };
  };
  return { gateway, runWriting };
}

describe('DEV-037 writing 场景流式（真实适配器 + mock provider）', () => {
  it('逐片段推送：多个增量 delta 后以 done 结束，且只请求 chat/completions', async () => {
    mock.requests.length = 0;
    mock.chunkDelayMs = 5;
    const { runWriting } = await setup();
    const { terminal, deltas, paths } = await runWriting();

    expect(deltas.length).toBeGreaterThan(1); // 分段到达，而非一次性整块
    expect(deltas.join('')).toBe('你好，流式回复');
    expect(terminal).toMatchObject({ type: 'done' });
    expect(paths.filter((p) => p.endsWith('/chat/completions'))).toHaveLength(1);
    // 回归护栏：writing scenario 的 system prompt 必须以 system 角色到达 provider
    // （ai@7 只接受 instructions；若退回 messages 中的 system 会整体失败）。
    const body = mock.requests.at(-1)?.body as {
      messages?: Array<{ role: string; content: string }>;
    };
    const wireMessages = body?.messages ?? [];
    expect(wireMessages[0]?.role).toBe('system');
    expect(wireMessages[0]?.content).toContain('Markdown 笔记写作助手');
    expect(wireMessages.at(-1)?.role).toBe('user');
    expect(wireMessages.at(-1)?.content).toContain('第一块');
  });

  it('中途断线：已到达片段保留，终止事件为 error（不是 done）', async () => {
    mock.requests.length = 0;
    mock.chunkDelayMs = 30;
    mock.failAfterChunks = 3;
    try {
      const { runWriting } = await setup();
      const { terminal, deltas } = await runWriting();
      expect(deltas.length).toBeGreaterThan(0);
      expect(deltas.join('')).not.toBe('你好，流式回复');
      expect(terminal?.type).toBe('error');
    } finally {
      mock.failAfterChunks = undefined;
      mock.chunkDelayMs = 5;
    }
  });

  it('provider 请求失败：终止事件为 error，无 done', async () => {
    mock.requests.length = 0;
    mock.failNextChatWith = 500;
    const { runWriting } = await setup();
    const { terminal, deltas } = await runWriting();
    expect(deltas).toEqual([]);
    expect(terminal?.type).toBe('error');
  });
});
