import { describe, expect, it } from 'vitest';
import type { PluginContributionView } from '@nexnote/shared';
import { consumePluginContributions } from '../src/features/plugins/contribution-consumers';

const entries: PluginContributionView[] = [
  { id: 'm', scopedId: 'p:m', pluginId: 'p', kind: 'menus', title: 'Menu' },
  { id: 'v', scopedId: 'p:v', pluginId: 'p', kind: 'views', title: 'View' },
  { id: 'b', scopedId: 'p:b', pluginId: 'p', kind: 'blockTypes', title: 'Block' },
];

describe('plugin host contribution consumers', () => {
  it('routes menus, views and block types to their concrete surfaces and removes them', () => {
    expect(consumePluginContributions(entries)).toEqual({
      menuItems: [entries[0]],
      views: [entries[1]],
      blockTypes: [entries[2]],
    });
    expect(consumePluginContributions([])).toEqual({ menuItems: [], views: [], blockTypes: [] });
  });
});
