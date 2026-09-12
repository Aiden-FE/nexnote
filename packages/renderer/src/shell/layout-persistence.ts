import { useEffect } from 'react';
import { invoke } from '../lib/ipc';
import { useUiStore } from '../stores/ui-store';
import type { VaultInfo, VaultLayout } from '@nexnote/shared';
import { defaultVaultLayout } from '@nexnote/shared';

/** vault 打开时恢复 UI 布局，变化后防抖写回；tab 与源码模式均不持久化。 */
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
      ui.setTreeShowExtensions(merged.treeShowExtensions ?? false);
      // 新手引导：vault 就绪且未完成过引导时自动弹出一次（向后兼容缺省 = 未完成）
      if (!merged.guideCompleted) {
        useUiStore.getState().setTourOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Layout state is per vault root; re-running for other VaultInfo field churn is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault?.root]);

  useEffect(() => {
    if (!vault) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const collect = (): VaultLayout => {
      const ui = useUiStore.getState();
      return {
        sidebarWidth: ui.sidebarWidth,
        sidebarCollapsed: ui.sidebarCollapsed,
        activeSidebarPanelId: ui.activeSidebarPanelId,
        dockVisible: ui.dockVisible,
        dockWidth: ui.dockWidth,
        treeCollapsedDirs: ui.treeCollapsedDirs,
        treeShowAllFiles: ui.treeShowAllFiles,
        treeShowExtensions: ui.treeShowExtensions,
        guideCompleted: ui.guideCompleted,
      };
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void invoke('vault:saveLayout', { layout: collect() }).catch(() => undefined);
      }, 600);
    };
    const unsubscribe = useUiStore.subscribe(schedule);
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [vault]);
}
