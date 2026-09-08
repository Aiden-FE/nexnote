import { useCallback, useEffect, useState } from 'react';
import { Puzzle } from 'lucide-react';
import type { PluginCommandView, PluginContributionView, PluginView } from '@nexnote/shared';
import { invoke, onEvent } from '../../lib/ipc';
import {
  commandRegistry,
  pluginContributionRegistry,
  sidebarPanelRegistry,
} from '../../registries';
import { PluginSandboxFrame } from './PluginSandboxFrame';
import type { PermissionPrompt } from './sandbox-protocol';
import {
  buildDispatchableBlockCommands,
  buildPluginCommandDefs,
  buildPluginViewPanels,
} from './extension-points';
import { getActiveEditor } from '../../editor/active-editor';
import { usePluginStore } from './plugin-store';

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
    usePluginStore.getState().setPlugins(nextPlugins);
    usePluginStore.getState().setRuntime(nextCommands, nextContributions);
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

  // 命令扩展点：manifest 声明 + 运行时 registerCommand 合并去重 → ⌘K 面板（按「插件」分组）。
  useEffect(() => {
    const defs = buildPluginCommandDefs(contributions, commands);
    const unregisters = defs.map((def) =>
      commandRegistry.register({
        id: def.id,
        title: def.title,
        category: '插件',
        keywords: def.keywords,
        run: () =>
          invoke('plugins:runCommand', {
            pluginId: def.pluginId,
            commandId: def.commandId,
          }).then(() => undefined),
      }),
    );
    return () => unregisters.forEach((unregister) => unregister());
  }, [contributions, commands]);

  // 块类型扩展点：⌘K 插入插件块（插入后宿主 NodeView 委托给插件渲染）。
  // DEV-015：内置插件的块类型由内核原生节点 + 内置 NodeView 处理，不走通用 pluginBlock。
  useEffect(() => {
    const blocks = buildDispatchableBlockCommands(contributions);
    const unregisters = blocks.map((block) =>
      commandRegistry.register({
        id: block.id,
        title: block.title,
        category: '插件',
        keywords: block.keywords,
        run: () => {
          getActiveEditor()?.editor.commands.insertPluginBlock({
            pluginId: block.pluginId,
            blockType: block.blockType,
          });
        },
      }),
    );
    return () => unregisters.forEach((unregister) => unregister());
  }, [contributions]);

  // 视图扩展点：插件视图贡献注册为侧栏页签（可见沙箱 iframe）。
  useEffect(() => {
    const panels = buildPluginViewPanels(contributions);
    const unregisters = panels.map((panel) =>
      sidebarPanelRegistry.register({
        id: panel.id,
        title: panel.title,
        icon: Puzzle,
        render: () => {
          const plugin = plugins.find((item) => item.id === panel.pluginId);
          return plugin ? (
            <PluginSandboxFrame plugin={plugin} visible onPermissionRequired={setPrompt} />
          ) : null;
        },
      }),
    );
    return () => unregisters.forEach((unregister) => unregister());
  }, [contributions, plugins]);

  return (
    <>
      <div data-testid="plugin-host" className="hidden">
        {plugins
          // DEV-015：内置插件无沙箱源码（纯 UI，由宿主渲染），不挂沙箱帧。
          .filter((plugin) => plugin.state === 'active' && !plugin.builtin)
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
