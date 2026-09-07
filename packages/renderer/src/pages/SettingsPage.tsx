import { Settings as SettingsIcon } from 'lucide-react';
import { settingsSectionRegistry, useRegistryItems } from '../registries';
import { useSettingsNav } from '../lib/open-settings';
import { cn } from '../lib/utils';

/**
 * 设置页最小承载壳（DEV-016 完整设置系统前的结构）：
 * 左侧分区导航（registry 驱动）+ 右侧分区内容。
 * 分区本身由各功能域注册（如 DEV-009 的 AI 供应商分区），本组件不感知具体分区。
 * 跨模块跳转（openSettings('ai')）经 settingsNav store 生效，无需 effect。
 */
export function SettingsPage() {
  const sections = [...useRegistryItems(settingsSectionRegistry)].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  const activeId = useSettingsNav((s) => s.activeId);
  const active = sections.find((s) => s.id === activeId) ?? sections[0];
  const ActiveContent = active?.render;

  return (
    <div data-testid="settings-page" className="mx-auto flex h-full max-w-4xl min-w-0 flex-col px-6 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <SettingsIcon className="size-4.5" />
        设置
      </h1>
      <div className="flex min-h-0 flex-1 gap-6">
        <nav data-testid="settings-nav" className="flex w-40 shrink-0 flex-col gap-0.5">
          {sections.map((section) => {
            const Icon = section.icon;
            const isActive = active?.id === section.id;
            return (
              <button
                key={section.id}
                type="button"
                data-testid={`settings-nav-${section.id}`}
                onClick={() => useSettingsNav.getState().setSection(section.id)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm',
                  isActive
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{section.title}</span>
              </button>
            );
          })}
        </nav>
        <div
          data-testid={`settings-section-${active?.id ?? 'none'}`}
          className="min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border bg-card p-5 text-card-foreground"
        >
          {ActiveContent ? <ActiveContent /> : null}
        </div>
      </div>
    </div>
  );
}
