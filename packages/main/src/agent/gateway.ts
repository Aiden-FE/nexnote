import { randomUUID } from 'node:crypto';
import type {
  AgentRunEvent,
  AgentRunRequest,
  AgentScenario,
  AgentWritingActionId,
  IpcEventMap,
} from '@nexnote/shared';
import type { AiService } from '../ai/ai-service';
import type { ChatStreamHandle } from '../ai/provider/types';
import { AuditStore } from './audit-store';
import { ApprovalStore } from './approval-store';
import { BuiltinLoopRuntime, PiRuntime, ToolLoopRuntime } from './runtime';
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
    system: '你是 NexNote 知识库助手。简洁回答并指出不确定性。',
    tools: ['search_notes', 'list_pages'],
  },
};

const WRITING_BASE =
  '你是 NexNote 内置的 Markdown 笔记写作助手。' +
  '严格只输出处理后的正文（Obsidian 方言 Markdown），不要任何解释、前后缀或代码围栏。' +
  '保持原文语言，保留其中的双链 [[...]]、标签 #tag 与 ^id 块锚点语法。';
const writingContext = (context: string) =>
  context.trim() ? `\n\n【参考上下文（可能已被截断，仅供理解，不要照抄）】\n${context.trim()}` : '';
const writingAction = (systemTask: string, user: (target: string, context: string) => string) => ({
  system: `${WRITING_BASE}\n任务：${systemTask}`,
  buildUserPrompt: user,
});
export const AGENT_WRITING_ACTIONS: Record<
  AgentWritingActionId,
  { system: string; buildUserPrompt: (target: string, context: string) => string }
> = {
  rewrite: writingAction(
    '在保持原意的前提下改写文本，使表达更清晰流畅，可调整句式但不增删观点。',
    (target, context) =>
      `请改写下面的文本，输出改写后的完整正文。\n\n【待改写文本】\n${target}${writingContext(context)}`,
  ),
  polish: writingAction(
    '润色文本，修正语病、错别字与标点，提升措辞，尽量不改变结构与长度。',
    (target, context) =>
      `请润色下面的文本，输出润色后的完整正文。\n\n【待润色文本】\n${target}${writingContext(context)}`,
  ),
  condense: writingAction(
    '缩写文本，保留核心观点，去除冗余，输出更精炼的正文。',
    (target, context) =>
      `请缩写下面的文本，保留要点，输出缩写后的正文。\n\n【待缩写文本】\n${target}${writingContext(context)}`,
  ),
  expand: writingAction(
    '基于给定文本扩写，补充细节与阐释，输出要新增的正文段落，不要重复原文。',
    (target, context) =>
      `请基于下面的文本扩写，输出要新增的正文（Markdown），不要重复已有内容。\n\n【当前文本】\n${target || '（空块，请基于上文自由展开）'}${writingContext(context)}`,
  ),
  fillgaps: writingAction(
    '检查文本的论证/信息缺口，补充缺失的衔接、前提或必要说明，输出要新增的正文。',
    (target, context) =>
      `请检查下面文本的缺漏并补充，输出要新增的正文（Markdown），不要重复原文。\n\n【当前文本】\n${target}${writingContext(context)}`,
  ),
  evidence: writingAction(
    '为文本的观点补充支撑论据、例子或说明，输出要新增的正文，使用列表组织多条论据。',
    (target, context) =>
      `请为下面文本的观点补充论据/例子，输出要新增的正文（Markdown，列表为佳）。\n\n【当前文本】\n${target}${writingContext(context)}`,
  ),
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
    const builtin = new BuiltinLoopRuntime(deps.ai);
    const loop = new ToolLoopRuntime(
      builtin,
      { allowed: ['search_notes', 'list_pages'] },
      (runId, name, input) => this.executeTool(runId, name, input),
    );
    this.runtime = new PiRuntime(loop, deps.piAvailable ?? false);
  }

  async run(scenario: AgentScenario, request: AgentRunRequest): Promise<{ runId: string }> {
    const runId = randomUUID();
    const profile = AGENT_SCENARIO_PROFILES[scenario];
    const state: RunState = { scenario, started: Date.now(), status: 'active' };
    this.active.set(runId, state);
    const emit = (event: AgentRunEvent) =>
      this.deps.sendEvent('agent:runEvent', { runId, scenario, event });
    const assignment = this.deps.ai.getState().features[scenario === 'debug' ? 'chat' : scenario];
    const aiState = this.deps.ai.getState();
    const assignedProfile = assignment
      ? aiState.profiles.find((p) => p.id === assignment.profileId)
      : undefined;
    const model =
      (assignedProfile ? assignment?.model : undefined) ??
      aiState.profiles.find((p) => p.id === aiState.defaultProfileId)?.defaultModel ??
      'unknown';
    emit({ type: 'start', model });
    if (!this.deps.piAvailable) {
      emit({ type: 'fallback', runtime: 'builtin-fallback' });
      this.audit.append({
        runId,
        scenario,
        event: 'fallback',
        status: 'started',
        code: 'PI_RUNTIME_UNAVAILABLE',
        at: Date.now(),
      });
    }
    const incomingMessages = request.messages ?? [];
    const lastUser = request.actionId
      ? (request.target ?? '')
      : ([...incomingMessages].reverse().find((m) => m.role === 'user')?.content ?? '');
    if (request.skillIds && !this.deps.skills) {
      this.finishError(
        runId,
        Object.assign(new Error('SkillService 不可用'), { code: 'SKILL_SERVICE_UNAVAILABLE' }),
        emit,
      );
      return { runId };
    }
    let skillContext = '';
    if (this.deps.skills && (request.skillIds !== undefined || lastUser)) {
      let retrieved;
      try {
        retrieved = await this.deps.skills.retrieve({
          query: lastUser,
          skillIds: request.skillIds,
          budgetChars: 2000,
        });
      } catch (error) {
        this.finishError(
          runId,
          Object.assign(error instanceof Error ? error : new Error('Skill 检索失败'), {
            code: 'SKILL_RETRIEVE_FAILED',
          }),
          emit,
        );
        return { runId };
      }
      if (
        request.skillIds !== undefined &&
        retrieved.usedSkillIds.length !== request.skillIds.length
      ) {
        this.finishError(
          runId,
          Object.assign(new Error('skillIds 含未启用或不存在的 Skill'), {
            code: 'SKILL_NOT_ALLOWED',
          }),
          emit,
        );
        return { runId };
      }
      skillContext = retrieved.contextText;
      emit({ type: 'context', sources: retrieved.sources, degraded: retrieved.degraded });
    }
    const context = [request.contextText?.trim(), skillContext.trim()].filter(Boolean).join('\n\n');
    // writing 场景：渲染层只带白名单 actionId + 选区/上下文；prompt 模板全部由主进程持有。
    const messages = request.actionId
      ? [
          { role: 'system' as const, content: profile.system },
          { role: 'system' as const, content: AGENT_WRITING_ACTIONS[request.actionId].system },
          {
            role: 'user' as const,
            content: AGENT_WRITING_ACTIONS[request.actionId].buildUserPrompt(
              request.target ?? '',
              context,
            ),
          },
        ]
      : [
          { role: 'system' as const, content: profile.system },
          ...(context ? [{ role: 'system' as const, content: `参考上下文：\n${context}` }] : []),
          ...incomingMessages.filter((m) => m.role !== 'system'),
        ];
    let terminalError: Extract<AgentRunEvent, { type: 'error' }> | undefined;
    let handle: ChatStreamHandle;
    try {
      handle = this.runtime.run({
        runId,
        request,
        toolQueries: this.buildPreToolQueries(scenario, request, lastUser),
        messages,
        scenario,
        onEvent: (event) => {
          if (event.type === 'error') terminalError = event;
          emit(event);
        },
      });
    } catch (error) {
      this.finishError(runId, error, emit);
      return { runId };
    }
    state.handle = handle;
    state.timer = setTimeout(() => this.cancel(runId, scenario, 'TTL_EXPIRED'), TTL_MS);
    void handle.done
      .then(() => {
        if (terminalError?.type === 'error')
          this.finish(runId, 'error', terminalError.code ?? 'AGENT_RUNTIME_ERROR');
        else this.finish(runId, 'completed');
      })
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
  /** 受控 pre-tool phase：skill 路径未接管时，经 executeTool 执行只读工具。 */
  private buildPreToolQueries(
    scenario: AgentScenario,
    request: AgentRunRequest,
    lastUser: string,
  ): Array<{ name: string; input: unknown }> {
    if (!this.deps.tools || request.skillIds !== undefined || !lastUser) return [];
    const profile = AGENT_SCENARIO_PROFILES[scenario];
    const queries: Array<{ name: string; input: unknown }> = [];
    if (profile.tools.includes('search_notes'))
      queries.push({ name: 'search_notes', input: { query: lastUser } });
    if (scenario === 'debug' && profile.tools.includes('list_pages'))
      queries.push({ name: 'list_pages', input: {} });
    return queries;
  }
  cancel(runId: string, _scenario: AgentScenario = 'chat', code = 'CANCELLED'): boolean {
    const state = this.active.get(runId);
    if (!state || state.status !== 'active') return false;
    state.handle?.abort();
    const emit = (event: AgentRunEvent) =>
      this.deps.sendEvent('agent:runEvent', { runId, scenario: state.scenario, event });
    if (code === 'TTL_EXPIRED') {
      if (!this.finish(runId, 'error', code)) return false;
      emit({ type: 'error', message: 'Agent runtime timed out', code });
      return true;
    }
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
      throw Object.assign(new Error('工具未获准执行'), { code: 'TOOL_NOT_ALLOWED' });
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
      const decision = await this.approvals.wait(approvalId, name, runId);
      const approved = decision === 'approved' && this.approvals.consume(approvalId, name, runId);
      this.audit.append({
        runId,
        scenario: state.scenario,
        event: 'approval',
        status: approved ? 'approved' : 'denied',
        tool: name,
        at: Date.now(),
      });
      if (!approved) {
        emit({ type: 'tool', tool: name, status: 'denied' });
        throw Object.assign(new Error('工具审批被拒绝'), { code: 'APPROVAL_DENIED' });
      }
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
