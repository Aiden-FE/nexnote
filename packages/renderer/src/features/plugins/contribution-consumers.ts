import type { PluginContributionView } from '@nexnote/shared';

export interface PluginContributionConsumers {
  menuItems: PluginContributionView[];
  views: PluginContributionView[];
  blockTypes: PluginContributionView[];
}

/** Routes active declarations to the concrete host surfaces that render/dispatch them. */
export function consumePluginContributions(
  contributions: PluginContributionView[],
): PluginContributionConsumers {
  return {
    menuItems: contributions.filter((item) => item.kind === 'menus'),
    views: contributions.filter((item) => item.kind === 'views'),
    blockTypes: contributions.filter((item) => item.kind === 'blockTypes'),
  };
}
