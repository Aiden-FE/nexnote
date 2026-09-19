import type { ChatMessage, ChatParams, ChatStreamEvent, ToolActivityStatus } from './ai';

export type AgentScenario = 'chat' | 'writing' | 'debug' | 'translation';
export type AgentWritingActionId =
  'rewrite' | 'expand' | 'condense' | 'polish' | 'fillgaps' | 'evidence';
export type AgentRunStatus = 'started' | 'completed' | 'cancelled' | 'failed';
export type AgentApprovalDecision = 'approved' | 'denied';
/** Chat Dock 会话级 Agent 工具权限。 */
export type ChatPermissionMode = 'conversation' | 'edit' | 'full';

/** 临时翻译输入形态：划词片段、整篇页面或独立工作台输入。 */
export type AgentTranslationMode = 'selection' | 'document' | 'input';

/** 三种翻译入口共享的单次原文字符上限；超限必须拒绝而非截断。 */
export const TRANSLATION_MAX_TEXT_CHARS = 200_000;

/**
 * 临时翻译请求（DEV-041）：渲染层只提供原文与目标语言，prompt 模板由主进程持有。
 * 翻译无任何文档写回能力——场景工具白名单恒为空。
 */
export interface AgentTranslationRequest {
  mode: AgentTranslationMode;
  targetLanguage: string;
  text: string;
}

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
  /** translation 场景原文与目标语言；params.reasoningEffort 由主进程强制关闭。 */
  translation?: AgentTranslationRequest;
  /** Chat Dock only; writing/translation callers intentionally omit this. */
  permissionMode?: ChatPermissionMode;
  /** Active document paths used by the full-mode scope guard. */
  contextPaths?: string[];
}

export type AgentRunEvent =
  | { type: 'start'; model: string }
  | { type: 'fallback'; runtime: AgentRuntimeKind }
  | { type: 'context'; sources: unknown[]; degraded: boolean; retrievalModel?: string | null }
  | { type: 'delta'; text: string }
  | { type: 'reasoningDelta'; text: string }
  | { type: 'tool'; tool: string; status: ToolActivityStatus; summary?: string }
  | {
      type: 'approvalRequired';
      approvalId: string;
      tool: string;
      expiresAt: number;
      proposalIds?: string[];
    }
  | { type: 'editProposals'; batchId: string; proposals: AgentEditProposal[] }
  | { type: 'done'; usage?: unknown }
  | { type: 'error'; message: string; code?: string };

export interface AgentToolDefinition {
  name: string;
  description: string;
  access: 'read' | 'write';
  requiresApproval: boolean;
  inputSchema: Record<string, unknown>;
  /** Writes are grouped by turn so edit mode can approve a complete diff batch. */
  batchable?: boolean;
}

/** A single document edit proposed by an agent turn. */
export interface AgentDocumentEdit {
  path: string;
  operation: 'replace' | 'append';
  content: string;
  /** Required for replace; protects against stale or out-of-scope writes. */
  expectedText?: string;
  start?: number;
  end?: number;
}

export interface AgentApprovalRequest {
  approvalId: string;
  runId: string;
  tool: string;
  expiresAt: number;
  proposalIds?: string[];
}

export interface AgentEditProposal {
  proposalId: string;
  tool: string;
  input: Record<string, unknown>;
  summary: string;
  status: 'pending' | 'accepted' | 'rejected' | 'failed';
}

export interface AgentEditBatch {
  batchId: string;
  runId: string;
  proposals: AgentEditProposal[];
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
  /**
   * 脱敏结果摘要（如「3 sources」），仅用于 UI/审计可读性；
   * 绝不包含工具输入、原始结果或文档内容。
   */
  summary?: string;
  code?: string;
  at: number;
  durationMs?: number;
}
export type AgentRuntimeKind = 'pi' | 'builtin-fallback';
/** Runtime 事件还包含受控工具生命周期，gateway 将其转发为 AgentRunEvent。 */
export type AgentInternalEvent = ChatStreamEvent | Extract<AgentRunEvent, { type: 'tool' }>;
