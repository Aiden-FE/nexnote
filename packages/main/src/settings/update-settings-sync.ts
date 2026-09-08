import type { UpdateSettings, UpdateSettingsPatch } from '@nexnote/shared';
import type { SettingsService } from './settings-service';
import type { AppStore } from '../vault/app-store';
import { getUpdateSettings, setUpdateSettings } from '../updater';

/**
 * 从 SettingsService 提取 updater 相关字段（单一权威）。
 */
export function extractUpdateSettings(settings: SettingsService): UpdateSettings {
  const u = settings.get().updates;
  return {
    channel: u.channel,
    autoDownload: u.autoDownload,
    checkOnLaunch: u.checkOnLaunch,
  };
}

/**
 * 将 updater 设置 diff-apply 到运行时 updater 模块 + AppStore 镜像。
 * - 与当前 updater 运行态比较，仅应用变更，避免冗余 status emit。
 * - AppStore 仅作为旧字段兼容镜像，不做回读权威。
 *
 * 此函数幂等：用相同值重复调用不会触发冗余事件。
 */
export function applyUpdateSettings(next: UpdateSettings, appStore: AppStore): void {
  const current = getUpdateSettings();
  const patch: UpdateSettingsPatch = {};
  if (current.channel !== next.channel) patch.channel = next.channel;
  if (current.autoDownload !== next.autoDownload) patch.autoDownload = next.autoDownload;
  if (current.checkOnLaunch !== next.checkOnLaunch) patch.checkOnLaunch = next.checkOnLaunch;
  if (
    patch.channel !== undefined ||
    patch.autoDownload !== undefined ||
    patch.checkOnLaunch !== undefined
  ) {
    setUpdateSettings(patch);
  }
  // AppStore 镜像：保持旧字段一致，防止遗留代码读出过时值。
  if (appStore.get().updateChannel !== next.channel) {
    appStore.setUpdateChannel(next.channel);
  }
  if (appStore.getUpdateAutoDownload() !== next.autoDownload) {
    appStore.setUpdateAutoDownload(next.autoDownload);
  }
  if (appStore.getUpdateCheckOnLaunch() !== next.checkOnLaunch) {
    appStore.setUpdateCheckOnLaunch(next.checkOnLaunch);
  }
}

/**
 * 建立 SettingsService -> updater/AppStore 同步：启动时初始化 + onChange 持续同步。
 * 返回 unsubscriber（用于测试或热重载）。
 */
export function syncUpdaterSettings(
  settings: SettingsService,
  appStore: AppStore,
): () => void {
  // 启动时先对齐一次（确保 updater 状态与 SettingsService 一致）。
  applyUpdateSettings(extractUpdateSettings(settings), appStore);
  return settings.onChange((global) => {
    applyUpdateSettings(
      { channel: global.updates.channel, autoDownload: global.updates.autoDownload, checkOnLaunch: global.updates.checkOnLaunch },
      appStore,
    );
  });
}
