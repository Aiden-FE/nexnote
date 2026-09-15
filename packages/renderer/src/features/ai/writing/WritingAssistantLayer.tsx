import { useMemo } from 'react';
import { Check, Loader2, Sparkles, TriangleAlert, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import { diffLines } from './diff';
import { isIncomplete, useWritingStore } from './writing-store';

/**
 * AI 写作辅助 diff 预览浮层（DEV-010 交付内容 5；DEV-037 状态机可见化）。
 * position:fixed 锚定选区视口坐标；流式实时刷新 diff（首片段即显示）。
 * 终态一律停在浮层：done 直接 Accept/Reject；cancelled/error 保留已显示内容并标记未完成，
 * 仍可 Accept（写入已生成部分，单事务单 undo）或 Reject（丢弃，原文不变）。
 */
export function WritingAssistantLayer() {
  const session = useWritingStore((s) => s.session);

  const ops = useMemo(() => {
    if (!session) return [];
    if (session.kind === 'replace') return diffLines(session.original, session.generated);
    return session.generated ? diffLines('', session.generated) : [];
  }, [session]);

  if (!session) return null;

  const width = 480;
  const left = Math.max(
    8,
    Math.min(
      (session.coords?.left ?? window.innerWidth / 2) - width / 2,
      window.innerWidth - width - 8,
    ),
  );
  const top = Math.min(session.coords?.top ?? 80, window.innerHeight - 220) + 12;
  const streaming = session.status === 'streaming';
  const incomplete = isIncomplete(session.status);
  const hasContent = session.generated.trim().length > 0;

  return (
    <div
      data-testid="writing-assistant"
      data-action={session.actionId}
      data-status={session.status}
      className="fixed z-50 rounded-lg border bg-popover text-popover-foreground shadow-xl"
      style={{ top, left, width }}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium">
        <Sparkles className="size-3.5 text-primary" />
        <span data-testid="writing-label">AI · {session.label}</span>
        {streaming && (
          <>
            <Loader2
              data-testid="writing-spinner"
              className="size-3.5 animate-spin text-muted-foreground"
            />
            <span data-testid="writing-progress" className="text-[11px] text-muted-foreground">
              生成中…
            </span>
          </>
        )}
        {incomplete && (
          <span
            data-testid="writing-incomplete"
            className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-normal text-amber-600 dark:text-amber-400"
            title={
              session.status === 'cancelled' ? '已停止生成，内容未完成' : '生成失败，内容未完成'
            }
          >
            未完成 · {session.status === 'cancelled' ? '已停止' : '生成失败'}
          </span>
        )}
        <button
          type="button"
          data-testid="writing-close"
          aria-label="关闭"
          className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => session.reject()}
        >
          <X className="size-3.5" />
        </button>
      </div>

      {session.truncated && session.note && (
        <div
          data-testid="writing-truncated"
          className="flex items-center gap-1.5 border-b bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-600 dark:text-amber-400"
        >
          <TriangleAlert className="size-3" />
          {session.note}
        </div>
      )}

      <div
        data-testid="writing-diff"
        className="max-h-64 min-h-[3rem] overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-[13px] leading-relaxed"
      >
        {ops.length === 0 && streaming && <span className="text-muted-foreground">生成中…</span>}
        {ops.map((op, i) => (
          <div
            key={i}
            data-diff-op={op.type}
            className={cn(
              'whitespace-pre-wrap rounded px-1',
              op.type === 'add' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
              op.type === 'del' &&
                'bg-rose-500/10 text-rose-600 line-through decoration-rose-400 dark:text-rose-400',
              op.type === 'eq' && 'text-muted-foreground',
            )}
          >
            {op.type === 'add' ? '+ ' : op.type === 'del' ? '- ' : '  '}
            {op.text}
          </div>
        ))}
      </div>

      {session.status === 'error' && (
        <div
          data-testid="writing-error"
          className="border-t border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive"
        >
          {session.error ?? '生成失败'}
        </div>
      )}

      <div className="flex items-center justify-end gap-1.5 border-t px-3 py-2">
        {streaming ? (
          <Button
            data-testid="writing-cancel"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => session.stop()}
          >
            <X className="size-3" /> 停止生成
          </Button>
        ) : (
          <>
            <Button
              data-testid="writing-reject"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => session.reject()}
            >
              <X className="size-3" /> 拒绝
            </Button>
            <Button
              data-testid="writing-accept"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => session.accept()}
              disabled={!hasContent}
            >
              <Check className="size-3" /> 接受
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
