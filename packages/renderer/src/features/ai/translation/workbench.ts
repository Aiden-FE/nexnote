import { fetchAiStateOnce, useAiConfig } from '../ai-config';
import { resolveInitialTargetLanguage } from './languages';
import { startTranslationStream, type TranslationStreamHandle } from './translate-stream';
import {
  inputDraftState,
  nextTranslationId,
  useTranslationStore,
  type InputTranslationSession,
} from './translation-store';

export interface TranslationWorkbenchHandle {
  setDraft(draft: string): void;
  submit(options?: { ime?: boolean }): void;
  stop(): void;
  close(): void;
}

let activeStream: TranslationStreamHandle | null = null;
let activeSessionId: string | null = null;

function current(): InputTranslationSession | null {
  const session = useTranslationStore.getState().input;
  return session && session.id === activeSessionId ? session : null;
}

function cancelActive(): void {
  activeStream?.cancel();
  activeStream = null;
}

/** Opens a global, editor-independent workbench without issuing an AI request. */
export function openTranslationWorkbench(initialText = ''): TranslationWorkbenchHandle {
  closeTranslationWorkbench();
  const id = nextTranslationId('input');
  activeSessionId = id;
  const defaultLanguage = resolveInitialTargetLanguage(
    initialText,
    useAiConfig.getState().state?.translationTargetLanguage,
  );

  const setDraft = (draft: string): void => {
    const session = current();
    if (!session) return;
    useTranslationStore.getState().patchInput({ ...inputDraftState(draft), error: null });
  };

  const submit = (options: { ime?: boolean } = {}): void => {
    const session = current();
    if (!session || options.ime || !session.canSubmit) return;
    cancelActive();
    const sourceText = session.draft;
    const language = session.language;
    useTranslationStore.getState().patchInput({
      status: 'streaming',
      output: '',
      error: null,
      runId: null,
      sourceText,
    });
    activeStream = startTranslationStream(
      { translation: { mode: 'input', targetLanguage: language, text: sourceText } },
      {
        onRunId: (runId) => {
          if (current()) useTranslationStore.getState().patchInput({ runId });
        },
        onDelta: (text) => {
          const latest = current();
          if (!latest) return;
          useTranslationStore.getState().patchInput({ output: latest.output + text });
        },
        onDone: () => {
          if (current()) useTranslationStore.getState().patchInput({ status: 'done' });
          activeStream = null;
        },
        onError: (message, code) => {
          if (!current()) return;
          useTranslationStore.getState().patchInput({
            status: 'error',
            error: `${message}${code ? `（${code}）` : ''}`,
          });
          activeStream = null;
        },
      },
    );
  };

  const stop = (): void => {
    const session = current();
    if (!session) return;
    cancelActive();
    useTranslationStore.getState().patchInput({ status: 'cancelled' });
  };

  const close = (): void => {
    if (activeSessionId !== id) return;
    closeTranslationWorkbench();
  };

  const setLanguage = (language: string): void => {
    if (!current()) return;
    useTranslationStore.getState().patchInput({ language });
  };

  const session: InputTranslationSession = {
    id,
    kind: 'input',
    language: defaultLanguage,
    status: 'draft',
    output: '',
    error: null,
    runId: null,
    ...inputDraftState(initialText),
    onDraftChange: setDraft,
    onSubmit: () => submit(),
    onChangeLanguage: setLanguage,
    onStop: stop,
    onClose: close,
  };
  useTranslationStore.getState().openInput(session);

  // Hydrate the durable global default without triggering translation.
  void fetchAiStateOnce().then((state) => {
    if (current() && state?.translationTargetLanguage) {
      useTranslationStore.getState().patchInput({ language: state.translationTargetLanguage });
    }
  });

  return { setDraft, submit, stop, close };
}

export function closeTranslationWorkbench(): void {
  cancelActive();
  activeSessionId = null;
  useTranslationStore.getState().closeInput();
}
