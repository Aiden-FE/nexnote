import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateCheckResult } from '@nexnote/shared';

type Log = (...args: unknown[]) => void;

/**
 * 自动更新骨架（DEV-018 完成真实接入）：
 * - 开发模式跳过
 * - 签名位预留：macOS 正式发布需配置 CSC_NAME 环境变量（electron-builder.yml
 *   中 identity/afterSign 已留注释），Linux 不支持 electron-updater 内置更新。
 */
export function initAutoUpdater(log: Log): void {
  if (!app.isPackaged) {
    log('[updater] 开发模式，跳过自动更新初始化');
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (...args: unknown[]) => log('[updater:info]', ...args),
    warn: (...args: unknown[]) => log('[updater:warn]', ...args),
    error: (...args: unknown[]) => log('[updater:error]', ...args),
    debug: (...args: unknown[]) => log('[updater:debug]', ...args),
  } as never;
  autoUpdater.on('error', (e) => log('[updater] error:', e?.message ?? e));
  autoUpdater.on('checking-for-update', () => log('[updater] checking for update...'));
  autoUpdater.on('update-available', (info) => log('[updater] update available:', info?.version));
  autoUpdater.on('update-not-available', () => log('[updater] up to date'));
  // DEV-018：启动延迟静默检查 + 下载/安装 UI
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (!app.isPackaged) {
    return {
      status: 'not-configured',
      message: '开发模式下更新通道未启用（发布源与签名在 DEV-018 接入）',
    };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    const remoteVersion = result?.updateInfo?.version;
    if (remoteVersion && remoteVersion !== app.getVersion()) {
      return { status: 'available', message: `新版本 ${remoteVersion}` };
    }
    return { status: 'up-to-date', message: `当前 ${app.getVersion()} 已是最新` };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
