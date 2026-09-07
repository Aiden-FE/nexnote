import { Puzzle } from 'lucide-react';
import { settingsSectionRegistry } from '../../registries';
import { PluginsSettingsPage } from './PluginsSettingsPage';

settingsSectionRegistry.register({
  id: 'plugins',
  title: '插件',
  icon: Puzzle,
  order: 60,
  render: PluginsSettingsPage,
});

export { PluginHost } from './PluginHost';
