import { useCallback, useEffect, useState } from 'react';
import type { PluginCommandView, PluginContributionView, PluginView } from '@nexnote/shared';
import { invoke, onEvent } from '../../lib/ipc';
import { commandRegistry, pluginContributionRegistry } from '../../registries';
import { PluginSandboxFrame } from './PluginSandboxFrame';
import type { PermissionPrompt } from './sandbox-protocol';
import { consumePluginContributions } from './contribution-consumers';

export function PluginHost() {
  const [plugins, setPlugins] = useState<PluginView[]>([]);
  const [commands, setCommands] = useState<PluginCommandView[]>([]);
  const [contributions, setContributions] = useState<PluginContributionView[]>([]);
  const [prompt, setPrompt] = useState<PermissionPrompt | null>(null);

  const refresh = useCallback(async () => {
    const [nextPlugins, nextCommands, nextContributions] = await Promise.all([
      invoke('plugins:list'),
      invoke('plugins:listCommands'),
      invoke('plugins:listContributions'),
    ]);
    setPlugins(nextPlugins);
    setCommands(nextCommands);
    setContributions(nextContributions);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh().catch((error) => console.error('[plugins] 初始化失败', error));
    return onEvent('plugins:changed', () => void refresh());
  }, [refresh]);

  useEffect(() => {
    const unregisters = contributions.map((contribution) =>
      pluginContributionRegistry.register({
        id: contribution.scopedId,
        pluginId: contribution.pluginId,
        kind: contribution.kind,
        title: contribution.title,
        keywords: contribution.keywords,
      }),
    );
    return () => unregisters.forEach((unregister) => unregister());
  }, [contributions]);

  useEffect(() => {
    const unregisters = commands.map((command) =>
      commandRegistry.register({
        id: command.id,
        title: command.title,
        category: '插件',
        keywords: command.keywords,
        run: () =>
          invoke('plugins:runCommand', {
            pluginId: command.pluginId,
            commandId: command.id,
          }).then(() => undefined),
      }),
    );
    return () => unregisters.forEach((unregister) => unregister());
  }, [commands]);

  return (
    <>
      <PluginContributionSlots contributions={contributions} />
      <div data-testid="plugin-host" className="hidden">
        {plugins
          .filter((plugin) => plugin.state === 'active')
          .map((plugin) => (
            <PluginSandboxFrame key={plugin.id} plugin={plugin} onPermissionRequired={setPrompt} />
          ))}
      </div>
      {prompt && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50"
          data-testid="plugin-permission-dialog"
        >
          <div className="w-[420px] rounded-xl border bg-popover p-4 shadow-2xl">
            <h2 className="font-semibold">插件权限请求</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              插件 <code>{prompt.pluginId}</code> 请求 <code>{prompt.permission}</code> 权限。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  prompt.decide(false, false);
                  setPrompt(null);
                }}
                className="rounded-md border px-3 py-1.5 text-xs"
              >
                拒绝
              </button>
              <button
                type="button"
                onClick={() => {
                  prompt.decide(true, false);
                  setPrompt(null);
                }}
                className="rounded-md border px-3 py-1.5 text-xs"
              >
                允许
              </button>
              <button
                type="button"
                onClick={() => {
                  prompt.decide(true, true);
                  setPrompt(null);
                }}
                className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
              >
                始终允许
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Host dispatch seam for non-command contributions. Their rendered slots vanish
 * when the active contribution list changes after plugin disable or uninstall. */
export function PluginContributionSlots({
  contributions,
}: {
  contributions: PluginContributionView[];
}) {
  const consumed = consumePluginContributions(contributions);
  return (
    <aside aria-label="插件贡献" data-testid="plugin-contribution-surfaces">
      <nav aria-label="插件菜单" data-testid="plugin-menus">
        {consumed.menuItems.map((item) => (
          <button key={item.scopedId} type="button" data-plugin-id={item.pluginId}>
            {item.title}
          </button>
        ))}
      </nav>
      <div aria-label="插件视图" data-testid="plugin-views">
        {consumed.views.map((item) => (
          <section key={item.scopedId} data-plugin-id={item.pluginId}>
            <h2>{item.title}</h2>
          </section>
        ))}
      </div>
      <div aria-label="插件块类型" data-testid="plugin-block-types">
        {consumed.blockTypes.map((item) => (
          <button key={item.scopedId} type="button" data-plugin-id={item.pluginId}>
            插入 {item.title}
          </button>
        ))}
      </div>
    </aside>
  );
}
