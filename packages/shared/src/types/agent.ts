import type { ChatMessage, ChatParams, ChatStreamEvent } from './ai';

export type AgentScenario = 'chat' | 'writing' | 'debug';
export type AgentRunStatus = 'started' | 'completed' | 'cancelled' | 'failed';
export type AgentApprovalDecision = 'approved' | 'denied';

/** Renderer input deliberately carries no provider/profile credentials. */
export interface AgentRunRequest {
  messages: ChatMessage[];
  skillIds?: string[];
  contextText?: string;
  params?: ChatParams;
}

export type AgentRunEvent =
  | { type: 'start'; model: string }
  | { type: 'context'; sources: unknown[]; degraded: boolean }
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
export interface AgentApprovalResponse { approvalId: string; decision: AgentApprovalDecision; }
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
export type AgentInternalEvent = ChatStreamEvent;
