import type {
  AgentInternalEvent,
  AgentRunRequest,
  AgentRuntimeKind,
  AgentScenario,
  ChatMessage,
} from '@nexnote/shared';
import type { AiService } from '../ai/ai-service';
import type { ChatStreamHandle, ChatTool } from '../ai/provider/types';
import { createReasoningStreamFilter } from './reasoning-filter';

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
    if (task.scenario !== 'translation') return this.openStream(task, task.onEvent);

    const filter = createReasoningStreamFilter();
    let acceptingEvents = true;
    const handle = this.openStream(task, (event) => {
      if (!acceptingEvents) return;
      if (event.type === 'reasoningDelta') return;
      if (event.type === 'delta') {
        const text = filter.push(event.text);
        if (text) task.onEvent({ type: 'delta', text });
        return;
      }
      if (event.type === 'done') {
        const text = filter.finish();
        if (text) task.onEvent({ type: 'delta', text });
        task.onEvent(event);
        acceptingEvents = false;
        return;
      }
      task.onEvent(event);
      if (event.type === 'error') acceptingEvents = false;
    });

    return {
      done: handle.done,
      abort: () => {
        acceptingEvents = false;
        handle.abort();
      },
    };
  }

  private openStream(
    task: AgentRuntimeTask,
    onEvent: (event: AgentInternalEvent) => void,
  ): ChatStreamHandle {
    return this.ai.openChatStream(
      {
        messages: task.messages,
        feature:
          task.scenario === 'debug'
            ? 'chat'
            : task.scenario === 'translation'
              ? 'writing'
              : (task.scenario ?? 'chat'),
        params: task.request.params,
        ...(task.tools ? { tools: task.tools } : {}),
      },
      onEvent,
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
