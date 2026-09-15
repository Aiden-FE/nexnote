import type { TranslationStreamHandle } from './translate-stream';
import { rememberTargetLanguage, resolveInitialTargetLanguage } from './languages';
import { startTranslationStream } from './translate-stream';
import {
  nextTranslationId,
  useTranslationStore,
  type DocumentTranslationSession,
  type SelectionTranslationSession,
} from './translation-store';

/**
 * 临时翻译编排器（DEV-041）。
 *
 * 划词翻译与全文翻译共用同一控制器：组装内存会话 → 流式请求 → 追加译文。
 * - 关闭（close）：取消上游流并丢弃结果（不写盘、不进文档树）
 * - 停止（stop）：取消上游流但保留已显示内容，状态标记为 cancelled（未完成）
 * - 切换目标语言：以会话记录的原文重译，并记住本次选择
 */

export interface TranslationControllerDeps {
  /** 当前活动文档的完整原文（全文翻译用）。 */
  getDocumentText: () => string;
  /** 当前活动文档的路径与标题（临时视图只用于展示，不写盘）。 */
  getDocumentMeta: () => { path: string; title: string };
}

export interface TranslationSelectionTarget {
  text: string;
  coords: { top: number; left: number };
}

export interface TranslationController {
  translateSelection: (target: TranslationSelectionTarget) => void;
  translateDocument: () => void;
  setTargetLanguage: (language: string) => void;
  stopSelection: () => void;
  stopDocument: () => void;
  closeSelection: () => void;
  closeDocument: () => void;
}

export function createTranslationController(
  deps: TranslationControllerDeps,
): TranslationController {
  let selectionStream: TranslationStreamHandle | null = null;
  let documentStream: TranslationStreamHandle | null = null;

  const runSelection = (sourceText: string, coords: { top: number; left: number }, language: string) => {
    selectionStream?.cancel();
    const id = nextTranslationId('selection');
    rememberTargetLanguage(language);
    const session: SelectionTranslationSession = {
      id,
      kind: 'selection',
      language,
      status: 'streaming',
      output: '',
      error: null,
      sourceText,
      coords,
      onChangeLanguage: (next) => setTargetLanguage(next),
      onStop: () => stopSelection(),
      onClose: () => closeSelection(),
    };
    useTranslationStore.getState().openSelection(session);
    selectionStream = startTranslationStream(
      { translation: { mode: 'selection', targetLanguage: language, text: sourceText } },
      {
        onDelta: (text) => {
          const current = useTranslationStore.getState().selection;
          if (!current || current.id !== id) return;
          useTranslationStore
            .getState()
            .patchSelection({ output: current.output + text, status: 'streaming' });
        },
        onDone: () => {
          const current = useTranslationStore.getState().selection;
          if (!current || current.id !== id || current.status !== 'streaming') return;
          useTranslationStore.getState().patchSelection({ status: 'done' });
        },
        onError: (message, code) => {
          const current = useTranslationStore.getState().selection;
          if (!current || current.id !== id) return;
          useTranslationStore
            .getState()
            .patchSelection({ status: 'error', error: `${message}${code ? `（${code}）` : ''}` });
        },
      },
    );
  };

  const runDocument = (sourceText: string, meta: { path: string; title: string }, language: string) => {
    documentStream?.cancel();
    const id = nextTranslationId('document');
    rememberTargetLanguage(language);
    const session: DocumentTranslationSession = {
      id,
      kind: 'document',
      language,
      status: 'streaming',
      output: '',
      error: null,
      sourceText,
      path: meta.path,
      title: meta.title,
      onChangeLanguage: (next) => setTargetLanguage(next),
      onStop: () => stopDocument(),
      onClose: () => closeDocument(),
    };
    useTranslationStore.getState().openDocument(session);
    documentStream = startTranslationStream(
      { translation: { mode: 'document', targetLanguage: language, text: sourceText } },
      {
        onDelta: (text) => {
          const current = useTranslationStore.getState().document;
          if (!current || current.id !== id) return;
          useTranslationStore
            .getState()
            .patchDocument({ output: current.output + text, status: 'streaming' });
        },
        onDone: () => {
          const current = useTranslationStore.getState().document;
          if (!current || current.id !== id || current.status !== 'streaming') return;
          useTranslationStore.getState().patchDocument({ status: 'done' });
        },
        onError: (message, code) => {
          const current = useTranslationStore.getState().document;
          if (!current || current.id !== id) return;
          useTranslationStore
            .getState()
            .patchDocument({ status: 'error', error: `${message}${code ? `（${code}）` : ''}` });
        },
      },
    );
  };

  const stopSelection = () => {
    selectionStream?.cancel();
    selectionStream = null;
    const current = useTranslationStore.getState().selection;
    if (current) useTranslationStore.getState().patchSelection({ status: 'cancelled' });
  };

  const stopDocument = () => {
    documentStream?.cancel();
    documentStream = null;
    const current = useTranslationStore.getState().document;
    if (current) useTranslationStore.getState().patchDocument({ status: 'cancelled' });
  };

  const closeSelection = () => {
    selectionStream?.cancel();
    selectionStream = null;
    useTranslationStore.getState().closeSelection();
  };

  const closeDocument = () => {
    documentStream?.cancel();
    documentStream = null;
    useTranslationStore.getState().closeDocument();
  };

  const setTargetLanguage = (language: string) => {
    const { selection, document } = useTranslationStore.getState();
    if (selection) runSelection(selection.sourceText, selection.coords, language);
    if (document) runDocument(document.sourceText, { path: document.path, title: document.title }, language);
  };

  return {
    translateSelection: (target) => {
      const text = target.text;
      if (!text.trim()) return;
      runSelection(text, target.coords, resolveInitialTargetLanguage(text));
    },
    translateDocument: () => {
      const text = deps.getDocumentText();
      if (!text.trim()) return;
      runDocument(text, deps.getDocumentMeta(), resolveInitialTargetLanguage(text));
    },
    setTargetLanguage,
    stopSelection,
    stopDocument,
    closeSelection,
    closeDocument,
  };
}
