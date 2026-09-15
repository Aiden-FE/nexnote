import type {
  AgentInternalEvent,
  AgentRunRequest,
  AgentRuntimeKind,
  AgentScenario,
  ChatMessage,
} from '@nexnote/shared';
import type { AiService } from '../ai/ai-service';
import type { ChatStreamHandle, ChatTool } from '../ai/provider/types';

export interface AgentRuntimeTask {
  runId: string;
  request: AgentRunRequest;
  messages: ChatMessage[];
  scenario?: AgentScenario;
  onEvent: (event: AgentInternalEvent) => void;
  /** SDK tool set prepared by the gateway; the adapter owns the native loop. */
  tools?: ChatTool[];
}
export interface AgentRuntime {
  readonly kind: AgentRuntimeKind;
  run(task: AgentRuntimeTask): ChatStreamHandle;
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
        ...(task.tools ? { tools: task.tools } : {}),
      },
      task.onEvent,
    );
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
