import { create } from 'zustand';
import type { ChatSession, ChatSummary } from '@nexnote/shared';
import type { ChatContextChip } from './context';

/** 从选区「询问 AI」进入对话 dock 的待处理载荷（DEV-012 交付内容 7）。 */
export interface AskPayload {
  selectionText: string;
  docTitle: string | null;
  docPath: string | null;
}

interface ChatState {
  /** 历史会话列表（dock 顶部切换）。 */
  summaries: ChatSummary[];
  /** 会话存储目录（vault 相对）。 */
  folder: string;
  /** 当前会话；null = 尚未开始（欢迎空态）。 */
  active: ChatSession | null;
  /** true = 当前会话还未落盘（首条消息后才写文件）。 */
  isDraft: boolean;
  streaming: boolean;
  error: string | null;
  /** 流式回答使用的模型标签。 */
  modelLabel: string | null;
  /** 上下文注入 chips。 */
  chips: ChatContextChip[];
  /** 「询问 AI」进入时的选区载荷（dock 打开后消费）。 */
  pendingAsk: AskPayload | null;
  setSummaries(summaries: ChatSummary[]): void;
  setFolder(folder: string): void;
  setActive(session: ChatSession | null, isDraft: boolean): void;
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
  folder: 'AI Chats',
  active: null,
  isDraft: false,
  streaming: false,
  error: null,
  modelLabel: null,
  chips: [],
  pendingAsk: null,

  setSummaries: (summaries) => set({ summaries }),
  setFolder: (folder) => set({ folder }),
  setActive: (active, isDraft) => set({ active, isDraft, error: null }),
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
