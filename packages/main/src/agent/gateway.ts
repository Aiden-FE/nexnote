import { randomUUID } from 'node:crypto';
import type { AgentRunEvent, AgentRunRequest, AgentScenario, IpcEventMap } from '@nexnote/shared';
import type { AiService } from '../ai/ai-service';
import type { ChatStreamHandle } from '../ai/provider/types';
import { AuditStore } from './audit-store';
import { ApprovalStore } from './approval-store';
import { BuiltinLoopRuntime, PiRuntime } from './runtime';
import type { ToolRegistry } from './tool-registry';

const TTL_MS = 10 * 60_000;
const PROFILES: Record<AgentScenario, { system: string; tools: string[] }> = {
  chat: { system: '你是 NexNote 内置知识库对话助手。基于提供的上下文回答，不要编造来源。', tools: [] },
  writing: { system: '你是 NexNote Markdown 写作助手。只输出处理后的正文，不要解释。', tools: [] },
  debug: { system: '你是 NexNote 内置调试助手。简洁回答并指出不确定性。', tools: [] },
};

export interface AgentGatewayDeps {
  ai: AiService;
  sendEvent: <C extends keyof IpcEventMap>(channel: C, payload: IpcEventMap[C]) => void;
  piAvailable?: boolean;
  tools?: ToolRegistry;
  approvals?: ApprovalStore;
  audit?: AuditStore;
}

export class AgentGateway {
  readonly approvals: ApprovalStore;
  readonly audit: AuditStore;
  private readonly active = new Map<string, ChatStreamHandle>();
  private readonly runtime: PiRuntime;
  constructor(private readonly deps: AgentGatewayDeps) {
    this.approvals = deps.approvals ?? new ApprovalStore();
    this.audit = deps.audit ?? new AuditStore();
    this.runtime = new PiRuntime(new BuiltinLoopRuntime(deps.ai), deps.piAvailable ?? false);
  }
  run(scenario: AgentScenario, request: AgentRunRequest): { runId: string } {
    const runId = randomUUID();
    const profile = PROFILES[scenario];
    const messages = [{ role: 'system' as const, content: profile.system }, ...request.messages.filter((m) => m.role !== 'system')];
    const emit = (event: AgentRunEvent) => this.deps.sendEvent('agent:runEvent', { runId, scenario, event });
    emit({ type: 'start', model: 'configured' });
    if (!this.deps.piAvailable) emit({ type: 'context', sources: [], degraded: true });
    const started = Date.now();
    let handle: ChatStreamHandle;
    try {
      handle = this.runtime.run({ request, messages, onEvent: (event) => emit(event as AgentRunEvent) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({ type: 'error', message, code: (error as { code?: string }).code ?? 'AI_NOT_CONFIGURED' });
      this.audit.append({ runId, scenario, event: 'run', status: 'failed', code: 'AI_NOT_CONFIGURED', at: Date.now(), durationMs: Date.now() - started });
      return { runId };
    }
    this.active.set(runId, handle);
    const timer = setTimeout(() => this.cancel(runId, scenario, 'TTL_EXPIRED'), TTL_MS);
    void handle.done.then(() => {
      clearTimeout(timer); this.active.delete(runId);
      this.audit.append({ runId, scenario, event: 'run', status: 'completed', at: Date.now(), durationMs: Date.now() - started });
    }).catch(() => undefined);
    return { runId };
  }
  cancel(runId: string, scenario: AgentScenario = 'chat', code = 'CANCELLED'): boolean {
    const handle = this.active.get(runId); if (!handle) return false;
    handle.abort(); this.active.delete(runId);
    this.audit.append({ runId, scenario, event: 'run', status: 'cancelled', code, at: Date.now() });
    return true;
  }
  respondApproval(id: string, decision: 'approved' | 'denied'): boolean { return this.approvals.respond(id, decision); }
  listTools(): ReturnType<ToolRegistry['list']> { return this.deps.tools?.list() ?? []; }
}
