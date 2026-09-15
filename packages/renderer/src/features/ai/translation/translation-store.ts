import { create } from 'zustand';

/**
 * 临时翻译会话状态（DEV-041）。
 *
 * 全部为内存态：不写盘、不进入 Tab 文档树、不进入撤销历史；
 * 关闭（close）= 丢弃结果，停止（stop）保留已显示内容并标记未完成。
 */

export type TranslationKind = 'selection' | 'document';
export type TranslationStatus = 'streaming' | 'done' | 'cancelled' | 'error';

interface TranslationSessionBase {
  id: string;
  kind: TranslationKind;
  /** 目标语言（送进 prompt）。 */
  language: string;
  status: TranslationStatus;
  /** 已到达的译文（流式累积）。 */
  output: string;
  error: string | null;
  /** 触发时的原文，用于切换目标语言后重译。 */
  sourceText: string;
  /** 由控制器在创建会话时绑定（闭包持有对应编辑器与流句柄）。 */
  onChangeLanguage: (language: string) => void;
  onStop: () => void;
  onClose: () => void;
}

export interface SelectionTranslationSession extends TranslationSessionBase {
  kind: 'selection';
  /** 选区视口锚点（fixed 定位）。 */
  coords: { top: number; left: number };
}

export interface DocumentTranslationSession extends TranslationSessionBase {
  kind: 'document';
  path: string;
  title: string;
}

export type TranslationSession = SelectionTranslationSession | DocumentTranslationSession;

/** 已显示内容但未完成（取消/失败）——界面须给出「未完成」标记。 */
export function isIncomplete(session: TranslationSession | null): boolean {
  if (!session) return false;
  return session.output.trim().length > 0 && session.status !== 'done';
}

interface TranslationState {
  selection: SelectionTranslationSession | null;
  document: DocumentTranslationSession | null;
  openSelection: (session: SelectionTranslationSession) => void;
  openDocument: (session: DocumentTranslationSession) => void;
  patchSelection: (patch: Partial<SelectionTranslationSession>) => void;
  patchDocument: (patch: Partial<DocumentTranslationSession>) => void;
  closeSelection: () => void;
  closeDocument: () => void;
}

export const useTranslationStore = create<TranslationState>((set) => ({
  selection: null,
  document: null,
  openSelection: (selection) => set({ selection }),
  openDocument: (document) => set({ document }),
  patchSelection: (patch) =>
    set((state) => (state.selection ? { selection: { ...state.selection, ...patch } } : state)),
  patchDocument: (patch) =>
    set((state) => (state.document ? { document: { ...state.document, ...patch } } : state)),
  closeSelection: () => set({ selection: null }),
  closeDocument: () => set({ document: null }),
}));

let sessionSeq = 0;
export function nextTranslationId(kind: TranslationKind): string {
  sessionSeq += 1;
  return `translation-${kind}-${Date.now()}-${sessionSeq}`;
}
