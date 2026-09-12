import type { EditorView } from '@codemirror/view';

import { useIndexStore } from '../../stores/index-store';
import { titleFromPath } from '../title-sync';
import { requestAskAi } from '../../features/ai/chat/ask-ai';
import {
  assembleWritingContext,
  fromAiActionId,
  startWritingStream,
  useWritingStore,
  WRITING_ACTION_MAP,
} from '../../features/ai/writing';
import type { WritingStreamHandle } from '../../features/ai/writing/stream';
import { nextSessionId } from '../../features/ai/writing/writing-store';
import type { SourceBubbleContext } from './source-bubble';

/**
 * 源码模式 AI 辅助编排：划词工具栏动作 → 与块编辑一致的写作会话。
 *
 * - 「询问 AI」复用 requestAskAi（chat queueAsk 带选区）
 * - 白名单写作动作走 agent:run:writing（prompt 由主进程 writing scenario 持有，
 *   渲染层只传 actionId + 选区），流式结果经共享 WritingAssistantLayer 预览
 * - Accept：单个 CodeMirror 事务写回（replace 替换选区；append 追加到末行后），可 undo
 * - Reject/Cancel：取消上游流，源码不变
 */

export interface SourceAiAssistDeps {
  /** 当前页路径（titleFromPath 取文档名、反链对齐）。 */
  getDocPath(): string;
}

/** 询问 AI 动作 id（与块编辑 CHAT_ASK_ACTION 对齐，经 bubble onAction 透传）。 */
export const SOURCE_CHAT_ASK_ACTION = 'chat:ask-selection';

export function openSourceWritingSession(
  view: EditorView,
  rawActionId: string,
  ctx: SourceBubbleContext,
  deps: SourceAiAssistDeps,
): void {
  const actionId = fromAiActionId(rawActionId);
  const action = actionId ? WRITING_ACTION_MAP[actionId] : null;
  if (!actionId || !action || !ctx.text.trim()) return;

  const docPath = deps.getDocPath();
  const idx = useIndexStore.getState();
  const backlinks =
    idx.backlinksFor === docPath
      ? idx.backlinks.map((b) => ({ title: b.fromTitle, snippet: b.snippet }))
      : [];
  const assembly = assembleWritingContext({
    target: ctx.text,
    document: view.state.doc.toString(),
    backlinks,
  });

  let stream: WritingStreamHandle | null = null;
  const sessionId = nextSessionId();
  useWritingStore.getState().openSession({
    id: sessionId,
    actionId,
    label: action.label,
    kind: action.kind,
    status: 'streaming',
    original: action.kind === 'replace' ? ctx.text : '',
    generated: '',
    truncated: assembly.truncated,
    note: assembly.note,
    error: null,
    coords: ctx.coords,
    accept: () => {
      const generated = useWritingStore.getState().session?.generated ?? '';
      stream?.cancel();
      if (generated.trim()) applyGenerated(view, action.kind, ctx, generated);
      useWritingStore.getState().closeSession();
    },
    reject: () => {
      stream?.cancel();
      useWritingStore.getState().closeSession();
    },
    cancel: () => {
      stream?.cancel();
      useWritingStore.getState().closeSession();
    },
  });

  stream = startWritingStream(
    { actionId, target: ctx.text, contextText: assembly.contextBlock },
    {
      onDelta: (text) => {
        const current = useWritingStore.getState().session;
        if (!current || current.id !== sessionId) return;
        useWritingStore.getState().patchSession({ generated: current.generated + text });
      },
      onDone: () => {
        const current = useWritingStore.getState().session;
        if (!current || current.id !== sessionId) return;
        useWritingStore.getState().patchSession({ status: 'done' });
      },
      onError: (message, code) => {
        const current = useWritingStore.getState().session;
        if (!current || current.id !== sessionId) return;
        useWritingStore
          .getState()
          .patchSession({ status: 'error', error: `${message}${code ? `（${code}）` : ''}` });
      },
    },
  );
}

/** 单事务写回：replace 替换选区；append 在选区末行之后追加新段落。 */
function applyGenerated(
  view: EditorView,
  kind: 'replace' | 'append',
  ctx: SourceBubbleContext,
  generated: string,
): void {
  if (kind === 'replace') {
    view.dispatch({ changes: { from: ctx.from, to: ctx.to, insert: generated } });
    return;
  }
  const line = view.state.doc.lineAt(ctx.to);
  const prefix = line.text.trim() ? '\n\n' : '';
  view.dispatch({ changes: { from: line.to, insert: `${prefix}${generated}` } });
}

/** 划词工具栏动作分派：询问 AI / 白名单写作动作。未知 id 忽略。 */
export function handleSourceBubbleAction(
  view: EditorView,
  id: string,
  ctx: SourceBubbleContext,
  deps: SourceAiAssistDeps,
): void {
  if (id === SOURCE_CHAT_ASK_ACTION) {
    const docPath = deps.getDocPath();
    requestAskAi(ctx.text, titleFromPath(docPath), docPath);
    return;
  }
  openSourceWritingSession(view, id, ctx, deps);
}
