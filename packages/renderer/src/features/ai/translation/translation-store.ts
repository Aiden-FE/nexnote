import { TRANSLATION_MAX_TEXT_CHARS } from '@nexnote/shared';
import { create } from 'zustand';

/**
 * 临时翻译会话状态（DEV-041）。
 *
 * 全部为内存态：不写盘、不进入 Tab 文档树、不进入撤销历史；
 * 关闭（close）= 丢弃结果，停止（stop）保留已显示内容并标记未完成。
 */

export type TranslationKind = 'selection' | 'document' | 'input';
export type TranslationStatus = 'draft' | 'streaming' | 'done' | 'cancelled' | 'error';

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
  /** Explicit user intent to start or restart translation with the current language. */
  onSubmit: () => void;
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

export interface InputTranslationSession extends TranslationSessionBase {
  kind: 'input';
  draft: string;
  runId: string | null;
  remaining: number;
  overLimit: boolean;
  canSubmit: boolean;
  onDraftChange: (draft: string) => void;
}

export type TranslationSession =
  SelectionTranslationSession | DocumentTranslationSession | InputTranslationSession;

/** 已显示内容但未完成（取消/失败）——界面须给出「未完成」标记。 */
export function isIncomplete(session: TranslationSession | null): boolean {
  if (!session) return false;
  return session.output.trim().length > 0 && session.status !== 'done';
}

interface TranslationState {
  selection: SelectionTranslationSession | null;
  document: DocumentTranslationSession | null;
  input: InputTranslationSession | null;
  openSelection: (session: SelectionTranslationSession) => void;
  openDocument: (session: DocumentTranslationSession) => void;
  openInput: (session: InputTranslationSession) => void;
  patchSelection: (patch: Partial<SelectionTranslationSession>) => void;
  patchDocument: (patch: Partial<DocumentTranslationSession>) => void;
  patchInput: (patch: Partial<InputTranslationSession>) => void;
  closeSelection: () => void;
  closeDocument: () => void;
  closeInput: () => void;
}

export function inputDraftState(
  draft: string,
): Pick<InputTranslationSession, 'draft' | 'sourceText' | 'remaining' | 'overLimit' | 'canSubmit'> {
  const remaining = TRANSLATION_MAX_TEXT_CHARS - draft.length;
  const overLimit = remaining < 0;
  return {
    draft,
    sourceText: draft,
    remaining,
    overLimit,
    canSubmit: draft.trim().length > 0 && !overLimit,
  };
}

export const useTranslationStore = create<TranslationState>((set) => ({
  selection: null,
  document: null,
  input: null,
  openSelection: (selection) => set({ selection }),
  openDocument: (document) => set({ document }),
  openInput: (input) => set({ input }),
  patchSelection: (patch) =>
    set((state) => (state.selection ? { selection: { ...state.selection, ...patch } } : state)),
  patchDocument: (patch) =>
    set((state) => (state.document ? { document: { ...state.document, ...patch } } : state)),
  patchInput: (patch) =>
    set((state) => (state.input ? { input: { ...state.input, ...patch } } : state)),
  closeSelection: () => set({ selection: null }),
  closeDocument: () => set({ document: null }),
  closeInput: () => set({ input: null }),
}));

let sessionSeq = 0;
export function nextTranslationId(kind: TranslationKind): string {
  sessionSeq += 1;
  return `translation-${kind}-${Date.now()}-${sessionSeq}`;
}
