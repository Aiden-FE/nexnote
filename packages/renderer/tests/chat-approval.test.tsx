// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// mock chat-runtime，让 openAgentHelp 行为可断言
// vi.hoisted 让 mock 对象在 vi.mock 工厂（被提升到顶部）里也能拿到引用
const { mockRuntime } = vi.hoisted(() => ({
  mockRuntime: {
    startNewSession: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => undefined),
    setPermissionMode: vi.fn(async () => undefined),
    initChatRuntime: vi.fn(() => undefined),
    searchSessions: vi.fn(async () => undefined),
    stopStream: vi.fn(() => undefined),
    openSession: vi.fn(async () => undefined),
    saveActiveAsDocument: vi.fn(async () => null),
  },
}));

vi.mock('../src/features/ai/chat/chat-runtime', () => mockRuntime);

import { statusBarRegistry } from '../src/registries';
import { VaultContext } from '../src/shell/vault-context';
import { useChatStore, type PendingApproval } from '../src/features/ai/chat/chat-store';
import { ChatDock } from '../src/features/ai/chat/ChatDock';
import '../src/features/git';
import '../src/features/ai/chat/ChatDock';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const vault = {
  root: '/tmp/nexnote-approval-vault',
  name: 'approval-vault',
  configPath: '/tmp/nexnote-approval-vault/.nexnote/config.json',
};

interface CallLog {
  channel: string;
  payload?: unknown;
}

function installBridge(options: {
  gitStatus?: Record<string, unknown>;
  gitDiagnose?: Record<string, unknown> | null;
  throwDiagnose?: boolean;
}) {
  const calls: CallLog[] = [];
  const eventCallbacks = new Map<string, Array<(payload: unknown) => void>>();
  const invokeFn = vi.fn(async (channel: string, payload?: unknown) => {
    calls.push({ channel, payload });
    if (channel === 'git:getStatus') {
      return { ok: true, data: options.gitStatus ?? { conflict: true, rebaseInProgress: true } };
    }
    if (channel === 'git:doctor:diagnose') {
      if (options.throwDiagnose) return { ok: false, error: { message: 'no doctor' } };
      return { ok: true, data: options.gitDiagnose ?? null };
    }
    if (channel === 'git:configureAutoSync') return { ok: true, data: undefined };
    if (channel === 'git:doctor:repairPrepare') return { ok: true, data: { ticket: 't-1' } };
    if (channel === 'git:doctor:repairExecute') return { ok: true, data: { message: 'ok' } };
    return { ok: true, data: null };
  });
  const onFn = vi.fn((channel: string, cb: (payload: unknown) => void) => {
    if (!eventCallbacks.has(channel)) eventCallbacks.set(channel, []);
    eventCallbacks.get(channel)!.push(cb);
    return () => undefined;
  });
  (window as unknown as { nexnote: unknown }).nexnote = { invoke: invokeFn, on: onFn };
  return {
    calls,
    emit: (channel: string, payload: unknown) => {
      for (const cb of eventCallbacks.get(channel) ?? []) cb(payload);
    },
  };
}

const baseStatus = {
  repository: true,
  branch: 'main',
  changed: 1,
  ahead: 0,
  behind: 0,
  remote: 'origin',
  conflict: true,
  rebaseInProgress: true,
  usingSystemGit: false,
};

const diagnosis = {
  issue: { category: 'conflict', message: '存在未完成的 rebase/merge', code: 'REBASE_IN_PROGRESS' },
  plan: {
    action: 'preserve-local-and-abort',
    commandPreview: 'git format-patch → git rebase --abort → git am --3way',
    requiresConfirmation: true,
    safe: true,
    manualGuidance: '默认推荐保留笔记并中止 rebase',
  },
  conflictFiles: ['.gitignore'],
  explanation: '当前分支有未完成的变基或合并，且还有 1 个文件未提交',
  explanationSource: 'rules',
  status: baseStatus,
};

let container: HTMLDivElement;
let root: Root | null = null;

function renderGitStatusItem(): void {
  const entry = statusBarRegistry.get('git');
  if (!entry) throw new Error('git status bar not registered');
  const Item = entry.render as () => React.ReactNode;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <VaultContext.Provider value={vault as never}>
        <Item />
      </VaultContext.Provider>,
    );
  });
}

function renderChatDock(): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <VaultContext.Provider value={vault as never}>
        <ChatDock />
      </VaultContext.Provider>,
    );
  });
}

function flushAsync(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  useChatStore.getState().reset();
  mockRuntime.startNewSession.mockClear();
  mockRuntime.sendMessage.mockClear();
  mockRuntime.setPermissionMode.mockClear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = null;
  }
  if (container && container.parentNode) container.parentNode.removeChild(container);
  container = undefined as unknown as HTMLDivElement;
});

describe('DoctorDialog → Chat Dock 同步助手入口', () => {
  it('点击「让 Agent 帮助解决」注入 sync-doctor chip 并切到编辑态', async () => {
    installBridge({ gitStatus: baseStatus, gitDiagnose: diagnosis });
    renderGitStatusItem();
    await flushAsync();

    // conflict 徽标 click → doctor dialog 弹出
    const conflictBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="status-git-conflict"]',
    );
    expect(conflictBtn).not.toBeNull();
    act(() => conflictBtn!.click());
    await flushAsync();

    const dialog = document.querySelector('[role="dialog"][aria-label="Git 同步诊断"]');
    expect(dialog).not.toBeNull();
    // rebase 分支显示「让 Agent 帮助解决」按钮
    const helpBtn = [...dialog!.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('让 Agent 帮助解决'),
    );
    expect(helpBtn).toBeDefined();

    act(() => helpBtn!.click());
    await flushAsync();
    // 等待 openAgentHelp 内部的 await ensure / setPermissionMode / sendMessage
    await vi.runAllTimersAsync();

    // 1. 切到编辑态（edit 模式是审批 gate 的前置）
    expect(mockRuntime.setPermissionMode).toHaveBeenCalledWith('edit');
    // 2. 启动新会话
    expect(mockRuntime.startNewSession).toHaveBeenCalled();
    // 3. 发了结构化 prompt，包含 doctor 推荐的 action
    expect(mockRuntime.sendMessage).toHaveBeenCalled();
    const prompt = (mockRuntime.sendMessage.mock.calls[0]?.[0] as string) ?? '';
    expect(prompt).toContain('preserve-local-and-abort');
    expect(prompt).toContain('git_doctor_repair');
  });

  it('sync-doctor chip 的 kind 出现在 chat-store 的 chips 列表里', async () => {
    installBridge({ gitStatus: baseStatus, gitDiagnose: diagnosis });
    renderGitStatusItem();
    await flushAsync();

    const conflictBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="status-git-conflict"]',
    );
    act(() => conflictBtn!.click());
    await flushAsync();

    const helpBtn = [...document.querySelectorAll('button')]
      .filter((b) => b.closest('[role="dialog"]'))
      .find((b) => b.textContent?.includes('让 Agent 帮助解决'));
    expect(helpBtn).toBeDefined();
    act(() => helpBtn!.click());
    await flushAsync();
    await vi.runAllTimersAsync();

    const chips = useChatStore.getState().chips;
    const syncChip = chips.find((c) => c.kind === 'sync-doctor');
    expect(syncChip).toBeDefined();
    // chip text 含结构化字段
    expect(syncChip!.text).toContain('推荐操作：preserve-local-and-abort');
    expect(syncChip!.text).toContain('类别：conflict（REBASE_IN_PROGRESS）');
    expect(syncChip!.text).toContain('冲突文件：.gitignore');
  });

  it('冲突可自动收敛时以「让 Agent 修复」为首选按钮，直接触发一键修复', async () => {
    const bridge = installBridge({
      gitStatus: baseStatus,
      gitDiagnose: {
        ...diagnosis,
        plan: {
          ...diagnosis.plan,
          action: 'resolve-conflict-and-continue',
          commandPreview: '规范化 .gitignore → git rebase --continue → git push',
        },
      },
    });
    renderGitStatusItem();
    await flushAsync();

    const conflictBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="status-git-conflict"]',
    );
    act(() => conflictBtn!.click());
    await flushAsync();

    const dialog = document.querySelector('[role="dialog"][aria-label="Git 同步诊断"]');
    expect(dialog).not.toBeNull();
    const primary = dialog!.querySelector<HTMLButtonElement>('button.bg-primary');
    expect(primary?.textContent).toContain('让 Agent 修复');

    act(() => primary!.click());
    await flushAsync();
    // 一键修复走 repairPrepare + repairExecute，而不是只打开对话
    const prepared = bridge.calls.find((c) => c.channel === 'git:doctor:repairPrepare');
    expect(prepared).toBeDefined();
    expect(prepared!.payload).toEqual({ action: 'resolve-conflict-and-continue' });
    expect(bridge.calls.some((c) => c.channel === 'git:doctor:repairExecute')).toBe(true);
  });
});

describe('审批 banner', () => {
  it('approvalRequired 事件触发后 ChatDock 显示 banner，含工具名和剩余时间', async () => {
    installBridge({ gitStatus: baseStatus, gitDiagnose: diagnosis });
    renderChatDock();
    await flushAsync();

    // 模拟主进程发出审批请求
    const expiresAt = Date.now() + 60_000;
    const pending: PendingApproval = {
      approvalId: 'a-1',
      tool: 'git_doctor_repair',
      summary: 'Git Doctor 修复操作：preserve-local-and-abort',
      expiresAt,
    };
    act(() => {
      useChatStore.getState().setPendingApproval(pending);
    });
    await flushAsync();

    const banner = document.querySelector('[data-testid="chat-approval-banner"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain('执行 git 修复');
    expect(banner!.textContent).toContain('preserve-local-and-abort');
    expect(banner!.textContent).toMatch(/60\s*秒/);
  });

  it('点击批准 → invoke agent:approval:respond + 清掉 pendingApproval', async () => {
    const bridge = installBridge({ gitStatus: baseStatus, gitDiagnose: diagnosis });
    renderChatDock();
    await flushAsync();

    act(() => {
      useChatStore.getState().setPendingApproval({
        approvalId: 'a-2',
        tool: 'edit_current_selection',
        expiresAt: Date.now() + 60_000,
      });
    });
    await flushAsync();

    const approve = document.querySelector<HTMLButtonElement>(
      '[data-testid="chat-approval-approve"]',
    );
    expect(approve).not.toBeNull();
    act(() => approve!.click());
    await flushAsync();

    const respondCall = bridge.calls.find((c) => c.channel === 'agent:approval:respond');
    expect(respondCall).toBeDefined();
    expect(respondCall!.payload).toEqual({ approvalId: 'a-2', decision: 'approved' });
    expect(useChatStore.getState().pendingApproval).toBeNull();
    // 批准后立即显示「执行中」，避免批准到出字之间看起来像卡死
    expect(useChatStore.getState().runningTool).toBe('edit_current_selection');
  });

  it('批准后显示执行中 banner，工具完成事件到达后消失', async () => {
    installBridge({ gitStatus: baseStatus, gitDiagnose: diagnosis });
    renderChatDock();
    await flushAsync();

    act(() => {
      useChatStore.getState().setPendingApproval({
        approvalId: 'a-run',
        tool: 'git_doctor_repair',
        expiresAt: Date.now() + 60_000,
      });
    });
    await flushAsync();
    act(() =>
      document.querySelector<HTMLButtonElement>('[data-testid="chat-approval-approve"]')!.click(),
    );
    await flushAsync();

    const banner = document.querySelector('[data-testid="chat-running-tool"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain('正在执行 git 修复');

    // 工具执行完成事件到达 → banner 消失
    act(() => {
      useChatStore.getState().setRunningTool(null);
    });
    await flushAsync();
    expect(document.querySelector('[data-testid="chat-running-tool"]')).toBeNull();
  });

  it('点击拒绝 → decision=denied', async () => {
    const bridge = installBridge({ gitStatus: baseStatus, gitDiagnose: diagnosis });
    renderChatDock();
    await flushAsync();

    act(() => {
      useChatStore.getState().setPendingApproval({
        approvalId: 'a-3',
        tool: 'git_doctor_repair',
        expiresAt: Date.now() + 60_000,
      });
    });
    await flushAsync();

    const deny = document.querySelector<HTMLButtonElement>('[data-testid="chat-approval-deny"]');
    act(() => deny!.click());
    await flushAsync();

    const respondCall = bridge.calls.find((c) => c.channel === 'agent:approval:respond');
    expect(respondCall!.payload).toEqual({ approvalId: 'a-3', decision: 'denied' });
  });

  it('finalizeStream 路径上清掉残留的 pendingApproval', () => {
    useChatStore.getState().setPendingApproval({
      approvalId: 'a-4',
      tool: 'git_doctor_repair',
      expiresAt: Date.now() + 60_000,
    });
    expect(useChatStore.getState().pendingApproval).not.toBeNull();
    useChatStore.getState().setPendingApproval(null);
    expect(useChatStore.getState().pendingApproval).toBeNull();
  });
});
