import type { ChannelRequest, ChannelResponse, IpcChannel, Result } from '@nexnote/shared';
import { isIpcChannel } from '@nexnote/shared';
import type { IpcServices } from './services';

/** 与 electron.ipcMain 兼容的最小接口（单测用假实现替换）。 */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

export type IpcHandler<C extends IpcChannel> = (
  payload: ChannelRequest<C>,
  services: IpcServices,
) => Promise<ChannelResponse<C>> | ChannelResponse<C>;

function toErrorResult(thrown: unknown): Result<never> {
  const error =
    thrown instanceof Error ? thrown.message : typeof thrown === 'string' ? thrown : '内部错误';
  const code =
    thrown && typeof thrown === 'object' && 'code' in thrown && typeof thrown.code === 'string'
      ? thrown.code
      : 'INTERNAL';
  return { ok: false, error, code };
}

/**
 * 类型化 IPC 注册表：
 * - 编译期：handler 签名由 shared 契约推导（request/response 强制匹配）
 * - 运行期：拒绝未在契约中声明的通道、拒绝重复注册、统一错误→Result 信封
 */
export function createIpcRegistrar(ipcMain: IpcMainLike, services: IpcServices) {
  const registered = new Set<string>();

  return {
    register<C extends IpcChannel>(channel: C, handler: IpcHandler<C>): void {
      if (typeof channel !== 'string' || !isIpcChannel(channel)) {
        throw new Error(`IPC 通道未在 shared 契约中声明: ${String(channel)}`);
      }
      if (registered.has(channel)) {
        throw new Error(`IPC 通道重复注册: ${channel}`);
      }
      registered.add(channel);
      ipcMain.handle(channel, async (_event: unknown, payload: unknown) => {
        try {
          return await handler(payload as ChannelRequest<C>, services);
        } catch (thrown) {
          return toErrorResult(thrown);
        }
      });
    },

    registeredChannels(): string[] {
      return [...registered].sort();
    },
  };
}

export type IpcRegistrar = ReturnType<typeof createIpcRegistrar>;
