import { Sparkles } from 'lucide-react';
import { settingsSectionRegistry } from '../../registries';
import { SkillsSettingsPage } from './SkillsSettingsPage';

/** DEV-014 检索 Skill：设置分区（order 62，紧随插件 60）。 */
settingsSectionRegistry.register({
  id: 'skills',
  title: '检索 Skill',
  icon: Sparkles,
  order: 62,
  render: SkillsSettingsPage,
});
