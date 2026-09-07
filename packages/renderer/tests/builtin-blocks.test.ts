// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { PluginView } from '@nexnote/shared';
import { BUILTIN_PLUGIN_IDS } from '@nexnote/shared';
import {
  buildBuiltinSlashItems,
  buildBuiltinViewExtensions,
  flagsFromActivePlugins,
} from '../src/features/plugins/builtin/builtin-extensions';

function plugin(id: string, state: PluginView['state']): PluginView {
  return {
    id,
    name: id,
    version: '1.0.0',
    state,
    permissions: ['read'],
    grants: [{ permission: 'read', granted: true, alwaysAllow: false }],
    contributionCounts: { commands: 0, menus: 0, views: 0, blockTypes: 0 },
  };
}

describe('内置插件渲染派生（DEV-015）', () => {
  it('默认（无插件数据）两个内置块均关闭', () => {
    const flags = flagsFromActivePlugins([]);
    expect(flags).toEqual({ mermaid: false, katex: false });
    expect(buildBuiltinViewExtensions(flags)).toHaveLength(0);
    expect(buildBuiltinSlashItems(flags)).toHaveLength(0);
  });

  it('激活时分别派生 NodeView 扩展与斜杠菜单项', () => {
    const flags = flagsFromActivePlugins([
      plugin(BUILTIN_PLUGIN_IDS.mermaid, 'active'),
      plugin(BUILTIN_PLUGIN_IDS.katex, 'active'),
    ]);
    expect(flags).toEqual({ mermaid: true, katex: true });

    const exts = buildBuiltinViewExtensions(flags);
    const names = exts.map((e) => e.name).sort();
    expect(names).toEqual(['mathBlock', 'mathInline', 'mermaidBlock']);

    const items = buildBuiltinSlashItems(flags);
    expect(items.map((i) => i.id).sort()).toEqual([
      'builtin:math-block',
      'builtin:math-inline',
      'builtin:mermaid',
    ]);
    expect(items.every((i) => typeof i.action === 'function')).toBe(true);
  });

  it('禁用状态不计入激活；仅启用 Mermaid 时不出现公式项', () => {
    const flags = flagsFromActivePlugins([
      plugin(BUILTIN_PLUGIN_IDS.mermaid, 'active'),
      plugin(BUILTIN_PLUGIN_IDS.katex, 'disabled'),
    ]);
    expect(flags.katex).toBe(false);
    expect(buildBuiltinSlashItems(flags).map((i) => i.id)).toEqual(['builtin:mermaid']);
    expect(buildBuiltinViewExtensions(flags).map((e) => e.name)).toEqual(['mermaidBlock']);
  });

  it('崩溃/加载中的内置插件同样不派生', () => {
    const flags = flagsFromActivePlugins([
      plugin(BUILTIN_PLUGIN_IDS.mermaid, 'crashed'),
      plugin(BUILTIN_PLUGIN_IDS.katex, 'loaded'),
    ]);
    expect(flags).toEqual({ mermaid: false, katex: false });
  });
});
