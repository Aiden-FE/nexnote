import { Settings as SettingsIcon, Sparkles, Folder, Keyboard } from 'lucide-react';
import { settingsSectionRegistry } from '../../registries';

/**
 * 设置占位分区（DEV-016 完整设置系统前的最小可视结构）。
 * 模式同其他 registry：注册表 = 接入面；后续票直接 add 真实分区，不动 Sidebar。
 */

settingsSectionRegistry.register({
  id: 'general',
  title: '常规',
  icon: SettingsIcon,
  order: 10,
  render: () => <GeneralSection />,
});

settingsSectionRegistry.register({
  id: 'appearance',
  title: '外观',
  icon: Sparkles,
  order: 20,
  render: () => <AppearanceSection />,
});

settingsSectionRegistry.register({
  id: 'vault',
  title: '知识库',
  icon: Folder,
  order: 30,
  render: () => <VaultSection />,
});

settingsSectionRegistry.register({
  id: 'shortcuts',
  title: '快捷键',
  icon: Keyboard,
  order: 40,
  render: () => <ShortcutsSection />,
});

function GeneralSection() {
  return (
    <div className="space-y-2 text-sm">
      <h3 className="text-base font-medium">常规</h3>
      <p className="text-muted-foreground">语言、启动、托盘等基础行为（完整面板在 DEV-016）。</p>
      <ul className="ml-4 list-disc text-muted-foreground">
        <li>语言：跟随系统（占位）</li>
        <li>启动时恢复上次知识库：是</li>
        <li>后台保留窗口：不</li>
      </ul>
    </div>
  );
}

function AppearanceSection() {
  return (
    <div className="space-y-2 text-sm">
      <h3 className="text-base font-medium">外观</h3>
      <p className="text-muted-foreground">
        主题、字体、间距。主题切换在 ⌘K 命令面板「切换亮/暗主题」。
      </p>
    </div>
  );
}

function VaultSection() {
  return (
    <div className="space-y-2 text-sm">
      <h3 className="text-base font-medium">知识库</h3>
      <p className="text-muted-foreground">
        最近打开列表、默认 vault 路径、Git 凭证（DEV-007/014 接入）。
      </p>
    </div>
  );
}

function ShortcutsSection() {
  return (
    <div className="space-y-2 text-sm">
      <h3 className="text-base font-medium">快捷键</h3>
      <p className="text-muted-foreground">键位自定义与冲突检测在 DEV-017 接入。</p>
      <ul className="ml-4 list-disc text-muted-foreground">
        <li>⌘K · 命令面板</li>
        <li>⌘T · 新建标签页（占位）</li>
        <li>⌘/ · 切换侧栏折叠</li>
      </ul>
    </div>
  );
}
