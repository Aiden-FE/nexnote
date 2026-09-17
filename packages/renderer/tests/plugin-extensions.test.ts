import { describe, expect, it } from 'vitest';
import type { PluginCommandView, PluginContributionView } from '@nexnote/shared';
import {
  buildPluginBlockCommands,
  buildPluginBlockCommands as blocks,
  buildPluginCommandDefs,
  buildPluginCommandSlashItems,
  buildPluginMenuItems,
  buildPluginViewPanels,
  PLUGIN_CMD_SLASH_PREFIX,
  PLUGIN_MENU_ACTION_PREFIX,
} from '../src/features/plugins/extension-points';

const contributions: PluginContributionView[] = [
  {
    id: 'hello',
    scopedId: 'com.demo:hello',
    pluginId: 'com.demo',
    kind: 'commands',
    title: 'Hello',
  },
  { id: 'tools', scopedId: 'com.demo:tools', pluginId: 'com.demo', kind: 'menus', title: 'Tools' },
  {
    id: 'panel',
    scopedId: 'com.demo:panel',
    pluginId: 'com.demo',
    kind: 'views',
    title: 'Panel',
    placement: 'sidebar',
  },
  {
    id: 'card',
    scopedId: 'com.demo:card',
    pluginId: 'com.demo',
    kind: 'blockTypes',
    title: 'Card',
    blockType: 'card',
  },
  {
    id: 'mainview',
    scopedId: 'com.demo:mainview',
    pluginId: 'com.demo',
    kind: 'views',
    title: 'Main',
    placement: 'main',
  },
];

describe('插件扩展点宿主派生（DEV-014）', () => {
  it('菜单项进入「插件」右键子菜单并带 scopedId 动作', () => {
    const items = buildPluginMenuItems(contributions);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('插件');
    expect(items[0]!.submenu?.[0]).toMatchObject({
      id: `${PLUGIN_MENU_ACTION_PREFIX}com.demo:tools`,
      title: 'Tools',
    });
    expect(buildPluginMenuItems([])).toEqual([]);
  });

  it('块类型贡献派生插入块命令（pluginId + blockType）', () => {
    const defs = buildPluginBlockCommands(contributions);
    expect(defs).toEqual([
      {
        id: 'plugin-block:com.demo:card',
        title: '插入插件块：Card',
        keywords: expect.arrayContaining(['插件', 'plugin', 'block']),
        pluginId: 'com.demo',
        blockType: 'card',
      },
    ]);
    void blocks;
  });

  it('命令贡献 + 运行时命令合并去重（同 id 一条）', () => {
    const runtime: PluginCommandView[] = [
      { id: 'com.demo:hello', pluginId: 'com.demo', title: 'Hello Runtime' },
      { id: 'com.demo:runtime-cmd', pluginId: 'com.demo', title: 'Runtime Cmd' },
    ];
    const defs = buildPluginCommandDefs(contributions, runtime);
    expect(defs.map((d) => d.id).sort()).toEqual(['com.demo:hello', 'com.demo:runtime-cmd']);
    // 运行时标题优先（合并去重后保留）。
    expect(defs.find((d) => d.id === 'com.demo:hello')?.title).toBe('Hello Runtime');
  });

  it('斜杠菜单插件命令项：manifest + 运行时合并去重，id 带 plugin-cmd 前缀，action 派发 run', async () => {
    const runtime: PluginCommandView[] = [
      { id: 'com.demo:hello', pluginId: 'com.demo', title: 'Hello Runtime' },
      { id: 'com.demo:runtime-cmd', pluginId: 'com.demo', title: 'Runtime Cmd' },
    ];
    const runCalls: Array<{ pluginId: string; commandId: string }> = [];
    const items = buildPluginCommandSlashItems(contributions, runtime, async (def) => {
      runCalls.push(def);
      return true;
    });
    expect(items.length).toBeGreaterThanOrEqual(2);
    const ids = items.map((i) => i.id);
    expect(ids.every((id) => id.startsWith(PLUGIN_CMD_SLASH_PREFIX))).toBe(true);
    expect(ids).toContain(`${PLUGIN_CMD_SLASH_PREFIX}com.demo:hello`);
    expect(ids).toContain(`${PLUGIN_CMD_SLASH_PREFIX}com.demo:runtime-cmd`);
    // 运行时优先级（同 id 去重保留 runtime 的标题）
    const hello = items.find((i) => i.id === `${PLUGIN_CMD_SLASH_PREFIX}com.demo:hello`);
    expect(hello?.title).toBe('Hello Runtime');
    expect(hello?.group).toBe('插件');
    await expect(hello?.action({ view: {} as never } as never)).resolves.toBe(true);
    expect(runCalls).toEqual([{ pluginId: 'com.demo', commandId: 'hello' }]);
  });

  it('视图贡献只把 sidebar 放置派生为侧栏面板', () => {
    const panels = buildPluginViewPanels(contributions);
    expect(panels).toEqual([
      { id: 'plugin-view:com.demo:panel', title: 'Panel', pluginId: 'com.demo', viewId: 'panel' },
    ]);
  });
});
