import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@nexnote/shared';
import { invoke, onEvent } from '../../lib/ipc';
import { useAiConfig, needsOnboarding } from './ai-config';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { CircleStop, Loader2, RotateCcw, Send, Sparkles } from 'lucide-react';

interface DebugTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * AI 流式调试面板（DEV-009 验收面）：验证 chatCompletionStream 全链路
 * （渲染层 IPC → 主进程 → 供应商 SSE → 统一内部事件 → 推送回渲染）。
 * dock 空态与设置页 AI 分区共用（compact 模式为 dock 紧凑布局）。
 */
export function AiChatDebug({ compact = false }: { compact?: boolean }) {
  const state = useAiConfig((s) => s.state);
  const [turns, setTurns] = useState<DebugTurn[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelLabel, setModelLabel] = useState<string | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 订阅统一流事件协议（按 streamId 关联本会话）
  useEffect(() => {
    return onEvent('ai:streamEvent', ({ streamId, event }) => {
      if (streamId !== streamIdRef.current) return;
      if (event.type === 'start') {
        setModelLabel(event.model);
      } else if (event.type === 'delta') {
        setTurns((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'assistant') next[next.length - 1] = { role: 'assistant', content: last.content + event.text };
          else next.push({ role: 'assistant', content: event.text });
          return next;
        });
      } else if (event.type === 'reasoningDelta') {
        setReasoning((prev) => (prev ?? '') + event.text);
      } else if (event.type === 'done') {
        setStreaming(false);
        streamIdRef.current = null;
      } else if (event.type === 'error') {
        setError(`${event.message}${event.code ? `（${event.code}）` : ''}`);
        setStreaming(false);
        streamIdRef.current = null;
      }
    });
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, reasoning]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || streaming) return;
      setError(null);
      setReasoning(null);
      const history: ChatMessage[] = [
        { role: 'system', content: '你是 NexNote 的内置调试助手，用一两句话回答。' },
        ...turns.filter((t) => t.content).map((t) => ({ role: t.role, content: t.content }) as ChatMessage),
        { role: 'user', content },
      ];
      setTurns((prev) => [...prev, { role: 'user', content }]);
      setInput('');
      setStreaming(true);
      try {
        const { streamId } = await invoke('ai:chat:stream:start', {
          messages: history,
          feature: 'chat',
        });
        streamIdRef.current = streamId;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStreaming(false);
      }
    },
    [streaming, turns],
  );

  const stop = async () => {
    const id = streamIdRef.current;
    if (!id) return;
    await invoke('ai:chat:stream:cancel', { streamId: id }).catch(() => undefined);
  };

  const reset = () => {
    if (streaming) void stop();
    setTurns([]);
    setError(null);
    setReasoning(null);
    setModelLabel(null);
  };

  if (needsOnboarding(state)) {
    return (
      <div data-testid="ai-debug-unconfigured" className="flex flex-col items-center gap-2 p-4 text-center text-xs text-muted-foreground">
        <span className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">
          🔐 密钥仅存系统钥匙串
        </span>
        <p>尚未配置 AI，调试面板不可用。</p>
      </div>
    );
  }

  return (
    <div data-testid="ai-debug" className={cn('flex min-h-0 flex-col gap-2', compact ? 'h-full' : 'h-72 rounded-lg border p-3')}>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Sparkles className="size-3.5 text-primary" />
        <span>流式调试{modelLabel ? ` · ${modelLabel}` : ''}</span>
        <span className="ml-auto flex items-center gap-1">
          {streaming && (
            <Button data-testid="ai-debug-stop" variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => void stop()}>
              <CircleStop className="size-3" />
              停止
            </Button>
          )}
          <Button data-testid="ai-debug-reset" variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={reset} disabled={turns.length === 0 && !error}>
            <RotateCcw className="size-3" />
            清空
          </Button>
        </span>
      </div>

      <div ref={scrollRef} data-testid="ai-debug-log" className="min-h-0 flex-1 space-y-2 overflow-auto rounded-md bg-muted/40 p-2 text-sm">
        {turns.length === 0 && !reasoning && !error && (
          <p className="p-2 text-xs text-muted-foreground">输入一句话测试流式补全（走已配置的对话模型）。</p>
        )}
        {turns.map((t, i) => (
          <div
            key={i}
            data-testid={t.role === 'user' ? 'ai-debug-turn-user' : 'ai-debug-turn-assistant'}
            className={cn(
              'max-w-[90%] whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-[13px] leading-relaxed',
              t.role === 'user'
                ? 'ml-auto bg-primary text-primary-foreground'
                : 'bg-background border text-foreground',
            )}
          >
            {t.content || <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          </div>
        ))}
        {reasoning && (
          <div data-testid="ai-debug-reasoning" className="whitespace-pre-wrap break-words rounded-lg border border-dashed px-2.5 py-1.5 text-[12px] text-muted-foreground">
            {reasoning}
          </div>
        )}
        {error && (
          <div data-testid="ai-debug-error" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
            <Button
              data-testid="ai-debug-retry"
              variant="outline"
              size="sm"
              className="ml-2 h-6 px-2 text-[11px]"
              onClick={() => {
                const lastUser = [...turns].reverse().find((t) => t.role === 'user');
                if (lastUser) void send(lastUser.content);
              }}
            >
              重试
            </Button>
          </div>
        )}
      </div>

      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          data-testid="ai-debug-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="说点什么…"
          disabled={streaming}
          className="h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2.5 text-[13px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
        />
        <Button data-testid="ai-debug-send" type="submit" size="sm" className="h-8 w-8 p-0" disabled={!input.trim() || streaming} aria-label="发送">
          {streaming ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
        </Button>
      </form>
    </div>
  );
}
