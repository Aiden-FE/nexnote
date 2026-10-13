import { invoke, onEvent } from '../lib/ipc';
import {
  setCurrentLanguage,
  tCurrent,
  type MindmapStructureId,
  type BinaryEditorCommand,
  type BinaryReadonlyTag,
} from '@nexnote/shared';

/**
 * DEV-074 二进制编辑器宿主的会话与落盘编排。
 *
 * 每个 WebContentsView 宿主一个会话（kind + path）。保存时机（ADR-0015 Decision 6）：
 * 编辑即写（debounce）；flush() 等待 pending 写入完成（关闭 tab / 窗口时主进程调用）。
 * 乐观锁 expectedSha256：保存成功后更新基线，外部修改冲突时回填提示并刷新。
 */

export interface SessionState {
  kind: 'xlsx' | 'mindmap';
  path: string;
  sha256: string;
  xlsx?: { sheets: unknown[] };
  mindmap?: { model: unknown; structureId: MindmapStructureId | null };
  readonly: BinaryReadonlyTag[];
  /** 只读保留区标注（宏/图表/透视表/外框/关联线）。 */
  /** 语言无关的保存状态；UI 按当前语言成文。 */
  status: SessionStatus | null;
  conflict: boolean;
}

/** 保存状态的语义快照（避免把旧语言文本缓存在 session 中）。 */
export type SessionStatus =
  | { kind: 'saved' }
  | { kind: 'editing' }
  | { kind: 'externalModified'; phase: 'conflict' | 'dirty' }
  | { kind: 'saveFailed'; message: string }
  | { kind: 'loadFailed'; message: string };

const DEBOUNCE_MS = 1200;

let session: SessionState | null = null;
interface DirtyPayload {
  sheets?: unknown[];
  model?: unknown;
  /** DEV-114：用户显式选择的结构；随下一次模型保存写入官方 root structureClass。 */
  explicitStructure?: MindmapStructureId;
}
let dirtyPayload: DirtyPayload | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving = false;
let pendingSaves = 0;
let flushFailureCode: string | null = null;
// 用户是否已与编辑器交互过：宿主挂载时编辑器会立刻回传一次 onChange
// （fortune-sheet / simple-mind-map 初始化数据时都会 emit），其 payload 等于刚载入
// 的内容。照单全收就会「打开即写盘」，对 xlsx 更是立刻覆盖磁盘（历史缺陷之一）。
let userActive = false;
const listeners = new Set<(state: SessionState | null) => void>();
const flushResolvers: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];

/** 把语言无关的保存状态成文（renderer 与 flush 拒绝错误共用）。 */
function renderStatus(status: SessionStatus): string {
  switch (status.kind) {
    case 'saved':
      return tCurrent('binary.status.saved');
    case 'editing':
      return tCurrent('binary.status.editing');
    case 'externalModified':
      return tCurrent(
        status.phase === 'conflict'
          ? 'binary.status.externalModifiedConflict'
          : 'binary.status.externalModifiedDirty',
      );
    case 'saveFailed':
      return tCurrent('binary.status.saveFailed', { message: status.message });
    case 'loadFailed':
      return tCurrent('binary.status.loadFailed', { message: status.message });
  }
}

/** 导出给 UI 使用的状态成文函数。 */
export function sessionStatusText(status: SessionStatus | null): string | null {
  return status ? renderStatus(status) : null;
}

export function subscribeSession(listener: (state: SessionState | null) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function getSession(): SessionState | null {
  return session;
}

/** 宿主在编辑器容器捕获到 pointerdown/keydown 时调用：确认是真实用户交互。 */
export function markUserInteraction(): void {
  userActive = true;
}

function emit(): void {
  for (const listener of listeners) listener(session);
}

function settleFlushesIfIdle(): void {
  if (saving || dirtyPayload !== null || saveTimer !== null || pendingSaves > 0) return;
  const resolvers = flushResolvers.splice(0);
  for (const waiter of resolvers) waiter.resolve();
}

function rejectPendingFlushes(error: Error): void {
  const resolvers = flushResolvers.splice(0);
  for (const waiter of resolvers) waiter.reject(error);
}

/** flush 失败按调用时的当前语言成文，避免冲突后切换语言仍抛旧语言文本。 */
function flushFailureError(code: string): Error {
  if (code === 'BINARY_CONFLICT') {
    return Object.assign(new Error(tCurrent('binary.status.saveConflict')), { code });
  }
  return new Error(tCurrent('ipc.error.INTERNAL'));
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
    if (session.kind === 'xlsx' && payload.sheets !== undefined) {
      const result = await invoke('binary:save', {
        kind: 'xlsx',
        path: session.path,
        data: { sheets: payload.sheets },
        expectedSha256: session.sha256,
      });
      session.sha256 = result.sha256;
      session.status = { kind: 'saved' };
      session.conflict = false;
    } else if (session.kind === 'mindmap' && payload.model !== undefined) {
      const result = await invoke('binary:save', {
        kind: 'mindmap',
        path: session.path,
        data: { model: payload.model, explicitStructure: payload.explicitStructure },
        expectedSha256: session.sha256,
      });
      session.sha256 = result.sha256;
      session.status = { kind: 'saved' };
      session.conflict = false;
    }
    flushFailureCode = null;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'BINARY_CONFLICT') {
      const conflictError = flushFailureError('BINARY_CONFLICT');
      const retry: DirtyPayload = { ...payload };
      if (dirtyPayload) Object.assign(retry, dirtyPayload);
      dirtyPayload = retry;
      flushFailureCode = 'BINARY_CONFLICT';
      session.conflict = true;
      session.status = { kind: 'externalModified', phase: 'conflict' };
      rejectPendingFlushes(conflictError);
    } else {
      // 保存失败不丢编辑：把内容放回 dirtyPayload，下一次编辑/flush 重试。
      const retry: DirtyPayload = { ...payload };
      if (dirtyPayload) Object.assign(retry, dirtyPayload);
      dirtyPayload = retry;
      session.status = {
        kind: 'saveFailed',
        message: e instanceof Error ? e.message : String(e),
      };
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
export function markDirty(patch: { sheets?: unknown[]; model?: unknown }): void {
  if (!session) return; // load 完成前编辑器不可交互，防御性忽略。
  if (!userActive) return; // 载入首帧的初始化回调不算编辑，不写盘。
  dirtyPayload = { ...dirtyPayload, ...patch };
  if (session.conflict) {
    session.status = { kind: 'externalModified', phase: 'dirty' };
    emit();
    return;
  }
  session.status = { kind: 'editing' };
  emit();
  scheduleSave();
}

/** DEV-114：结构选择不单独写盘；它与下一次模型保存合并成一次 xmind 字节变更。 */
export function markExplicitStructure(structure: MindmapStructureId): void {
  if (!session || session.kind !== 'mindmap' || session.conflict) return;
  dirtyPayload = { ...(dirtyPayload ?? {}), explicitStructure: structure };
  session.mindmap = session.mindmap
    ? { ...session.mindmap, structureId: structure }
    : { model: { data: { text: '' }, children: [] }, structureId: structure };
  emit();
}

async function loadDocument(kind: SessionState['kind'], path: string): Promise<SessionState> {
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
  const structureId = result.structureId ?? null;
  return {
    kind,
    path,
    sha256: result.sha256,
    mindmap: {
      model: data.model ?? { data: { text: '' }, children: [] },
      structureId,
    },
    readonly: result.readonly ?? [],
    status: null,
    conflict: false,
  };
}

/** 等待所有 pending 写入完成（主进程 flush 指令对应）。 */
export function flushPending(): Promise<void> {
  if (flushFailureCode) return Promise.reject(flushFailureError(flushFailureCode));
  return new Promise((resolve, reject) => {
    // 先冲刷当前 debounce，并把 resolver 挂入队列。persistNow 若正忙会立即返回；
    // 当前保存 finally 会看到 resolver 并继续排空期间新增的 dirtyPayload。
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    flushResolvers.push({ resolve, reject });
    if (!saving && dirtyPayload !== null) {
      void persistNow();
    } else {
      settleFlushesIfIdle();
    }
  });
}

export async function reloadAfterConflict(): Promise<void> {
  if (!session?.conflict) return;
  const current = session;
  const pending = dirtyPayload;
  const reloaded = await loadDocument(current.kind, current.path);
  if (session !== current || dirtyPayload !== pending) {
    throw Object.assign(new Error(tCurrent('binary.status.reloadStateChanged')), {
      code: 'BINARY_STATE_CHANGED',
    });
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  dirtyPayload = null;
  flushFailureCode = null;
  userActive = false;
  session = reloaded;
  emit();
}

/** 处理主进程经 binary:editorCommand 发来的控制指令。 */
async function handleCommand(command: BinaryEditorCommand): Promise<void> {
  if (command.command === 'load' && command.path) {
    if (session && session.path === command.path) return;
    // 切换文档前冲刷上一个文档的 pending 写入。
    await flushPending();
    userActive = false;
    try {
      session = await loadDocument(command.kind, command.path);
    } catch (e) {
      session = {
        kind: command.kind,
        path: command.path,
        sha256: '',
        readonly: [],
        status: {
          kind: 'loadFailed',
          message: e instanceof Error ? e.message : String(e),
        },
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
    return;
  }
  if (command.command === 'language') {
    setCurrentLanguage(command.language);
    // 保存状态是语言无关的语义快照；切换语言后重算所有已渲染文本。
    emit();
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
  // DEV-074 P0 修复 + pull 模型：ack 必须在 onEvent 安装完成后立刻发。
  // ack 响应携带 ack 前排队的初始命令（load/theme），页面在已订阅状态下顺序应用——
  // 初始 load 因此永不丢失（主进程不向未订阅页面 push 命令）。
  void invoke('binary:host:ready')
    .then((result) => {
      void (async () => {
        for (const command of result.commands) {
          await handleCommand(command);
        }
      })();
    })
    .catch(() => undefined);
  return unsubscribe;
}
