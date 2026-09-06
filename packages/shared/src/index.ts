// 类型
export type * from './types/vault';
export type * from './types/ai';
export type * from './types/index';
export * from './markdown/wikilink';
export * from './markdown/links';
// IPC
export type * from './ipc/result';
export type * from './ipc/contract';
export type * from './ipc/events';
export type * from './ipc/channels/app';
export type * from './ipc/channels/vault';
export type * from './ipc/channels/fs';
export type * from './ipc/channels/editor';
export type * from './ipc/channels/git';
export type * from './ipc/channels/ai';
export type * from './ipc/channels/plugins';
export type * from './ipc/channels/index';
// 运行时值
export {
  ok,
  err,
  unwrap,
  IPC_CHANNELS,
  isIpcChannel,
  IPC_EVENT_CHANNELS,
  isIpcEventChannel,
  defaultVaultConfig,
  defaultVaultLayout,
  sanitizeEntryName,
} from './ipc/reexports';
