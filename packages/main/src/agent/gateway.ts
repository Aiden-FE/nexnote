import { randomUUID } from 'node:crypto';
import type { AgentRunEvent, AgentRunRequest, AgentScenario, IpcEventMap } from '@nexnote/shared';
import type { AiService } from '../ai/ai-service';
import type { ChatStreamHandle } from '../ai/provider/types';
import { AuditStore } from './audit-store';
import { ApprovalStore } from './approval-store';
import { BuiltinLoopRuntime, PiRuntime } from './runtime';
import type { ToolRegistry } from './tool-registry';
import type { SkillService } from '../skills/skill-service';

const TTL_MS = 10 * 60_000;
export const AGENT_SCENARIO_PROFILES: Record<AgentScenario, { system: string; tools: string[] }> = {
  chat: {
    system: '你是 NexNote 内置知识库对话助手。基于提供的上下文回答，不要编造来源。',
    tools: ['search_notes', 'list_pages'],
  },
  writing: {
    system: '你是 NexNote Markdown 写作助手。只输出处理后的正文，不要解释。',
    tools: ['search_notes', 'list_pages'],
  },
  debug: {
    system: '你是 NexNote 内置调试助手。简洁回答并指出不确定性。',
    tools: ['search_notes', 'list_pages'],
  },
};

type RunState = {
  scenario: AgentScenario;
  started: number;
  status: 'active' | 'completed' | 'cancelled' | 'error';
  handle?: ChatStreamHandle;
  timer?: ReturnType<typeof setTimeout>;
};
export interface AgentGatewayDeps {
  ai: AiService;
  sendEvent: <C extends keyof IpcEventMap>(channel: C, payload: IpcEventMap[C]) => void;
  piAvailable?: boolean;
  tools?: ToolRegistry;
  approvals?: ApprovalStore;
  audit?: AuditStore;
  skills?: SkillService;
}

export class AgentGateway {
  readonly approvals: ApprovalStore;
  readonly audit: AuditStore;
  private readonly active = new Map<string, RunState>();
  private readonly runtime: PiRuntime;
  constructor(private readonly deps: AgentGatewayDeps) {
    this.approvals = deps.approvals ?? new ApprovalStore();
    this.audit = deps.audit ?? new AuditStore();
    this.runtime = new PiRuntime(new BuiltinLoopRuntime(deps.ai), deps.piAvailable ?? false);
  }
  run(scenario: AgentScenario, request: AgentRunRequest): { runId: string } {
    const runId = randomUUID();
    const profile = AGENT_SCENARIO_PROFILES[scenario];
    const state: RunState = { scenario, started: Date.now(), status: 'active' };
    this.active.set(runId, state);
    const emit = (event: AgentRunEvent) =>
      this.deps.sendEvent('agent:runEvent', { runId, scenario, event });
    const assignment = this.deps.ai.getState().features[scenario === 'debug' ? 'chat' : scenario];
    const model =
      assignment?.model ??
      this.deps.ai
        .getState()
        .profiles.find((p) => p.id === this.deps.ai.getState().defaultProfileId)?.defaultModel ??
      'unknown';
    emit({ type: 'start', model });
    if (!this.deps.piAvailable) emit({ type: 'context', sources: [], degraded: true });
    const context = request.contextText?.trim();
    const messages = [
      { role: 'system' as const, content: profile.system },
      ...(context ? [{ role: 'system' as const, content: `参考上下文：\n${context}` }] : []),
      ...request.messages.filter((m) => m.role !== 'system'),
    ];
    let handle: ChatStreamHandle;
    try {
      handle = this.runtime.run({
        request,
        messages,
        scenario,
        onEvent: (event) => emit(event as AgentRunEvent),
      });
    } catch (error) {
      this.finishError(runId, error, emit);
      return { runId };
    }
    state.handle = handle;
    state.timer = setTimeout(() => this.cancel(runId, scenario, 'TTL_EXPIRED'), TTL_MS);
    void handle.done
      .then(() => this.finish(runId, 'completed'))
      .catch((error) => this.finishError(runId, error, emit));
    return { runId };
  }
  private finish(
    runId: string,
    status: 'completed' | 'cancelled' | 'error',
    code?: string,
  ): boolean {
    const state = this.active.get(runId);
    if (!state || state.status !== 'active') return false;
    state.status = status;
    if (state.timer) clearTimeout(state.timer);
    this.active.delete(runId);
    this.approvals.revokeRun(runId);
    this.audit.append({
      runId,
      scenario: state.scenario,
      event: 'run',
      status: status === 'error' ? 'failed' : status,
      ...(code ? { code } : {}),
      at: Date.now(),
      durationMs: Date.now() - state.started,
    });
    return true;
  }
  private finishError(runId: string, error: unknown, emit: (event: AgentRunEvent) => void): void {
    const code = (error as { code?: string })?.code ?? 'AGENT_RUNTIME_ERROR';
    const message = error instanceof Error ? error.message : 'Agent runtime failed';
    if (this.finish(runId, 'error', code)) emit({ type: 'error', message, code });
  }
  cancel(runId: string, _scenario: AgentScenario = 'chat', code = 'CANCELLED'): boolean {
    const state = this.active.get(runId);
    if (!state || state.status !== 'active') return false;
    state.handle?.abort();
    return this.finish(runId, 'cancelled', code);
  }
  async executeTool(runId: string, name: string, input: unknown): Promise<unknown> {
    const state = this.active.get(runId);
    if (!state) throw new Error('RUN_NOT_ACTIVE');
    const allowed = AGENT_SCENARIO_PROFILES[state.scenario].tools;
    const tool = this.deps.tools?.list().find((item) => item.name === name);
    if (!tool || !allowed.includes(name)) {
      this.audit.append({
        runId,
        scenario: state.scenario,
        event: 'tool',
        status: 'denied',
        tool: name,
        code: 'TOOL_NOT_ALLOWED',
        at: Date.now(),
      });
      throw new Error('TOOL_NOT_ALLOWED');
    }
    if (tool.access === 'write' || tool.requiresApproval) {
      const approvalId = randomUUID();
      const expiresAt = this.approvals.request(approvalId, name, runId);
      const emit = (event: AgentRunEvent) =>
        this.deps.sendEvent('agent:runEvent', { runId, scenario: state.scenario, event });
      emit({ type: 'approvalRequired', approvalId, tool: name, expiresAt });
      this.audit.append({
        runId,
        scenario: state.scenario,
        event: 'approval',
        status: 'started',
        tool: name,
        at: Date.now(),
      });
      throw new Error('APPROVAL_REQUIRED');
    }
    this.audit.append({
      runId,
      scenario: state.scenario,
      event: 'tool',
      status: 'allowed',
      tool: name,
      at: Date.now(),
    });
    return this.deps.tools!.execute(name, input, { runId, scenario: state.scenario });
  }
  respondApproval(id: string, decision: 'approved' | 'denied'): boolean {
    return this.approvals.respond(id, decision);
  }
  listTools(): ReturnType<ToolRegistry['list']> {
    return this.deps.tools?.list() ?? [];
  }
}
