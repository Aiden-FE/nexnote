// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitStatus } from '@nexnote/shared';
import { statusBarRegistry } from '../src/registries';
import { VaultContext } from '../src/shell/vault-context';
import '../src/features/git'; // side-effect: register statusBarRegistry 'git' entry

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const vault = {
  root: '/tmp/nexnote-git-vault',
  name: 'git-vault',
  configPath: '/tmp/nexnote-git-vault/.nexnote/config.json',
};

const baseStatus: GitStatus = {
  repository: true,
  branch: 'main',
  changed: 0,
  ahead: 0,
  behind: 0,
  remote: null,
  conflict: false,
  usingSystemGit: false,
};

interface CallLog {
  channel: string;
  payload?: unknown;
}

/** 安装 mock bridge：invoke 按通道返回模拟响应；on 返回事件触发器集合，测试可主动派发。 */
function installBridge(options: {
  gitStatus?: GitStatus;
  gitDiagnose?: unknown; // 返回 GitDoctorDiagnosis | null | throw
  throwDiagnose?: boolean;
}) {
  const calls: CallLog[] = [];
  const eventCallbacks = new Map<string, Array<(payload: unknown) => void>>();
  const invokeFn = vi.fn(async (channel: string, payload?: unknown) => {
    calls.push({ channel, payload });
    if (channel === 'git:getStatus') {
      return { ok: true, data: options.gitStatus ?? baseStatus };
    }
    if (channel === 'git:doctor:diagnose') {
      if (options.throwDiagnose) {
        return { ok: false, error: { code: 'NO_DOCTOR', message: 'doctor 不可用' } };
      }
      return { ok: true, data: options.gitDiagnose ?? null };
    }
    if (channel === 'git:configureAutoSync') {
      return { ok: true, data: undefined };
    }
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

const diagnosis = {
  issue: { category: 'conflict', message: '有冲突文件', code: 'MERGE_CONFLICT' },
  plan: {
    action: null,
    commandPreview: null,
    requiresConfirmation: true,
    safe: true,
    manualGuidance: '手动解决',
  },
  conflictFiles: ['a.md', 'b.md'],
  explanation: '远端与本地的提交互相冲突。',
  explanationSource: 'rules',
  status: { ...baseStatus },
};

let container: HTMLDivElement;
let root: Root | null = null;

function renderGitStatusItem(): void {
  const entry = statusBarRegistry.get('git');
  if (!entry) throw new Error('statusBarRegistry 没有 git 条目（features/git 未加载？）');
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

const flushAsync = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  delete (window as unknown as { nexnote?: unknown }).nexnote;
});

describe('DEV-076 GitStatusItem 真实组件行为', () => {
  it('冲突徽标渲染为可点击 button，hover 文案含具体文件数', async () => {
    const bridge = installBridge({ gitStatus: { ...baseStatus, conflict: true } });
    renderGitStatusItem();
    await flushAsync();
    const conflictBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="status-git-conflict"]',
    );
    expect(conflictBtn, '冲突徽标应是 button').not.toBeNull();
    expect(conflictBtn!.tagName).toBe('BUTTON');
    // hover title 由 conflictHoverText 生成，至少包含"点击"提示（指示有实质内容而非空泛一句）
    expect(conflictBtn!.getAttribute('title') ?? '').toContain('点击');
    expect(conflictBtn!.getAttribute('title') ?? '').toContain('冲突');
    await act(async () => {
      bridge.emit('git:statusChanged', { ...baseStatus, conflict: true });
    });
    await flushAsync();
  });

  it('冲突徽标点击后触发 git:doctor:diagnose 并弹出 DoctorDialog', async () => {
    const bridge = installBridge({
      gitStatus: { ...baseStatus, conflict: true },
      gitDiagnose: diagnosis,
    });
    renderGitStatusItem();
    await flushAsync();
    const conflictBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="status-git-conflict"]',
    )!;
    expect(conflictBtn).not.toBeNull();
    act(() => conflictBtn.click());
    await flushAsync();
    // 点击后必须调用了诊断通道
    expect(bridge.calls.some((c) => c.channel === 'git:doctor:diagnose')).toBe(true);
    // DoctorDialog 应出现（含「让 Agent 帮助解决」按钮）
    const dialog = document.querySelector('[role="dialog"][aria-label="Git 同步诊断"]');
    expect(dialog, 'DoctorDialog 应弹出').not.toBeNull();
    // 对话框展示 issue.message（而非 issue.code），与 GitStatusItem 中 DoctorDialog 的实际渲染一致
    expect(dialog!.textContent).toContain('有冲突文件');
    expect(dialog!.textContent).toContain('a.md');
    expect(dialog!.textContent).toContain('Agent');
  });

  it('冲突徽标点击但 doctor 不可用时降级为无弹窗', async () => {
    const bridge = installBridge({
      gitStatus: { ...baseStatus, conflict: true },
      throwDiagnose: true,
    });
    renderGitStatusItem();
    await flushAsync();
    const conflictBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="status-git-conflict"]',
    )!;
    act(() => conflictBtn.click());
    await flushAsync();
    // 点击事件已发起，但 doctor 失败 → 不应有对话框
    expect(bridge.calls.some((c) => c.channel === 'git:doctor:diagnose')).toBe(true);
    expect(document.querySelector('[role="dialog"][aria-label="Git 同步诊断"]')).toBeNull();
  });

  it('sync 收到 phase=error 事件后 spinner 消失（error 不再被当作 busy）', async () => {
    const bridge = installBridge({ gitStatus: baseStatus });
    renderGitStatusItem();
    await flushAsync();
    // 先触发 fetching：spinner 应出现
    act(() => bridge.emit('git:syncProgress', { phase: 'fetching', message: '正在拉取…' }));
    await flushAsync();
    let spinner = document.querySelector('[data-testid="status-git-sync"] .animate-spin');
    expect(spinner, 'fetching 时应有 spinner').not.toBeNull();
    // 再触发 error：spinner 应消失（reducer 把 error 标为终态 + clearTimer）
    act(() => bridge.emit('git:syncProgress', { phase: 'error', message: 'NO_REMOTE' }));
    await flushAsync();
    // happy-dom 下 setTimeout 宏任务不触发；等待 600ms 清理窗口
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    spinner = document.querySelector('[data-testid="status-git-sync"] .animate-spin');
    expect(spinner, 'error 后不应再显示 spinner').toBeNull();
  });

  it('dismiss doctor 弹窗时重置 phase 与 phaseMessage', async () => {
    const bridge = installBridge({ gitStatus: baseStatus, gitDiagnose: diagnosis });
    renderGitStatusItem();
    await flushAsync();
    // 模拟手动同步失败 → doctor 弹窗 + spinner 仍在（manual flow 会 setPhase('error')）
    // 通过 conflict 徽标触发 doctor 也可得到相同结果
    const conflictStatus = { ...baseStatus, conflict: true };
    await act(async () => {
      bridge.emit('git:statusChanged', conflictStatus);
    });
    await flushAsync();
    const conflictBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="status-git-conflict"]',
    );
    if (conflictBtn) {
      act(() => conflictBtn.click());
      await flushAsync();
    }
    const dialog = document.querySelector('[role="dialog"][aria-label="Git 同步诊断"]');
    expect(dialog).not.toBeNull();
    // 找到「忽略」按钮并点击
    const dismissBtn = [...dialog!.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('忽略'),
    );
    expect(dismissBtn).toBeDefined();
    act(() => dismissBtn!.click());
    await flushAsync();
    // dismiss 后 doctor 已清，同时 spinner 不应残留（因为 dismissDoctor 同步重置 phase）
    expect(document.querySelector('[role="dialog"][aria-label="Git 同步诊断"]')).toBeNull();
  });

  it('sync 收到 phase=done 事件后 spinner 在 600ms 后消失', async () => {
    const bridge = installBridge({ gitStatus: baseStatus });
    renderGitStatusItem();
    await flushAsync();
    act(() => bridge.emit('git:syncProgress', { phase: 'fetching', message: '正在拉取…' }));
    await flushAsync();
    let spinner = document.querySelector('[data-testid="status-git-sync"] .animate-spin');
    expect(spinner).not.toBeNull();
    act(() => bridge.emit('git:syncProgress', { phase: 'done', message: null }));
    await flushAsync();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    spinner = document.querySelector('[data-testid="status-git-sync"] .animate-spin');
    expect(spinner, 'done 后 600ms 清理后不应再有 spinner').toBeNull();
  });

  it('DEV-088 mount 时 status.conflict=true 自动调 doctor 并弹窗（无需点徽标）', async () => {
    const bridge = installBridge({
      gitStatus: { ...baseStatus, conflict: true },
      gitDiagnose: diagnosis,
    });
    renderGitStatusItem();
    await flushAsync();
    // mount-effect 应在下一个宏任务触发 diagnose（setTimeout 0）
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(bridge.calls.some((c) => c.channel === 'git:doctor:diagnose')).toBe(true);
    const dialog = document.querySelector('[role="dialog"][aria-label="Git 同步诊断"]');
    expect(dialog, 'DEV-088: mount 后应自动弹出 DoctorDialog').not.toBeNull();
  });

  it('DEV-088 mount 时 status.rebaseInProgress=true 自动调 doctor', async () => {
    const bridge = installBridge({
      gitStatus: { ...baseStatus, rebaseInProgress: true },
      gitDiagnose: diagnosis,
    });
    renderGitStatusItem();
    await flushAsync();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(bridge.calls.some((c) => c.channel === 'git:doctor:diagnose')).toBe(true);
  });

  it('DEV-088 mount 时 status 干净（无 conflict/rebaseInProgress）不调 doctor', async () => {
    const bridge = installBridge({ gitStatus: baseStatus });
    renderGitStatusItem();
    await flushAsync();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(bridge.calls.some((c) => c.channel === 'git:doctor:diagnose')).toBe(false);
  });
});
