import { create } from 'zustand';
import { useTabStore, openWorkspaceTab } from '../stores/tab-store';

/**
 * 设置页导航状态：openSettings(section) 指定初始分区（跨模块跳转，如 dock → AI 设置）。
 * activeId：null = 首分区；否则为当前分区（用户点击或跳转目标）。
 */
interface SettingsNavStore {
  activeId: string | null;
  setSection(id: string): void;
}

export const useSettingsNav = create<SettingsNavStore>((set) => ({
  activeId: null,
  setSection: (id) => set({ activeId: id }),
}));

/** 打开设置页（复用已有 tab；可指定初始分区 id）。 */
export function openSettings(sectionId?: string): void {
  useSettingsNav.setState({ activeId: sectionId ?? null });
  const st = useTabStore.getState();
  const tab = st.tabs.find((t) => t.kind === 'settings');
  if (tab) {
    st.setActiveTab(tab.id);
    return;
  }
  openWorkspaceTab('settings', '设置');
}
