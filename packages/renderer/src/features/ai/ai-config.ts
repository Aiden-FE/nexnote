import { create } from 'zustand';
import type { AiConfigState } from '@nexnote/shared';
import { invoke, onEvent } from '../../lib/ipc';

/**
 * 渲染层 AI 配置状态：
 * - state 为主进程推送的脱敏视图（无密钥）
 * - 所有写操作走 ai:* IPC，响应携带新 state 就地更新
 * - 主进程 ai:configChanged 事件兜底刷新（多窗口一致性）
 */
interface AiConfigStateStore {
  state: AiConfigState | null;
  loading: boolean;
  load(): Promise<void>;
  apply(state: AiConfigState): void;
}

export const useAiConfig = create<AiConfigStateStore>((set) => ({
  state: null,
  loading: false,

  async load() {
    set({ loading: true });
    try {
      const state = await invoke('ai:getState');
      set({ state, loading: false });
    } catch (e) {
      console.error('[ai] 读取配置失败', e);
      set({ loading: false });
    }
  },

  apply(state) {
    set({ state });
  },
}));

/** 未配置 AI（首启动引导判定）。 */
export function needsOnboarding(s: AiConfigState | null): boolean {
  return !s || s.needsOnboarding || s.profiles.length === 0;
}

let subscribed = false;
/** 模块加载时调用一次：初始拉取 + 订阅配置变化。 */
export function initAiConfig(): void {
  if (subscribed) return;
  subscribed = true;
  void useAiConfig.getState().load();
  onEvent('ai:configChanged', ({ state }) => useAiConfig.getState().apply(state));
}

// ── AI 引导向导（全局开闭状态） ─────────────────────────

interface AiWizardStore {
  open: boolean;
  /** 编辑已有 Profile（设置页入口）；null = 新建 */
  editProfileId: string | null;
  show(editProfileId?: string | null): void;
  close(): void;
}

export const useAiWizard = create<AiWizardStore>((set) => ({
  open: false,
  editProfileId: null,
  show: (editProfileId = null) => set({ open: true, editProfileId }),
  close: () => set({ open: false, editProfileId: null }),
}));

/** 统一入口降级：未配置时打开向导，已配置时执行既有动作。 */
export function aiEntryOrWizard(action: () => void): void {
  if (needsOnboarding(useAiConfig.getState().state)) {
    useAiWizard.getState().show();
  } else {
    action();
  }
}
