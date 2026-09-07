import { PanelRightClose, Sparkles } from 'lucide-react';
import { useRegistryItems, dockPanelRegistry } from '../registries';
import { useUiStore } from '../stores/ui-store';
import { Resizer } from './Resizer';
import { cn } from '../lib/utils';

/**
 * 右侧 dock：面板插槽（注册表驱动）+ 可折叠 + 宽度可调。
 * DEV-012（AI 对话）通过注册 dock 面板接入，本组件不改。
 */
export function DockHost() {
  const panels = useRegistryItems(dockPanelRegistry);
  const { dockVisible, dockWidth, activeDockPanelId, setDockWidth, toggleDock, setActiveDockPanel } =
    useUiStore();

  if (!dockVisible) return null;

  const active = panels.find((p) => p.id === activeDockPanelId) ?? panels[0];
  const ActiveContent = active?.render;

  return (
    <>
      <Resizer
        orientation="vertical"
        testId="dock-resizer"
        onDrag={(movementX) => setDockWidth(useUiStore.getState().dockWidth - movementX)}
        onDoubleClick={() => toggleDock()}
      />
      <aside
        data-testid="right-dock"
        style={{ width: dockWidth }}
        className="flex h-full shrink-0 flex-col border-l bg-card text-card-foreground"
      >
        <div className="flex h-10 items-center gap-1.5 border-b px-2.5 text-sm">
          <Sparkles className="size-3.5 text-muted-foreground" />
          <span className="font-medium">{active?.title ?? 'Dock'}</span>
          <button
            type="button"
            title="折叠 Dock"
            aria-label="折叠 Dock"
            onClick={() => toggleDock()}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <PanelRightClose className="size-4" />
          </button>
        </div>

        {/* dock 面板页签（多面板预留） */}
        {panels.length > 1 && (
          <div className="flex items-center gap-0.5 border-b px-1.5 py-1">
            {panels.map((panel) => {
              const Icon = panel.icon;
              const isActive = active?.id === panel.id;
              return (
                <button
                  key={panel.id}
                  type="button"
                  onClick={() => setActiveDockPanel(panel.id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded px-2 py-1 text-xs',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/60',
                  )}
                >
                  <Icon className="size-3.5" />
                  {panel.title}
                </button>
              );
            })}
          </div>
        )}

        <div data-testid={`dock-panel-${active?.id ?? 'empty'}`} className="min-h-0 flex-1 overflow-auto p-3 text-sm">
          {ActiveContent ? <ActiveContent /> : <p className="text-muted-foreground">暂无 Dock 面板</p>}
        </div>
      </aside>
    </>
  );
}
