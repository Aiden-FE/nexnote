import { TRANSLATION_MAX_TEXT_CHARS } from '@nexnote/shared';
import { useAiConfig } from '../ai-config';
import { resolveInitialTargetLanguage } from './languages';
import { startTranslationStream, type TranslationStreamHandle } from './translate-stream';
import {
  nextTranslationId,
  useTranslationStore,
  type DocumentTranslationSession,
  type SelectionTranslationSession,
} from './translation-store';

function currentTranslationTargetLanguage(): string | undefined {
  return useAiConfig.getState().state?.translationTargetLanguage;
}

/**
 * 临时翻译编排器（DEV-041）。
 *
 * 划词翻译与全文翻译共用同一控制器：组装内存会话 → 流式请求 → 追加译文。
 * - 关闭（close）：取消上游流并丢弃结果（不写盘、不进文档树）
 * - 停止（stop）：取消上游流但保留已显示内容，状态标记为 cancelled（未完成）
 * - 切换目标语言：仅以会话记录的原文重译，不覆盖 AI 设置中的全局默认
 */

export interface TranslationControllerDeps {
  /** 当前活动文档的完整原文（全文翻译用）。 */
  getDocumentText: () => string;
  /** 当前活动文档的路径与标题（临时视图只用于展示，不写盘）。 */
  getDocumentMeta: () => { path: string; title: string };
  /** DEV-068：读取设置常规的界面显示语言 tag（如 zh-CN / en-US）。 */
  getInterfaceLanguage?: () => string | undefined;
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

  const runSelection = (
    sourceText: string,
    coords: { top: number; left: number },
    language: string,
  ) => {
    selectionStream?.cancel();
    const id = nextTranslationId('selection');
    const overLimit = sourceText.length > TRANSLATION_MAX_TEXT_CHARS;
    const session: SelectionTranslationSession = {
      id,
      kind: 'selection',
      language,
      status: overLimit ? 'error' : 'streaming',
      output: '',
      error: overLimit ? '原文超过 200,000 字符限制，请缩短后重试' : null,
      sourceText,
      coords,
      onChangeLanguage: (next) => {
        const current = useTranslationStore.getState().selection;
        if (current?.id === id) useTranslationStore.getState().patchSelection({ language: next });
      },
      onSubmit: () => {
        const current = useTranslationStore.getState().selection;
        if (current?.id === id) runSelection(sourceText, coords, current.language);
      },
      onStop: () => stopSelection(),
      onClose: () => closeSelection(),
    };
    useTranslationStore.getState().openSelection(session);
    if (overLimit) {
      selectionStream = null;
      return;
    }
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

  const runDocument = (
    sourceText: string,
    meta: { path: string; title: string },
    language: string,
  ) => {
    documentStream?.cancel();
    const id = nextTranslationId('document');
    const overLimit = sourceText.length > TRANSLATION_MAX_TEXT_CHARS;
    const session: DocumentTranslationSession = {
      id,
      kind: 'document',
      language,
      status: overLimit ? 'error' : 'streaming',
      output: '',
      error: overLimit ? '原文超过 200,000 字符限制，请缩短后重试' : null,
      sourceText,
      path: meta.path,
      title: meta.title,
      onChangeLanguage: (next) => {
        const current = useTranslationStore.getState().document;
        if (current?.id === id) useTranslationStore.getState().patchDocument({ language: next });
      },
      onSubmit: () => {
        const current = useTranslationStore.getState().document;
        if (current?.id === id) runDocument(sourceText, meta, current.language);
      },
      onStop: () => stopDocument(),
      onClose: () => closeDocument(),
    };
    useTranslationStore.getState().openDocument(session);
    if (overLimit) {
      documentStream = null;
      return;
    }
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
    if (selection) useTranslationStore.getState().patchSelection({ language });
    if (document) useTranslationStore.getState().patchDocument({ language });
  };

  return {
    translateSelection: (target) => {
      const text = target.text;
      if (!text.trim()) return;
      runSelection(
        text,
        target.coords,
        resolveInitialTargetLanguage(text, currentTranslationTargetLanguage()),
      );
    },
    translateDocument: () => {
      const text = deps.getDocumentText();
      if (!text.trim()) return;
      runDocument(
        text,
        deps.getDocumentMeta(),
        resolveInitialTargetLanguage(text, currentTranslationTargetLanguage()),
      );
    },
    setTargetLanguage,
    stopSelection,
    stopDocument,
    closeSelection,
    closeDocument,
  };
}
