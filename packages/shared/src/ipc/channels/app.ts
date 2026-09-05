import type { Result } from '../result';

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
  electronVersion: string;
}

export type UpdateCheckStatus =
  | 'up-to-date'
  | 'available'
  | 'not-configured'
  | 'checking'
  | 'error';

export interface UpdateCheckResult {
  status: UpdateCheckStatus;
  message?: string;
}

export const APP_CHANNELS = ['app:getInfo', 'app:checkForUpdates'] as const;

export type AppChannel = (typeof APP_CHANNELS)[number];

export interface AppChannelMap {
  'app:getInfo': { request: void; response: Result<AppInfo> };
  'app:checkForUpdates': { request: void; response: Result<UpdateCheckResult> };
}
