import { useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, Settings2, FolderGit2, LogOut } from 'lucide-react';
import { useRegistryItems, sidebarPanelRegistry } from '../registries';
import { useUiStore } from '../stores/ui-store';
import { useVault } from './vault-context';
import { invoke } from '../lib/ipc';
import { Resizer } from './Resizer';
import { cn } from '../lib/utils';

/**
 * 左侧栏：面板插槽（注册表驱动）+ 可折叠 + 宽度可调（拖拽/双击折叠）。
 * DEV-003（页面树）/ DEV-004（回链、标签）通过注册新面板接入，本组件不改。
 */
export function Sidebar() {
  const panels = useRegistryItems(sidebarPanelRegistry);
  const {
    sidebarWidth,
    sidebarCollapsed,
    activeSidebarPanelId,
    setSidebarWidth,
    toggleSidebar,
    setActiveSidebarPanel,
  } = useUiStore();
  const vault = useVault();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [useSystemGit, setUseSystemGit] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);

  const openSettings = async (): Promise<void> => {
    setSettingsOpen(true);
    setSettingsMessage(null);
    try {
      const status = await invoke('git:getStatus');
      setUseSystemGit(status.usingSystemGit);
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const active = panels.find((p) => p.id === activeSidebarPanelId) ?? panels[0];
  const ActiveContent = active?.render;

  if (sidebarCollapsed) {
    return (
      <aside
        data-testid="app-sidebar"
        data-collapsed="true"
        className="flex h-full w-11 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-2 text-sidebar-foreground"
      >
        <button
          type="button"
          title="展开侧栏"
          aria-label="展开侧栏"
          onClick={() => toggleSidebar()}
          className="rounded p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <PanelLeftOpen className="size-4" />
        </button>
        <div className="my-1 h-px w-6 bg-sidebar-border" />
        {panels.map((panel) => {
          const Icon = panel.icon;
          return (
            <button
              key={panel.id}
              type="button"
              title={panel.title}
              onClick={() => setActiveSidebarPanel(panel.id)}
              className="rounded p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            >
              <Icon className="size-4" />
            </button>
          );
        })}
      </aside>
    );
  }

  return (
    <>
      <aside
        data-testid="app-sidebar"
        data-collapsed="false"
        style={{ width: sidebarWidth }}
        className="flex h-full shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground"
      >
        {/* 头部：vault 名 + 面板切换 */}
        <div className="flex h-10 items-center gap-1.5 border-b border-sidebar-border px-2.5">
          <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium" title={vault?.root}>
            {vault?.name ?? '未打开知识库'}
          </span>
          <button
            type="button"
            title="折叠侧栏"
            aria-label="折叠侧栏"
            onClick={() => toggleSidebar()}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <PanelLeftClose className="size-4" />
          </button>
        </div>

        {/* 面板页签 */}
        <div className="flex items-center gap-0.5 border-b border-sidebar-border px-1.5 py-1">
          {panels.map((panel) => {
            const Icon = panel.icon;
            const isActive = active?.id === panel.id;
            return (
              <button
                key={panel.id}
                type="button"
                onClick={() => setActiveSidebarPanel(panel.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded px-2 py-1 text-xs',
                  isActive
                    ? 'bg-sidebar-accent text-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
                )}
              >
                <Icon className="size-3.5" />
                {panel.title}
              </button>
            );
          })}
        </div>

        {/* 面板内容插槽 */}
        <div className="min-h-0 flex-1 overflow-auto p-2.5 text-sm">
          {settingsOpen ? (
            <section data-testid="git-settings" className="space-y-3">
              <div className="flex items-center gap-2">
                <Settings2 className="size-4" />
                <h2 className="font-medium">Git 设置</h2>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="ml-auto rounded border px-2 py-0.5 text-xs hover:bg-sidebar-accent"
                >
                  完成
                </button>
              </div>
              <label className="flex items-start gap-2 rounded border p-2 text-xs">
                <input
                  type="checkbox"
                  checked={useSystemGit}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    void invoke('git:setUseSystemGit', { enabled })
                      .then(() => {
                        setUseSystemGit(enabled);
                        setSettingsMessage(
                          enabled ? '已切换至系统 Git' : '已切换至 NexNote 捆绑 Git',
                        );
                      })
                      .catch((error: unknown) =>
                        setSettingsMessage(error instanceof Error ? error.message : String(error)),
                      );
                  }}
                  className="mt-0.5"
                />
                <span>
                  <strong className="block font-medium">使用系统 Git</strong>
                  <span className="mt-1 block text-muted-foreground">
                    默认关闭；开启后使用 PATH 中的 Git。设置保存在应用 userData，重启后保持。
                  </span>
                </span>
              </label>
              {settingsMessage && (
                <p className="rounded border px-2 py-1.5 text-xs text-muted-foreground">
                  {settingsMessage}
                </p>
              )}
            </section>
          ) : ActiveContent ? (
            <ActiveContent />
          ) : (
            <p className="text-muted-foreground">暂无侧栏面板</p>
          )}
        </div>

        {/* 底部：设置占位 + 切换 vault */}
        <div className="flex items-center gap-1 border-t border-sidebar-border p-1.5">
          <button
            type="button"
            onClick={() => void openSettings()}
            title="Git 设置"
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <Settings2 className="size-3.5" />
            设置
          </button>
          <button
            type="button"
            onClick={() => void invoke('vault:close').catch(() => undefined)}
            title="关闭当前知识库，返回向导"
            className="ml-auto flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <LogOut className="size-3.5" />
            切换知识库
          </button>
        </div>
      </aside>
      <Resizer
        orientation="vertical"
        testId="sidebar-resizer"
        onDrag={(movementX) => setSidebarWidth(useUiStore.getState().sidebarWidth + movementX)}
        onDoubleClick={() => toggleSidebar()}
      />
    </>
  );
}
