import { invoke, onEvent } from '../lib/ipc';
import type { BinaryEditorCommand } from '@nexnote/shared';

/**
 * DEV-074 二进制编辑器宿主的会话与落盘编排。
 *
 * 每个 WebContentsView 宿主一个会话（kind + path）。保存时机（ADR-0015 Decision 6）：
 * 编辑即写（debounce）；flush() 等待 pending 写入完成（关闭 tab / 窗口时主进程调用）。
 * 乐观锁 expectedSha256：保存成功后更新基线，外部修改冲突时回填提示并刷新。
 */

export interface SessionMeta {
  headersFooters: number;
  numberingStyles: number;
  superSubscripts: number;
}

export interface SessionState {
  kind: 'docx' | 'xlsx' | 'mindmap';
  path: string;
  sha256: string;
  docx?: { html: string; meta: SessionMeta };
  xlsx?: { sheets: unknown[] };
  mindmap?: { model: unknown };
  readonly: string[];
  /** 只读保留区标注（宏/图表/透视表/外框/关联线）。 */
  status: string | null;
  conflict: boolean;
}

const DEBOUNCE_MS = 1200;

let session: SessionState | null = null;
interface DirtyPayload {
  html?: string;
  sheets?: unknown[];
  model?: unknown;
}
let dirtyPayload: DirtyPayload | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving = false;
let pendingSaves = 0;
const listeners = new Set<(state: SessionState | null) => void>();
const flushResolvers: (() => void)[] = [];

export function subscribeSession(listener: (state: SessionState | null) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function getSession(): SessionState | null {
  return session;
}

function emit(): void {
  for (const listener of listeners) listener(session);
}

function settleFlushesIfIdle(): void {
  if (saving || dirtyPayload !== null || saveTimer !== null || pendingSaves > 0) return;
  const resolvers = flushResolvers.splice(0);
  for (const resolve of resolvers) resolve();
}

function saveCompleted(): void {
  pendingSaves = Math.max(0, pendingSaves - 1);
  settleFlushesIfIdle();
}

async function persistNow(): Promise<void> {
  if (!session || saving) return;
  const payload = dirtyPayload;
  dirtyPayload = null;
  if (!payload) return;
  saving = true;
  pendingSaves += 1;
  try {
    if (session.kind === 'docx' && payload.html !== undefined) {
      const result = await invoke('binary:docx:save', {
        path: session.path,
        html: payload.html,
        expectedSha256: session.sha256,
      });
      session.sha256 = result.sha256;
      session.status = '已保存';
      session.conflict = false;
    } else if (session.kind === 'xlsx' && payload.sheets !== undefined) {
      const result = await invoke('binary:save', {
        kind: 'xlsx',
        path: session.path,
        data: { sheets: payload.sheets },
        expectedSha256: session.sha256,
      });
      session.sha256 = result.sha256;
      session.status = '已保存';
      session.conflict = false;
    } else if (session.kind === 'mindmap' && payload.model !== undefined) {
      const result = await invoke('binary:save', {
        kind: 'mindmap',
        path: session.path,
        data: { model: payload.model },
        expectedSha256: session.sha256,
      });
      session.sha256 = result.sha256;
      session.status = '已保存';
      session.conflict = false;
    }
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'BINARY_CONFLICT') {
      session.conflict = true;
      session.status = '副本已被外部修改，未覆盖。请重新打开后再编辑。';
    } else {
      // 保存失败不丢编辑：把内容放回 dirtyPayload，下一次编辑/flush 重试。
      const retry: DirtyPayload = { ...payload };
      if (dirtyPayload) Object.assign(retry, dirtyPayload);
      dirtyPayload = retry;
      session.status = `保存失败（将自动重试）：${e instanceof Error ? e.message : String(e)}`;
      scheduleSave();
    }
  } finally {
    saving = false;
    saveCompleted();
    emit();
    // 新编辑可能在上一笔保存进行中抵达。若正在 flush（resolver 存在），立即排空队列，
    // 不等 debounce，确保关闭 tab / 窗口的 round-trip 不会留下未写入的 dirtyPayload。
    if (flushResolvers.length > 0 && dirtyPayload !== null) {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      void persistNow();
    } else {
      settleFlushesIfIdle();
    }
  }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistNow();
  }, DEBOUNCE_MS);
}

/** 编辑即写入口：宿主各编辑器 onChange 调用。 */
export function markDirty(patch: {
  html?: string;
  sheets?: unknown[];
  model?: unknown;
}): void {
  if (!session) return; // load 完成前编辑器不可交互，防御性忽略。
  dirtyPayload = { ...dirtyPayload, ...patch };
  session.status = '编辑中…';
  emit();
  scheduleSave();
}

async function loadDocument(kind: SessionState['kind'], path: string): Promise<SessionState> {
  if (kind === 'docx') {
    const result = await invoke('binary:docx:read', { path });
    return {
      kind,
      path,
      sha256: result.sha256,
      docx: { html: result.html, meta: result.meta },
      readonly: [],
      status: null,
      conflict: false,
    };
  }
  const result = await invoke('binary:read', { kind, path });
  if (kind === 'xlsx') {
    const data = result.data as { sheets?: unknown[] };
    return {
      kind,
      path,
      sha256: result.sha256,
      xlsx: { sheets: data.sheets ?? [] },
      readonly: result.readonly ?? [],
      status: null,
      conflict: false,
    };
  }
  const data = result.data as { model?: unknown };
  return {
    kind,
    path,
    sha256: result.sha256,
    mindmap: { model: data.model ?? { data: { text: '' }, children: [] } },
    readonly: result.readonly ?? [],
    status: null,
    conflict: false,
  };
}

/** 等待所有 pending 写入完成（主进程 flush 指令对应）。 */
export function flushPending(): Promise<void> {
  return new Promise((resolve) => {
    // 先冲刷当前 debounce，并把 resolver 挂入队列。persistNow 若正忙会立即返回；
    // 当前保存 finally 会看到 resolver 并继续排空期间新增的 dirtyPayload。
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    flushResolvers.push(resolve);
    if (!saving && dirtyPayload !== null) {
      void persistNow();
    } else {
      settleFlushesIfIdle();
    }
  });
}

/** 处理主进程经 binary:editorCommand 发来的控制指令。 */
async function handleCommand(command: BinaryEditorCommand): Promise<void> {
  if (command.command === 'load' && command.path) {
    if (session && session.path === command.path) return;
    // 切换文档前冲刷上一个文档的 pending 写入。
    await flushPending();
    try {
      session = await loadDocument(command.kind, command.path);
    } catch (e) {
      session = {
        kind: command.kind,
        path: command.path,
        sha256: '',
        readonly: [],
        status: `加载失败：${e instanceof Error ? e.message : String(e)}`,
        conflict: false,
      };
    }
    emit();
    return;
  }
  if (command.command === 'flush') {
    await flushPending();
    return;
  }
  if (command.command === 'destroy') {
    await flushPending();
    session = null;
    emit();
    return;
  }
  if (command.command === 'theme') {
    document.documentElement.dataset.theme = command.theme ?? 'light';
  }
}

/** 宿主引导：订阅主进程控制指令；暴露 flush 钩子供主进程 executeJavaScript 等待。 */
export function bootstrapBinaryHost(): () => void {
  // 主进程在关闭 tab / 窗口前经 executeJavaScript 调用本钩子等待 pending 写入完成。
  (window as unknown as { __nexnoteHostFlush: () => Promise<void> }).__nexnoteHostFlush = () =>
    flushPending();
  const unsubscribe = onEvent('binary:editorCommand', (command) => {
    void handleCommand(command);
  });
  // DEV-074 P0 修复：ack 必须在 onEvent 安装完成后立刻发；
  // 主进程收到 ack 后才下发 'load' / 'theme' 命令，并允许 flush 经 executeJavaScript 等待。
  // ack 重复也无害：主进程按 senderId 幂等。
  void invoke('binary:host:ready')
    .then(() => undefined)
    .catch(() => undefined);
  return unsubscribe;
}
