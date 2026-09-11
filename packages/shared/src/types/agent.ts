import type { ChatMessage, ChatParams, ChatStreamEvent } from './ai';

export type AgentScenario = 'chat' | 'writing' | 'debug';
export type AgentWritingActionId =
  'rewrite' | 'expand' | 'condense' | 'polish' | 'fillgaps' | 'evidence';
export type AgentRunStatus = 'started' | 'completed' | 'cancelled' | 'failed';
export type AgentApprovalDecision = 'approved' | 'denied';

/** Renderer input deliberately carries no provider/profile credentials. */
export interface AgentRunRequest {
  /** chat/debug 消息序列；writing 场景改用 actionId + target。 */
  messages?: ChatMessage[];
  skillIds?: string[];
  contextText?: string;
  params?: ChatParams;
  /** writing 场景动作白名单，由主进程解析 prompt 模板。 */
  actionId?: AgentWritingActionId;
  /** writing 场景选区/块文本；cursor 触发时为空。 */
  target?: string;
}

export type AgentRunEvent =
  | { type: 'start'; model: string }
  | { type: 'fallback'; runtime: AgentRuntimeKind }
  | { type: 'context'; sources: unknown[]; degraded: boolean; retrievalModel?: string | null }
  | { type: 'delta'; text: string }
  | { type: 'reasoningDelta'; text: string }
  | { type: 'tool'; tool: string; status: 'started' | 'completed' | 'denied' }
  | { type: 'approvalRequired'; approvalId: string; tool: string; expiresAt: number }
  | { type: 'done'; usage?: unknown }
  | { type: 'error'; message: string; code?: string };

export interface AgentToolDefinition {
  name: string;
  description: string;
  access: 'read' | 'write';
  requiresApproval: boolean;
  inputSchema: Record<string, unknown>;
}

export interface AgentApprovalRequest {
  approvalId: string;
  runId: string;
  tool: string;
  expiresAt: number;
}
export interface AgentApprovalResponse {
  approvalId: string;
  decision: AgentApprovalDecision;
}
export interface AgentAuditRecord {
  runId: string;
  scenario: AgentScenario;
  event: 'run' | 'tool' | 'approval' | 'fallback';
  status: AgentRunStatus | 'allowed' | 'denied' | 'approved' | 'expired';
  tool?: string;
  code?: string;
  at: number;
  durationMs?: number;
}
export type AgentRuntimeKind = 'pi' | 'builtin-fallback';
/** Runtime 事件还包含受控工具生命周期，gateway 将其转发为 AgentRunEvent。 */
export type AgentInternalEvent = ChatStreamEvent | Extract<AgentRunEvent, { type: 'tool' }>;
