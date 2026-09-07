import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  CornerDownLeft,
  FileDown,
  Loader2,
  MessageSquarePlus,
  Settings2,
  Sparkles,
} from 'lucide-react';
import type { ChatTurn, RetrievalResponse } from '@nexnote/shared';
import { useChatStore } from './chat-store';
import { ContextChips } from './ContextChips';
import { RetrievalSources } from '../retrieval/RetrievalSources';
import { insertIntoActiveEditor } from '../../../editor/active-editor';
import { openPageInActivePane, useTabStore } from '../../../stores/tab-store';
import { openSettings } from '../../../lib/open-settings';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/button';
import {
  initChatRuntime,
  openSession,
  refreshFolder,
  refreshSummaries,
  saveActiveAsDocument,
  sendMessage,
  startNewSession,
  stopStream,
} from './chat-runtime';
import { addSelectionContext, refreshAutoDocumentChip } from './chat-context-bridge';
import { ChatSkillPicker } from '../../skills/ChatSkillPicker';

function sourcesResponse(turn: ChatTurn): RetrievalResponse | null {
  const meta = turn.meta;
  if (!meta || !meta.sources || meta.sources.length === 0) return null;
  return {
    query: '',
    degraded: meta.degraded ?? false,
    model: meta.retrievalModel ?? null,
    contextText: '',
    sources: meta.sources.map((s) => ({ ...s, blockType: 'block' })),
    stages: (meta.stages ?? []).map((s) => ({ ...s, note: s.note ?? '' })),
  };
}

function TurnView({ turn }: { turn: ChatTurn }) {
  const isUser = turn.role === 'user';
  const sources = !isUser ? sourcesResponse(turn) : null;
  return (
    <div className={cn('group/turn flex flex-col', isUser ? 'items-end' : 'items-start')}>
      <div
        data-testid={isUser ? 'chat-turn-user' : 'chat-turn-assistant'}
        className={cn(
          'max-w-[92%] whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-[13px] leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'border bg-background text-foreground',
        )}
      >
        {turn.content || <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      </div>
      {!isUser && turn.content && (
        <div className="mt-1 flex w-full flex-col gap-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="chat-insert-block"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover/turn:opacity-100"
              title="将这条回答作为新块插入当前笔记（可撤销）"
              onClick={() => insertIntoActiveEditor(turn.content, 'end')}
            >
              <CornerDownLeft className="size-3" /> 插入为块
            </button>
          </div>
          {sources && (
            <details data-testid="chat-sources" className="rounded-md border bg-muted/30 px-2 py-1 text-[11px]">
              <summary className="cursor-pointer select-none text-muted-foreground">参考来源</summary>
              <div className="mt-1.5">
                <RetrievalSources response={sources} testId="chat-retrieval-sources" />
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryMenu() {
  const summaries = useChatStore((s) => s.summaries);
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        data-testid="chat-history"
        className="h-7 gap-1 px-2 text-[11px]"
        onClick={() => setOpen((v) => !v)}
      >
        历史 <ChevronDown className="size-3" />
      </Button>
      {open && (
        <div
          data-testid="chat-history-menu"
          className="absolute right-0 top-full z-30 mt-1 max-h-72 w-60 overflow-auto rounded-md border bg-popover p-1 text-[12px] text-popover-foreground shadow-md"
        >
          {summaries.length === 0 && <p className="px-2 py-2 text-muted-foreground">暂无历史会话</p>}
          {summaries.map((s) => (
            <button
              key={s.path}
              type="button"
              data-testid="chat-history-item"
              onClick={() => {
                void openSession(s.path);
                setOpen(false);
              }}
              className="block w-full truncate rounded px-2 py-1.5 text-left hover:bg-accent"
              title={s.path}
            >
              <span className="block truncate font-medium">{s.title}</span>
              <span className="block text-[10px] text-muted-foreground">
                {s.turnCount} 条 · {new Date(s.updatedAt).toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatDock() {
  const active = useChatStore((s) => s.active);
  const streaming = useChatStore((s) => s.streaming);
  const error = useChatStore((s) => s.error);
  const modelLabel = useChatStore((s) => s.modelLabel);
  const folder = useChatStore((s) => s.folder);
  const pendingAsk = useChatStore((s) => s.pendingAsk);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    initChatRuntime();
    void refreshFolder();
    void refreshSummaries();
    refreshAutoDocumentChip();
    // 激活 tab / 面板切换时刷新「当前文档」自动 chip。
    const unsubTab = useTabStore.subscribe(() => refreshAutoDocumentChip());
    return () => {
      unsubTab();
    };
  }, []);

  // 外部（双链/历史切换）打开会话时无需动作；「询问 AI」载荷在此消费。
  useEffect(() => {
    if (!pendingAsk) return;
    const payload = useChatStore.getState().consumeAsk();
    if (!payload) return;
    const ensure = useChatStore.getState().active ? Promise.resolve() : startNewSession();
    void ensure.then(() => {
      addSelectionContext(payload);
      refreshAutoDocumentChip();
      inputRef.current?.focus();
    });
  }, [pendingAsk]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [active, streaming]);

  const send = useCallback(() => {
    const text = input;
    if (!text.trim() || streaming) return;
    setInput('');
    void sendMessage(text);
  }, [input, streaming]);

  const saveAsDoc = useCallback(async () => {
    const path = await saveActiveAsDocument(true);
    if (path) openPageInActivePane(path);
  }, []);

  const hasTurns = (active?.turns.length ?? 0) > 0;
  const placeholder = useMemo(
    () => (active ? `向 AI 提问…（⌘Enter 发送）` : '开始一个新对话…（⌘Enter 发送）'),
    [active],
  );

  return (
    <div data-testid="chat-dock" className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          data-testid="chat-new"
          className="h-7 gap-1 px-2 text-[11px]"
          onClick={() => {
            void startNewSession();
            inputRef.current?.focus();
          }}
        >
          <MessageSquarePlus className="size-3.5" /> 新会话
        </Button>
        <HistoryMenu />
        <Button
          variant="ghost"
          size="sm"
          data-testid="chat-save-doc"
          className="h-7 gap-1 px-2 text-[11px] disabled:opacity-40"
          disabled={!hasTurns || streaming}
          onClick={() => void saveAsDoc()}
          title="将会话转换为普通文档并在当前标签打开"
        >
          <FileDown className="size-3.5" /> 存为文档
        </Button>
        <ChatSkillPicker />
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 w-7 p-0"
          aria-label="AI 设置"
          onClick={() => openSettings('ai')}
        >
          <Settings2 className="size-3.5" />
        </Button>
      </div>

      {!active ? (
        <div data-testid="chat-empty" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-muted">
            <Sparkles className="size-5 text-primary" />
          </div>
          <p className="text-sm font-medium">AI 对话</p>
          <p className="max-w-60 text-[11px] leading-relaxed text-muted-foreground">
            提问会自动附带当前笔记上下文与知识库召回；会话保存为「{folder}」中的笔记，可被双链引用。
          </p>
          <Button data-testid="chat-empty-start" size="sm" onClick={() => void startNewSession()}>
            <MessageSquarePlus className="size-3.5" /> 开始新对话
          </Button>
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            data-testid="chat-messages"
            className="min-h-0 flex-1 space-y-2.5 overflow-auto rounded-md bg-muted/30 p-2"
          >
            {active.turns.length === 0 && (
              <p className="p-2 text-[11px] text-muted-foreground">
                {modelLabel ? `已连接 ${modelLabel}，开始提问吧。` : '输入问题开始对话。'}
              </p>
            )}
            {active.turns.map((turn, i) => (
              <TurnView key={i} turn={turn} />
            ))}
            {error && (
              <div data-testid="chat-error" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
                {error}
              </div>
            )}
          </div>

          <ContextChips />

          <form
            className="flex shrink-0 items-end gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              ref={inputRef}
              data-testid="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              placeholder={placeholder}
              className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-md border bg-transparent px-2.5 py-2 text-[13px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            {streaming ? (
              <Button
                data-testid="chat-stop"
                type="button"
                variant="outline"
                size="sm"
                className="h-9 px-2 text-[12px]"
                onClick={() => stopStream()}
              >
                停止
              </Button>
            ) : (
              <Button
                data-testid="chat-send"
                type="submit"
                size="sm"
                className="h-9 px-3 text-[12px]"
                disabled={!input.trim()}
              >
                发送
              </Button>
            )}
          </form>
        </>
      )}
    </div>
  );
}
