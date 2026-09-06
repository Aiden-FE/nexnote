import { useEffect } from 'react';
import { invoke } from '../lib/ipc';
import { useUiStore } from '../stores/ui-store';
import { useTabStore } from '../stores/tab-store';
import type { VaultInfo, VaultLayout } from '@nexnote/shared';
import { defaultVaultLayout } from '@nexnote/shared';

/**
 * vault 布局持久化：
 * - vault 打开时从 .nexnote/config.json 恢复侧栏/dock/分屏状态
 * - 任意相关 store 变化后防抖写回（vault:saveLayout）
 */
export function useVaultLayoutPersistence(vault: VaultInfo | null): void {
  useEffect(() => {
    if (!vault) return;
    let cancelled = false;
    void (async () => {
      let layout: VaultLayout | null = null;
      try {
        layout = await invoke('vault:getLayout');
      } catch {
        /* 读取失败用默认值 */
      }
      if (cancelled) return;
      const merged = { ...defaultVaultLayout(), ...layout };
      const ui = useUiStore.getState();
      ui.setSidebarWidth(merged.sidebarWidth);
      ui.setSidebarCollapsed(merged.sidebarCollapsed);
      if (merged.activeSidebarPanelId) ui.setActiveSidebarPanel(merged.activeSidebarPanelId);
      ui.setDockVisible(merged.dockVisible);
      ui.setDockWidth(merged.dockWidth);
      ui.setTreeCollapsedDirs(merged.treeCollapsedDirs ?? []);
      ui.setTreeShowAllFiles(merged.treeShowAllFiles ?? false);
      const tabs = useTabStore.getState();
      tabs.toggleSplit(merged.splitEnabled);
      tabs.setSplitRatio(merged.splitRatio);
    })();
    return () => {
      cancelled = true;
    };
    // 依赖 vault.root 而非 vault 对象身份（避免事件刷新引发的重复水合）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.root]);

  useEffect(() => {
    if (!vault) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const collect = (): VaultLayout => {
      const ui = useUiStore.getState();
      const tabs = useTabStore.getState();
      return {
        sidebarWidth: ui.sidebarWidth,
        sidebarCollapsed: ui.sidebarCollapsed,
        activeSidebarPanelId: ui.activeSidebarPanelId,
        dockVisible: ui.dockVisible,
        dockWidth: ui.dockWidth,
        splitEnabled: tabs.splitEnabled,
        splitRatio: tabs.splitRatio,
        treeCollapsedDirs: ui.treeCollapsedDirs,
        treeShowAllFiles: ui.treeShowAllFiles,
      };
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void invoke('vault:saveLayout', { layout: collect() }).catch(() => {
          /* 保存失败不致命 */
        });
      }, 600);
    };
    const unsubs = [useUiStore.subscribe(schedule), useTabStore.subscribe(schedule)];
    return () => {
      unsubs.forEach((u) => u());
      if (timer) clearTimeout(timer);
    };
  }, [vault]);
}
