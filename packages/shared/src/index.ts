// 类型
export type * from './types/vault';
export type * from './types/ai';
export type * from './types/agent';
export type * from './types/index';
export type * from './types/retrieval';
export type * from './types/chat';
export type * from './types/plugin';
export type * from './types/skill';
export type * from './types/settings';
export type * from './types/git';

export * from './markdown/wikilink';
export * from './markdown/links';
export * from './markdown/code-languages';
export * from './editor/editor-actions';
// Settings utils（纯函数，主/渲染共用）
export { mergeGlobalPatch, mergeVaultPatch, normalizeShortcut } from './settings/settings-utils';
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
export type * from './ipc/channels/agent';
export type * from './ipc/channels/plugins';
export type * from './ipc/channels/index';
export type * from './ipc/channels/settings';
export type * from './ipc/channels/docx';
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
  defaultGlobalSettings,
  defaultVaultSettings,
  DEFAULT_SHORTCUTS,
  sanitizeEntryName,
} from './ipc/reexports';

export { TRANSLATION_MAX_TEXT_CHARS } from './types/agent';
export { PLUGIN_API_VERSION, BUILTIN_PLUGIN_IDS } from './types/plugin';
