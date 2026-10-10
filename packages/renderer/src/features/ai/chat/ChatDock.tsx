import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  AlertTriangle,
  CornerDownLeft,
  FileDown,
  Loader2,
  MessageSquarePlus,
  Search,
  Settings2,
  Sparkles,
} from 'lucide-react';
import type {
  ChatPermissionMode,
  ChatSessionStatus,
  ChatTurn,
  RetrievalResponse,
} from '@nexnote/shared';
import { useChatStore } from './chat-store';
import { ContextChips } from './ContextChips';
import { RetrievalSources } from '../retrieval/RetrievalSources';
import { insertAtActiveCursor, useActiveInsertionMode } from '../../../editor/caret-insert';
import { useTabStore } from '../../../stores/tab-store';
import { openSettings } from '../../../lib/open-settings';
import { openDocumentTab } from '../../../lib/open-document';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/button';
import {
  initChatRuntime,
  openSession,
  saveActiveAsDocument,
  searchSessions,
  sendMessage,
  startNewSession,
  stopStream,
  setPermissionMode,
} from './chat-runtime';
import { addSelectionContext, refreshAutoDocumentChip } from './chat-context-bridge';
import { ChatSkillPicker } from '../../skills/ChatSkillPicker';
import { DockPopover } from './DockPopover';
import { t, useI18n } from '../../../lib/i18n';

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
  const tr = useI18n();
  const isUser = turn.role === 'user';
  const sources = !isUser ? sourcesResponse(turn) : null;
  const insertionMode = useActiveInsertionMode();
  return (
    <div className={cn('group/turn flex flex-col', isUser ? 'items-end' : 'items-start')}>
      <div
        data-testid={isUser ? 'chat-turn-user' : 'chat-turn-assistant'}
        className={cn(
          'max-w-[92%] whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-[13px] leading-relaxed',
          isUser ? 'bg-primary text-primary-foreground' : 'border bg-background text-foreground',
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
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover/turn:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={insertionMode === null}
              title={
                insertionMode === null
                  ? tr('chat.insert.noEditor')
                  : tr('chat.insert.title', {
                      mode: tr(
                        insertionMode === 'source'
                          ? 'chat.insert.mode.source'
                          : 'chat.insert.mode.block',
                      ),
                    })
              }
              onClick={() => insertAtActiveCursor(turn.content)}
            >
              <CornerDownLeft className="size-3" /> {tr('chat.insertToCursor')}
            </button>
          </div>
          {sources && (
            <details
              data-testid="chat-sources"
              className="rounded-md border bg-muted/30 px-2 py-1 text-[11px]"
            >
              <summary className="cursor-pointer select-none text-muted-foreground">
                {tr('chat.sources.title')}
              </summary>
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

const STATUS_KEY: Record<ChatSessionStatus, string> = {
  complete: 'chat.sessionStatus.complete',
  streaming: 'chat.sessionStatus.streaming',
  cancelled: 'chat.sessionStatus.cancelled',
  failed: 'chat.sessionStatus.failed',
};

function HistoryMenu() {
  const tr = useI18n();
  const summaries = useChatStore((s) => s.summaries);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);

  // 打开历史面板或修改搜索词时由主进程过滤（会话量可增长，不在渲染层全量持有）。
  useEffect(() => {
    if (!open) return;
    void searchSessions(query);
  }, [open, query]);

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        data-testid="chat-history"
        aria-haspopup="true"
        aria-expanded={open}
        className="h-7 gap-1 px-2 text-[11px]"
        onClick={() => setOpen((v) => !v)}
      >
        {tr('chat.history.title')} <ChevronDown className="size-3" />
      </Button>
      <DockPopover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        testId="chat-history-menu"
        className="max-h-72 w-64 overflow-auto rounded-md border bg-popover p-1 text-[12px] text-popover-foreground shadow-md"
        placement="bottom"
      >
        <div className="relative mb-1 px-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <input
            data-testid="chat-history-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr('chat.history.searchPlaceholder')}
            className="w-full rounded border bg-transparent py-1 pl-7 pr-2 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>
        {summaries.length === 0 && (
          <p className="px-2 py-2 text-muted-foreground">
            {query.trim()
              ? tr('chat.history.emptyWithQuery')
              : tr('chat.history.empty')}
          </p>
        )}
        {summaries.map((s) => (
          <button
            key={s.path}
            type="button"
            data-testid="chat-history-item"
            data-status={s.status}
            onClick={() => {
              void openSession(s.path);
              setOpen(false);
            }}
            className="block w-full truncate rounded px-2 py-1.5 text-left hover:bg-accent"
            title={s.path}
          >
            <span className="flex items-center gap-1">
              <span className="truncate font-medium">{s.title}</span>
              {s.status !== 'complete' && (
                <span
                  data-testid="chat-history-status"
                  className="flex shrink-0 items-center gap-0.5 rounded bg-amber-500/15 px-1 text-[9px] text-amber-700"
                >
                  <AlertTriangle className="size-2.5" />
                  {t(STATUS_KEY[s.status])}
                </span>
              )}
            </span>
            <span className="block text-[10px] text-muted-foreground">
              {tr('chat.history.turnCount', {
                count: s.turnCount,
                time: new Date(s.updatedAt).toLocaleString(),
              })}
            </span>
          </button>
        ))}
      </DockPopover>
    </>
  );
}

export function ChatDock() {
  const tr = useI18n();
  const active = useChatStore((s) => s.active);
  const streaming = useChatStore((s) => s.streaming);
  const error = useChatStore((s) => s.error);
  const modelLabel = useChatStore((s) => s.modelLabel);
  const sessionStatus = useChatStore((s) => s.sessionStatus);
  const pendingAsk = useChatStore((s) => s.pendingAsk);
  const permissionMode = useChatStore((s) => s.permissionMode);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    initChatRuntime();
    void searchSessions();
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
    if (path) await openDocumentTab(path);
  }, []);

  const hasTurns = (active?.turns.length ?? 0) > 0;
  const placeholder = useMemo(
    () =>
      tr(active ? 'chat.input.placeholder.active' : 'chat.input.placeholder.new'),
    [active, tr],
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
          <MessageSquarePlus className="size-3.5" /> {tr('chat.new')}
        </Button>
        <HistoryMenu />
        <label
          className="flex items-center gap-1 text-[11px] text-muted-foreground"
          title={tr('chat.permission.toolTitle')}
        >
          {tr('chat.permission.title')}
          <select
            data-testid="chat-permission-mode"
            aria-label={tr('chat.permission.ariaLabel')}
            value={permissionMode}
            disabled={!active || streaming}
            onChange={(e) => void setPermissionMode(e.target.value as ChatPermissionMode)}
            className="h-7 rounded border bg-transparent px-1 text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <option value="conversation">{tr('chat.permission.conversation')}</option>
            <option value="edit">{tr('chat.permission.edit')}</option>
            <option value="full">{tr('chat.permission.full')}</option>
          </select>
        </label>
        <Button
          variant="ghost"
          size="sm"
          data-testid="chat-save-doc"
          className="h-7 gap-1 px-2 text-[11px] disabled:opacity-40"
          disabled={!hasTurns || streaming}
          onClick={() => void saveAsDoc()}
          title={tr('chat.export.title')}
        >
          <FileDown className="size-3.5" /> {tr('chat.export.label')}
        </Button>
        <ChatSkillPicker />
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 w-7 p-0"
          aria-label={tr('chat.aiSettings')}
          onClick={() => openSettings('ai')}
        >
          <Settings2 className="size-3.5" />
        </Button>
      </div>

      <PendingApprovalBanner />
      <RunningToolBanner />

      {!active ? (
        <div
          data-testid="chat-empty"
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center"
        >
          <div className="flex size-11 items-center justify-center rounded-full bg-muted">
            <Sparkles className="size-5 text-primary" />
          </div>
          <p className="text-sm font-medium">{tr('chat.empty.title')}</p>
          <p className="max-w-60 text-[11px] leading-relaxed text-muted-foreground">
            {tr('chat.empty.description')}
          </p>
          <Button data-testid="chat-empty-start" size="sm" onClick={() => void startNewSession()}>
            <MessageSquarePlus className="size-3.5" /> {tr('chat.empty.start')}
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
                {modelLabel
                  ? tr('chat.empty.connected', { model: modelLabel })
                  : tr('chat.empty.prompt')}
              </p>
            )}
            {active.turns.map((turn, i) => (
              <TurnView key={i} turn={turn} />
            ))}
            {error && (
              <div
                data-testid="chat-error"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive"
              >
                {error}
              </div>
            )}
            {!streaming && sessionStatus !== 'complete' && (
              <div
                data-testid="chat-unfinished"
                className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700"
              >
                {tr('chat.unfinished', {
                  status: t(STATUS_KEY[sessionStatus]),
                })}
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
                {tr('chat.stop')}
              </Button>
            ) : (
              <Button
                data-testid="chat-send"
                type="submit"
                size="sm"
                className="h-9 px-3 text-[12px]"
                disabled={!input.trim()}
              >
                {tr('chat.send')}
              </Button>
            )}
          </form>
        </>
      )}
    </div>
  );
}

/**
 * Agent 工具请求审批时的底部固定 banner。
 * - git_doctor_repair：明示将执行的 action；批准后由主进程 doctor.prepare+execute 安全执行。
 * - edit_current_selection / append_to_document：通用「文档编辑」说明。
 * 5 分钟 TTL 由主进程 ApprovalStore 维护；超时未点 → APPROVAL_EXPIRED。
 */
function PendingApprovalBanner() {
  const tr = useI18n();
  const pending = useChatStore((s) => s.pendingApproval);
  const respond = useChatStore((s) => s.respondApproval);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!pending) return;
    // 倒计时副作用：进入审批时立即对齐一次，之后每秒刷新剩余时间。
    // 这是显式的副作用（time tick），不是派生状态——直接 setState 即可。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pending]);
  if (!pending) return null;
  const remainMs = Math.max(0, pending.expiresAt - now);
  const remainSec = Math.ceil(remainMs / 1000);
  const toolLabel = t(TOOL_LABEL[pending.tool] ?? 'chat.approval.tool.fallback', {
    tool: pending.tool,
  });
  return (
    <div
      data-testid="chat-approval-banner"
      role="alertdialog"
      aria-label={tr('chat.approval.title')}
      className="shrink-0 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[12px] text-amber-700"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {tr('chat.approval.heading', { tool: toolLabel })}
          </p>
          {pending.summary && <p>{pending.summary}</p>}
          <p className="text-[10px] opacity-80">
            {remainSec > 0
              ? tr('chat.approval.expiresIn', { seconds: remainSec })
              : tr('chat.approval.expired')}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            data-testid="chat-approval-deny"
            onClick={() => void respond(pending.approvalId, 'denied')}
          >
            {tr('chat.approval.deny')}
          </Button>
          <Button
            size="sm"
            className="h-7 px-2 text-[11px]"
            data-testid="chat-approval-approve"
            onClick={() => void respond(pending.approvalId, 'approved')}
          >
            {tr('chat.approval.approve')}
          </Button>
        </div>
      </div>
    </div>
  );
}

const TOOL_LABEL: Record<string, string> = {
  git_doctor_repair: 'chat.approval.tool.git_doctor_repair',
  edit_current_selection: 'chat.approval.tool.edit_current_selection',
  append_to_document: 'chat.approval.tool.append_to_document',
};

/**
 * 审批通过后、模型再次出字之前的执行中指示。git_doctor_repair 可能要跑数十秒
 * （rebase 多个 commit + push），没有它用户只看到一个空气泡，像卡死。
 */
function RunningToolBanner() {
  const tr = useI18n();
  const runningTool = useChatStore((s) => s.runningTool);
  if (!runningTool) return null;
  const label = t(TOOL_LABEL[runningTool] ?? 'chat.runningTool.fallback', {
    tool: runningTool,
  });
  return (
    <div
      data-testid="chat-running-tool"
      role="status"
      className="flex shrink-0 items-center gap-1.5 rounded-md border bg-muted/40 p-2 text-[11px] text-muted-foreground"
    >
      <Loader2 className="size-3.5 animate-spin" />
      {tr('chat.runningTool', { label })}
    </div>
  );
}
