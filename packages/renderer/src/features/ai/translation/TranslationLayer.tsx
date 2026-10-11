import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Languages, Loader2, Square, TriangleAlert, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import { useI18n } from '../../../lib/i18n';
import { useTabStore } from '../../../stores/tab-store';
import { TRANSLATION_LANGUAGES } from './languages';
import { isIncomplete, useTranslationStore, type TranslationSession } from './translation-store';

/**
 * 临时翻译只读浮层/视图（DEV-041）。
 *
 * - 划词翻译：选区旁 fixed 浮层，只读、可复制，随选区消失由控制器关闭
 * - 全文翻译：临时只读视图（覆盖层），内存态、不写盘、不进 Tab 文档树
 * - 两者都没有写回按钮：译文永远不会被写进文档
 */

type Scope = 'selection' | 'document' | 'input';
const testId = (scope: Scope, name: string) => `translation-${scope}-${name}`;
type Translate = (key: string, params?: Record<string, string | number>) => string;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard?.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function statusLabel(session: TranslationSession, t: Translate): string {
  if (session.status === 'draft') return t('translation.status.draft');
  if (session.status === 'streaming') return t('translation.status.streaming');
  if (session.status === 'cancelled') return t('translation.status.cancelled');
  if (session.status === 'error') return t('translation.status.error');
  return t('translation.status.done');
}

function TranslationHeader({ scope, session }: { scope: Scope; session: TranslationSession }) {
  const t = useI18n();
  const label =
    scope === 'selection'
      ? t('translation.header.selection')
      : session.kind === 'document'
        ? session.title
        : '';
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium">
      <Languages className="size-3.5 text-primary" />
      <span data-testid={testId(scope, 'label')}>
        {t('translation.header.title', { label })}
      </span>
      {session.status === 'streaming' && (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
      )}
      <select
        data-testid={testId(scope, 'language')}
        aria-label={t('translation.targetLanguage')}
        className="ml-auto h-6 rounded border bg-background px-1 text-[11px]"
        value={session.language}
        onChange={(event) => session.onChangeLanguage(event.target.value)}
      >
        {TRANSLATION_LANGUAGES.map((language) => (
          <option key={language.id} value={language.id}>
            {language.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        data-testid={testId(scope, 'close')}
        aria-label={t('common.close')}
        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() => session.onClose()}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function TranslationBody({
  scope,
  session,
  outputClassName,
}: {
  scope: Scope;
  session: TranslationSession;
  outputClassName?: string;
}) {
  const t = useI18n();
  const [copied, setCopied] = useState(false);
  const incomplete = isIncomplete(session);
  const canCopy = session.output.trim().length > 0;

  return (
    <>
      <div
        data-testid={testId(scope, 'output')}
        className={cn(
          'min-h-[3rem] overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-[13px] leading-relaxed',
          outputClassName ?? 'max-h-64',
        )}
      >
        {session.output.trim().length === 0 && session.status === 'streaming' && (
          <span className="text-muted-foreground">{t('translation.status.streaming')}</span>
        )}
        {session.output.trim().length === 0 && session.status !== 'streaming' && (
          <span className="text-muted-foreground">{t('translation.empty')}</span>
        )}
        {session.output}
      </div>

      {incomplete && (
        <div
          data-testid={testId(scope, 'incomplete')}
          className="flex items-center gap-1.5 border-t bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-600 dark:text-amber-400"
        >
          <TriangleAlert className="size-3" />
          {statusLabel(session, t)}
        </div>
      )}

      {session.status === 'error' && (
        <div
          data-testid={testId(scope, 'error')}
          className="border-t border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive"
        >
          {session.error ?? t('translation.failed')}
        </div>
      )}

      <div className="flex items-center gap-1.5 border-t px-3 py-2">
        <span
          data-testid={testId(scope, 'status')}
          className="mr-auto text-[11px] text-muted-foreground"
        >
          {statusLabel(session, t)}
        </span>
        <Button
          data-testid={testId(scope, 'copy')}
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={!canCopy}
          onClick={() => {
            void copyText(session.output).then((ok) => setCopied(ok));
          }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? t('translation.copied') : t('common.copy')}
        </Button>
        {scope !== 'input' && session.status !== 'streaming' && (
          <Button
            data-testid={testId(scope, 'submit')}
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => session.onSubmit()}
          >
            {session.output.trim() ? t('translation.retry') : t('translation.start')}
          </Button>
        )}
        {session.status === 'streaming' && (
          <Button
            data-testid={testId(scope, 'stop')}
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => session.onStop()}
          >
            <Square className="size-3" /> {t('translation.stop')}
          </Button>
        )}
      </div>
    </>
  );
}

function TranslationWorkbench({
  session,
}: {
  session: Extract<TranslationSession, { kind: 'input' }>;
}) {
  const t = useI18n();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <div
      data-testid="translation-input-workbench"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('translation.workbenchLabel')}
        className="flex max-h-[88vh] w-[min(960px,94vw)] flex-col rounded-xl border bg-popover text-popover-foreground shadow-2xl"
      >
        <TranslationHeader scope="input" session={session} />
        <div className="grid min-h-0 flex-1 gap-3 p-3 md:grid-cols-2">
          <div className="flex min-h-[18rem] flex-col rounded-lg border">
            <label
              htmlFor="translation-input-draft"
              className="border-b px-3 py-2 text-xs font-medium"
            >
              {t('translation.sourceLabel')}
            </label>
            <textarea
              id="translation-input-draft"
              ref={inputRef}
              data-testid="translation-input-draft"
              value={session.draft}
              onChange={(event) => session.onDraftChange(event.target.value)}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
              onKeyDown={(event) => {
                if (
                  (event.metaKey || event.ctrlKey) &&
                  event.key === 'Enter' &&
                  !composingRef.current &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  session.onSubmit();
                }
              }}
              placeholder={t('translation.sourcePlaceholder')}
              className="min-h-0 flex-1 resize-none bg-transparent p-3 text-sm outline-none"
            />
            <div
              className={cn(
                'border-t px-3 py-2 text-[11px]',
                session.overLimit ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {session.overLimit
                ? t('translation.overLimit', { count: Math.abs(session.remaining) })
                : t('translation.remaining', { count: session.remaining.toLocaleString() })}
            </div>
          </div>
          <div className="flex min-h-[18rem] flex-col rounded-lg border">
            <div className="border-b px-3 py-2 text-xs font-medium">
              {t('translation.outputLabel')}
            </div>
            <TranslationBody scope="input" session={session} outputClassName="min-h-0 flex-1" />
          </div>
        </div>
        <div className="flex items-center gap-2 border-t px-3 py-2">
          <span className="mr-auto text-[11px] text-muted-foreground">
            {t('translation.submitHint')}
          </span>
          <Button
            data-testid="translation-input-submit"
            disabled={!session.canSubmit || session.status === 'streaming'}
            onClick={() => session.onSubmit()}
          >
            {t('translation.start')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TranslationLayer() {
  const t = useI18n();
  const selection = useTranslationStore((state) => state.selection);
  const documentSession = useTranslationStore((state) => state.document);
  const inputSession = useTranslationStore((state) => state.input);
  const previewOnly = useTabStore((state) => {
    const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
    return tab?.format === 'markdown' && (tab.markdownView ?? 'split') === 'preview';
  });

  return (
    <>
      {selection && !previewOnly && (
        <div
          data-testid="translation-selection-popover"
          data-status={selection.status}
          className="fixed z-50 rounded-lg border bg-popover text-popover-foreground shadow-xl"
          style={{
            top: Math.min(selection.coords.top + 12, window.innerHeight - 220),
            left: Math.max(8, Math.min(selection.coords.left - 210, window.innerWidth - 428)),
            width: 420,
          }}
        >
          <TranslationHeader scope="selection" session={selection} />
          <TranslationBody scope="selection" session={selection} />
        </div>
      )}

      {inputSession && <TranslationWorkbench session={inputSession} />}

      {documentSession && !previewOnly && (
        <div
          data-testid="translation-document-view"
          data-status={documentSession.status}
          data-path={documentSession.path}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
        >
          <div
            role="dialog"
            aria-label={t('translation.documentViewLabel')}
            className="flex max-h-[80vh] w-[min(860px,92vw)] flex-col rounded-lg border bg-popover text-popover-foreground shadow-2xl"
          >
            <TranslationHeader scope="document" session={documentSession} />
            <div className="border-b bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
              {t('translation.documentViewHint')}
            </div>
            <TranslationBody
              scope="document"
              session={documentSession}
              outputClassName="min-h-[8rem] flex-1"
            />
          </div>
        </div>
      )}
    </>
  );
}
