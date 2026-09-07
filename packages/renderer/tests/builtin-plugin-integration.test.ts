import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PLUGIN_IDS } from '@nexnote/shared';
import type { PluginContributionView } from '@nexnote/shared';
import {
  buildDispatchableBlockCommands,
  isBuiltinPlugin,
} from '../src/features/plugins/extension-points';

const here = dirname(fileURLToPath(import.meta.url));

describe('内置插件分发（DEV-015）', () => {
  const mermaidContrib: PluginContributionView = {
    id: 'mermaid',
    scopedId: `${BUILTIN_PLUGIN_IDS.mermaid}:mermaid`,
    pluginId: BUILTIN_PLUGIN_IDS.mermaid,
    kind: 'blockTypes',
    title: 'Mermaid 图表',
    blockType: 'mermaid',
  };

  it('isBuiltinPlugin 识别内置插件 ID', () => {
    expect(isBuiltinPlugin(BUILTIN_PLUGIN_IDS.mermaid)).toBe(true);
    expect(isBuiltinPlugin(BUILTIN_PLUGIN_IDS.katex)).toBe(true);
    expect(isBuiltinPlugin('com.nexnote.demo')).toBe(false);
  });

  it('通用 pluginBlock 命令派生排除内置贡献（由内核原生节点分发）', () => {
    const defs = buildDispatchableBlockCommands([
      mermaidContrib,
      { id: 'card', scopedId: 'com.demo:card', pluginId: 'com.demo', kind: 'blockTypes', title: 'Card', blockType: 'card' },
    ]);
    expect(defs.map((d) => d.pluginId)).toEqual(['com.demo']);
  });

  it('设置页隐藏内置插件卸载按钮并标注内置', () => {
    const page = readFileSync(join(here, '../src/features/plugins/PluginsSettingsPage.tsx'), 'utf8');
    expect(page).toMatch(/builtin/);
    expect(page).toContain('内置');
    // 卸载按钮仅非内置渲染。
    expect(page).toContain('!selected.builtin && (');
  });

  it('PluginHost 对内置插件不挂沙箱帧、不登记内置块命令', () => {
    const host = readFileSync(join(here, '../src/features/plugins/PluginHost.tsx'), 'utf8');
    // 无内置沙箱帧：过滤条件包含 builtin 排除。
    expect(host).toContain('!plugin.builtin');
    expect(host).toContain('buildDispatchableBlockCommands');
  });
});
