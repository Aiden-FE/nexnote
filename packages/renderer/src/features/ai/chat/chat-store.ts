import { create } from 'zustand';
import type { ChatSession, ChatSessionStatus, ChatSummary } from '@nexnote/shared';
import type { ChatContextChip } from './context';

/** 从选区「询问 AI」进入对话 dock 的待处理载荷（DEV-012 交付内容 7）。 */
export interface AskPayload {
  selectionText: string;
  docTitle: string | null;
  docPath: string | null;
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

  setSummaries: (summaries) => set({ summaries }),
  setActive: (active, isDraft, status = 'complete') =>
    set({ active, isDraft, sessionStatus: status, error: null }),
  setStreaming: (streaming) => set({ streaming }),
  setError: (error) => set({ error }),
  setModelLabel: (modelLabel) => set({ modelLabel }),
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
  reset: () =>
    set({
      active: null,
      isDraft: false,
      sessionStatus: 'complete',
      streaming: false,
      error: null,
      modelLabel: null,
      chips: [],
    }),
}));

let chipSeq = 0;
export function nextChipId(kind: string): string {
  chipSeq += 1;
  return `chip-${kind}-${Date.now().toString(36)}-${chipSeq}`;
}
