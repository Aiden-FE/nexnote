import type {
  AgentInternalEvent,
  AgentRunRequest,
  AgentRuntimeKind,
  AgentScenario,
} from '@nexnote/shared';
import type { AiService } from '../ai/ai-service';
import type { ChatStreamHandle } from '../ai/provider/types';

export interface AgentRuntimeTask {
  request: AgentRunRequest;
  messages: AgentRunRequest['messages'];
  scenario?: AgentScenario;
  onEvent: (event: AgentInternalEvent) => void;
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
      },
      task.onEvent,
    );
  }
}
/** Replaceable seam for a future Pi SDK adapter. No third-party SDK is imported in v1. */
export class PiRuntime implements AgentRuntime {
  readonly kind = 'pi' as const;
  constructor(
    private readonly fallback: BuiltinLoopRuntime,
    private readonly available = false,
  ) {}
  run(task: AgentRuntimeTask): ChatStreamHandle {
    return this.fallback.run(task);
  }
}
