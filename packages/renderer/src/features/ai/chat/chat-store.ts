import { create } from 'zustand';
import type {
  AgentApprovalDecision,
  ChatPermissionMode,
  ChatSession,
  ChatSessionStatus,
  ChatSummary,
} from '@nexnote/shared';
import { invoke } from '../../../lib/ipc';
import type { ChatContextChip } from './context';

/** 从选区「询问 AI」进入对话 dock 的待处理载荷（DEV-012 交付内容 7）。 */
export interface AskPayload {
  selectionText: string;
  docTitle: string | null;
  docPath: string | null;
}

/** Agent 工具请求用户审批的待处理载荷（git_doctor_repair / edit_current_selection 等）。 */
export interface PendingApproval {
  approvalId: string;
  tool: string;
  /** 可读操作说明；git doctor 审批时明确展示医生推荐动作。 */
  summary?: string;
  /** 过期时间戳（ms）。 */
  expiresAt: number;
}

interface ChatState {
  /** 历史会话列表（dock 历史面板；按搜索词过滤后的结果）。 */
  summaries: ChatSummary[];
  /** 当前会话；null = 尚未开始（欢迎空态）。 */
  active: ChatSession | null;
  /** true = 当前会话还未落盘（首条消息后才写文件）。 */
  isDraft: boolean;
  /** 当前会话末次持久化状态（未完成/取消/失败可见并可恢复）。 */
  sessionStatus: ChatSessionStatus;
  streaming: boolean;
  error: string | null;
  /** 流式回答使用的模型标签。 */
  modelLabel: string | null;
  /** 上下文注入 chips。 */
  chips: ChatContextChip[];
  /** 「询问 AI」进入时的选区载荷（dock 打开后消费）。 */
  pendingAsk: AskPayload | null;
  /** Agent 工具待审批（renderer 显示 banner；用户点批准/拒绝后清除）。 */
  pendingApproval: PendingApproval | null;
  permissionMode: ChatPermissionMode;
  setPermissionMode(mode: ChatPermissionMode): void;
  setSummaries(summaries: ChatSummary[]): void;
  setActive(session: ChatSession | null, isDraft: boolean, status?: ChatSessionStatus): void;
  setStreaming(streaming: boolean): void;
  setError(error: string | null): void;
  setModelLabel(label: string | null): void;
  setChips(chips: ChatContextChip[]): void;
  addChip(chip: ChatContextChip): void;
  removeChip(id: string): void;
  queueAsk(payload: AskPayload): void;
  consumeAsk(): AskPayload | null;
  setPendingApproval(p: PendingApproval | null): void;
  /** 调 agent:approval:respond；同一 approvalId 第二次响应被主进程拒绝（store 先清）。 */
  respondApproval(approvalId: string, decision: AgentApprovalDecision): Promise<void>;
  reset(): void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  summaries: [],
  active: null,
  isDraft: false,
  sessionStatus: 'complete',
  streaming: false,
  error: null,
  modelLabel: null,
  chips: [],
  pendingAsk: null,
  pendingApproval: null,
  permissionMode: 'conversation',

  setPermissionMode: (permissionMode) => set({ permissionMode }),
  setSummaries: (summaries) => set({ summaries }),
  setActive: (active, isDraft, status = 'complete') =>
    set({ active, isDraft, sessionStatus: status, error: null }),
  setStreaming: (streaming) => set({ streaming }),
  setError: (error) => set({ error }),
  setModelLabel: (label) => set({ modelLabel: label }),
  setChips: (chips) => set({ chips }),
  addChip: (chip) =>
    set((s) => (s.chips.some((c) => c.id === chip.id) ? s : { chips: [...s.chips, chip] })),
  removeChip: (id) => set((s) => ({ chips: s.chips.filter((c) => c.id !== id) })),
  queueAsk: (pendingAsk) => set({ pendingAsk }),
  consumeAsk: () => {
    const payload = get().pendingAsk;
    if (payload) set({ pendingAsk: null });
    return payload;
  },
  setPendingApproval: (pendingApproval) =>
    set((s) => {
      // 仅保留最新一条；老的已经过期/用户已决策的事件被静默覆盖。
      if (!pendingApproval) return { pendingApproval: null };
      if (s.pendingApproval && s.pendingApproval.approvalId !== pendingApproval.approvalId) {
        return { pendingApproval };
      }
      if (s.pendingApproval) return s;
      return { pendingApproval };
    }),
  respondApproval: async (approvalId, decision) => {
    const current = get().pendingApproval;
    if (current?.approvalId === approvalId) set({ pendingApproval: null });
    try {
      await invoke('agent:approval:respond', { approvalId, decision });
    } catch (e) {
      // 主进程拒绝（已过期/不存在）：让 dock 把错误显示出来。
      get().setError(e instanceof Error ? e.message : String(e));
    }
  },
  reset: () =>
    set({
      active: null,
      permissionMode: 'conversation',
      isDraft: false,
      sessionStatus: 'complete',
      streaming: false,
      error: null,
      modelLabel: null,
      chips: [],
      pendingApproval: null,
    }),
}));

let chipSeq = 0;
export function nextChipId(kind: string): string {
  chipSeq += 1;
  return `chip-${kind}-${Date.now().toString(36)}-${chipSeq}`;
}
