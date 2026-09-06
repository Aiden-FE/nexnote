import type { Result } from '../result';

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
  electronVersion: string;
}

export type UpdateChannel = 'stable' | 'beta' | 'alpha';
export type UpdateCheckStatus = 'up-to-date' | 'available' | 'not-configured' | 'checking' | 'downloading' | 'downloaded' | 'error';

export interface UpdateCheckResult {
  status: UpdateCheckStatus;
  message?: string;
  version?: string;
  channel?: UpdateChannel;
}

export const APP_CHANNELS = [
  'app:getInfo',
  'app:checkForUpdates',
  'app:downloadUpdate',
  'app:installUpdate',
  'app:setUpdateChannel',
] as const;

export type AppChannel = (typeof APP_CHANNELS)[number];

export interface AppChannelMap {
  'app:getInfo': { request: void; response: Result<AppInfo> };
  'app:checkForUpdates': { request: void; response: Result<UpdateCheckResult> };
  'app:downloadUpdate': { request: void; response: Result<UpdateCheckResult> };
  'app:installUpdate': { request: void; response: Result<{ willRestart: true }> };
  'app:setUpdateChannel': { request: { channel: UpdateChannel }; response: Result<UpdateCheckResult> };
}
