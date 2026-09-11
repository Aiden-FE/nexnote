import type {
  AgentInternalEvent,
  AgentRunRequest,
  AgentRuntimeKind,
  AgentScenario,
  ChatMessage,
} from '@nexnote/shared';
import type { AiService } from '../ai/ai-service';
import type { ChatStreamHandle } from '../ai/provider/types';

export interface AgentRuntimeTask {
  runId: string;
  request: AgentRunRequest;
  messages: ChatMessage[];
  scenario?: AgentScenario;
  onEvent: (event: AgentInternalEvent) => void;
  /** 受控 scenario pre-tool phase；仅主进程生成，renderer 无法指定。 */
  toolQueries?: ToolCallRequest[];
}
export interface AgentRuntime {
  readonly kind: AgentRuntimeKind;
  run(task: AgentRuntimeTask): ChatStreamHandle;
}

/** 模型方请求调用工具（provider tool call / scenario pre-tool phase）。 */
export interface ToolCallRequest {
  name: string;
  input: unknown;
}

function errorWithCode(error: unknown): { code: string; message: string } {
  const code = (error as { code?: string })?.code;
  return {
    code: typeof code === 'string' && code ? code : 'AGENT_TOOL_ERROR',
    message: error instanceof Error ? error.message : '工具执行失败',
  };
}

export class BuiltinLoopRuntime implements AgentRuntime {
  readonly kind = 'builtin-fallback' as const;
  constructor(private readonly ai: AiService) {}
  run(task: AgentRuntimeTask): ChatStreamHandle {
    return this.ai.openChatStream(
      {
        messages: task.messages,
        feature: task.scenario === 'debug' ? 'chat' : (task.scenario ?? 'chat'),
        params: task.request.params,
      },
      task.onEvent,
    );
  }
}

/**
 * 内置 tool loop runtime：由 scenario pre-tool phase 驱动，
 * 在请求主模型前执行受控只读工具，把结果注入为模型上下文。
 * 工具执行经 gateway.executeTool（allowlist/approval/审计全部生效）。
 */
export class ToolLoopRuntime implements AgentRuntime {
  readonly kind = 'builtin-fallback' as const;
  constructor(
    private readonly fallback: BuiltinLoopRuntime,
    private readonly tools: { allowed: string[] },
    private readonly execute: (runId: string, name: string, input: unknown) => Promise<unknown>,
  ) {}
  run(task: AgentRuntimeTask): ChatStreamHandle {
    const controller = new AbortController();
    let inner: ChatStreamHandle | undefined;
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => (resolveDone = resolve));
    void (async () => {
      try {
        const queries = (task.toolQueries ?? []).filter((q) => this.tools.allowed.includes(q.name));
        const results: string[] = [];
        for (const q of queries) {
          if (controller.signal.aborted)
            throw Object.assign(new Error('已取消'), { code: 'CANCELLED' });
          task.onEvent({ type: 'tool', tool: q.name, status: 'started' });
          const result = await this.execute(task.runId, q.name, q.input);
          results.push(`【${q.name}】\\n${JSON.stringify(result)}`);
          task.onEvent({ type: 'tool', tool: q.name, status: 'completed' });
        }
        const messages = results.length
          ? [
              ...task.messages,
              { role: 'system' as const, content: `【工具结果】\\n${results.join('\\n\\n')}` },
            ]
          : task.messages;
        if (controller.signal.aborted) return;
        inner = this.fallback.run({ ...task, messages });
        await inner.done;
      } catch (error) {
        const e = errorWithCode(error);
        task.onEvent({ type: 'error', message: e.message, code: e.code });
      } finally {
        resolveDone();
      }
    })();
    return {
      abort: () => {
        controller.abort();
        inner?.abort();
      },
      done,
    };
  }
}

/** Replaceable seam for a future Pi SDK adapter. No third-party SDK is imported in v1. */
export class PiRuntime implements AgentRuntime {
  readonly kind = 'pi' as const;
  constructor(
    private readonly fallback: AgentRuntime,
    private readonly available = false,
  ) {}
  run(task: AgentRuntimeTask): ChatStreamHandle {
    return this.fallback.run(task);
  }
}
