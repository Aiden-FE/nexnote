import { useEffect } from 'react';
import { invoke } from '../lib/ipc';
import { useUiStore } from '../stores/ui-store';
import { tabIdentity, useTabStore } from '../stores/tab-store';
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
      // DEV-022：会话内已有 tab（vault 切换）按稳定身份恢复拖拽顺序；tab 本身仍不持久化。
      if (merged.tabOrder?.length) useTabStore.getState().applyTabOrder(merged.tabOrder);
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
        tabOrder: useTabStore.getState().tabs.map(tabIdentity),
      };
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void invoke('vault:saveLayout', { layout: collect() }).catch(() => undefined);
      }, 600);
    };
    const unsubscribe = useUiStore.subscribe(schedule);
    // DEV-022：页签顺序变化（拖拽重排/开闭）同样防抖写回；仅激活态切换不写盘。
    let lastTabOrder = collect().tabOrder;
    const unsubscribeTabs = useTabStore.subscribe((state) => {
      const next = state.tabs.map(tabIdentity);
      const changed =
        next.length !== lastTabOrder.length || next.some((id, i) => id !== lastTabOrder[i]);
      if (!changed) return;
      lastTabOrder = next;
      schedule();
    });
    return () => {
      unsubscribe();
      unsubscribeTabs();
      if (timer) clearTimeout(timer);
    };
  }, [vault]);
}
