import type { AppChannelMap } from './channels/app';
import { APP_CHANNELS } from './channels/app';
import type { VaultChannelMap } from './channels/vault';
import { VAULT_CHANNELS } from './channels/vault';
import type { FsChannelMap } from './channels/fs';
import { FS_CHANNELS } from './channels/fs';
import type { EditorChannelMap } from './channels/editor';
import { EDITOR_CHANNELS } from './channels/editor';
import type { GitChannelMap } from './channels/git';
import { GIT_CHANNELS } from './channels/git';
import type { AiChannelMap } from './channels/ai';
import { AI_CHANNELS } from './channels/ai';
import type { PluginsChannelMap } from './channels/plugins';
import { PLUGINS_CHANNELS } from './channels/plugins';

/**
 * 全量 IPC 契约：主进程 handler 与渲染层 client 共用的单一事实来源。
 * 新通道的接入方式（后续 18 张票）：在对应命名空间文件中把 channel 字符串
 * 加进 CHANNELS 常量数组 + 在 ChannelMap interface 中声明 request/response 类型，
 * 主进程即会获得编译期强制实现，渲染层 client 获得类型推导。
 */
export interface IpcContract
  extends AppChannelMap,
    VaultChannelMap,
    FsChannelMap,
    EditorChannelMap,
    GitChannelMap,
    AiChannelMap,
    PluginsChannelMap {}

/** 运行时已知的全部通道名（preload 侧做白名单校验用）。 */
export const IPC_CHANNELS: readonly string[] = [
  ...APP_CHANNELS,
  ...VAULT_CHANNELS,
  ...FS_CHANNELS,
  ...EDITOR_CHANNELS,
  ...GIT_CHANNELS,
  ...AI_CHANNELS,
  ...PLUGINS_CHANNELS,
];

export type IpcChannel = keyof IpcContract & string;

export type ChannelRequest<C extends IpcChannel> = IpcContract[C]['request'];

export type ChannelResponse<C extends IpcChannel> = IpcContract[C]['response'];

export function isIpcChannel(value: string): value is IpcChannel {
  return IPC_CHANNELS.includes(value);
}
