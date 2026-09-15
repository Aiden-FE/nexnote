import { useState } from 'react';
import { Check, Copy, Languages, Loader2, Square, TriangleAlert, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import { TRANSLATION_LANGUAGES } from './languages';
import { isIncomplete, useTranslationStore, type TranslationSession } from './translation-store';

/**
 * 临时翻译只读浮层/视图（DEV-041）。
 *
 * - 划词翻译：选区旁 fixed 浮层，只读、可复制，随选区消失由控制器关闭
 * - 全文翻译：临时只读视图（覆盖层），内存态、不写盘、不进 Tab 文档树
 * - 两者都没有写回按钮：译文永远不会被写进文档
 */

type Scope = 'selection' | 'document';
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

export function TranslationLayer() {
  const selection = useTranslationStore((state) => state.selection);
  const documentSession = useTranslationStore((state) => state.document);

  return (
    <>
      {selection && (
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

      {documentSession && (
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
