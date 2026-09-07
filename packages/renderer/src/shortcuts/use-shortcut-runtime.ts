import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settings-store';
import { shortcutRuntime } from './shortcut-runtime';
import { DEFAULT_SHORTCUTS } from '@nexnote/shared';
import { commandRegistry, type CommandDef } from '../registries';

/**
 * 全局快捷键运行时：从设置加载用户覆盖，合并默认绑定，
 * 并将所有已注册命令连接到 shortcutRuntime。
 *
 * 在 App 层挂载一次即可。
 */
export function useShortcutRuntime(): void {
  const global = useSettingsStore((s) => s.global);

  useEffect(() => {
    const overrides = global?.shortcuts ?? [];
    shortcutRuntime.setOverrides(overrides, DEFAULT_SHORTCUTS);

    // 同步已有命令
    const syncAll = () => {
      for (const cmd of commandRegistry.all() as CommandDef[]) {
        if (cmd.run) {
          shortcutRuntime.registerCommand(cmd.id, cmd.run);
        }
      }
    };
    syncAll();

    // 监听注册表变化，动态注册新命令
    const unsub = commandRegistry.subscribe(() => {
      syncAll();
    });

    shortcutRuntime.attach(window);
    return () => {
      shortcutRuntime.detach();
      unsub();
    };
  }, [global?.shortcuts]);
}
