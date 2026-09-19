import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Languages, Loader2, Square, TriangleAlert, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
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

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard?.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function statusLabel(session: TranslationSession): string {
  if (session.status === 'draft') return '等待提交';
  if (session.status === 'streaming') return '翻译中…';
  if (session.status === 'cancelled') return '已停止 · 未完成';
  if (session.status === 'error') return '翻译失败 · 未完成';
  return '已完成';
}

function TranslationHeader({ scope, session }: { scope: Scope; session: TranslationSession }) {
  const label = scope === 'selection' ? '划词' : session.kind === 'document' ? session.title : '';
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium">
      <Languages className="size-3.5 text-primary" />
      <span data-testid={testId(scope, 'label')}>翻译 · {label}</span>
      {session.status === 'streaming' && (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
      )}
      <select
        data-testid={testId(scope, 'language')}
        aria-label="目标语言"
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
        aria-label="关闭"
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
          <span className="text-muted-foreground">翻译中…</span>
        )}
        {session.output.trim().length === 0 && session.status !== 'streaming' && (
          <span className="text-muted-foreground">（无内容）</span>
        )}
        {session.output}
      </div>

      {incomplete && (
        <div
          data-testid={testId(scope, 'incomplete')}
          className="flex items-center gap-1.5 border-t bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-600 dark:text-amber-400"
        >
          <TriangleAlert className="size-3" />
          {statusLabel(session)}
        </div>
      )}

      {session.status === 'error' && (
        <div
          data-testid={testId(scope, 'error')}
          className="border-t border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive"
        >
          {session.error ?? '翻译失败'}
        </div>
      )}

      <div className="flex items-center gap-1.5 border-t px-3 py-2">
        <span
          data-testid={testId(scope, 'status')}
          className="mr-auto text-[11px] text-muted-foreground"
        >
          {statusLabel(session)}
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
          {copied ? '已复制' : '复制'}
        </Button>
        {session.status === 'streaming' && (
          <Button
            data-testid={testId(scope, 'stop')}
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => session.onStop()}
          >
            <Square className="size-3" /> 停止
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <div
      data-testid="translation-input-workbench"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="翻译工作台"
        className="flex max-h-[88vh] w-[min(960px,94vw)] flex-col rounded-xl border bg-popover text-popover-foreground shadow-2xl"
      >
        <TranslationHeader scope="input" session={session} />
        <div className="grid min-h-0 flex-1 gap-3 p-3 md:grid-cols-2">
          <div className="flex min-h-[18rem] flex-col rounded-lg border">
            <label
              htmlFor="translation-input-draft"
              className="border-b px-3 py-2 text-xs font-medium"
            >
              原文
            </label>
            <textarea
              id="translation-input-draft"
              ref={inputRef}
              data-testid="translation-input-draft"
              value={session.draft}
              onChange={(event) => session.onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (
                  (event.metaKey || event.ctrlKey) &&
                  event.key === 'Enter' &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  session.onSubmit();
                }
              }}
              placeholder="输入或粘贴要翻译的内容"
              className="min-h-0 flex-1 resize-none bg-transparent p-3 text-sm outline-none"
            />
            <div
              className={cn(
                'border-t px-3 py-2 text-[11px]',
                session.overLimit ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {session.overLimit
                ? `已超出 ${Math.abs(session.remaining)} 个字符，请删减后提交`
                : `剩余 ${session.remaining.toLocaleString()} 个字符`}
            </div>
          </div>
          <div className="flex min-h-[18rem] flex-col rounded-lg border">
            <div className="border-b px-3 py-2 text-xs font-medium">译文 · 只读</div>
            <TranslationBody scope="input" session={session} outputClassName="min-h-0 flex-1" />
          </div>
        </div>
        <div className="flex items-center gap-2 border-t px-3 py-2">
          <span className="mr-auto text-[11px] text-muted-foreground">
            ⌘/Ctrl + Enter 提交 · 输入、粘贴和打开均不会自动请求
          </span>
          <Button
            data-testid="translation-input-submit"
            disabled={!session.canSubmit || session.status === 'streaming'}
            onClick={() => session.onSubmit()}
          >
            翻译
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TranslationLayer() {
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
            aria-label="临时翻译视图"
            className="flex max-h-[80vh] w-[min(860px,92vw)] flex-col rounded-lg border bg-popover text-popover-foreground shadow-2xl"
          >
            <TranslationHeader scope="document" session={documentSession} />
            <div className="border-b bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
              临时视图 · 不会写入文件，也不会进入文档树
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
