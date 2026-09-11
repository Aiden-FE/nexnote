import type { ChannelRequest, ChannelResponse, IpcChannel, Result } from '@nexnote/shared';
import { isIpcChannel } from '@nexnote/shared';
import type { IpcServices } from './services';
import { validatePayload } from './validation';
import { sanitizeRemoteText } from '../git/git-service';

/** 与 electron.ipcMain 兼容的最小接口（单测用假实现替换）。 */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

export type IpcHandler<C extends IpcChannel> = (
  payload: ChannelRequest<C>,
  services: IpcServices,
  context: IpcHandlerContext,
) => Promise<ChannelResponse<C>> | ChannelResponse<C>;

export interface IpcHandlerContext {
  senderId: number;
}

function toErrorResult(thrown: unknown): Result<never> {
  const rawError =
    thrown instanceof Error ? thrown.message : typeof thrown === 'string' ? thrown : '内部错误';
  // IPC 错误信封同样可能携带 git/provider 原始文本，统一脱敏后再返回渲染层。
  const error = sanitizeRemoteText(rawError);
  const code =
    thrown && typeof thrown === 'object' && 'code' in thrown && typeof thrown.code === 'string'
      ? thrown.code
      : 'INTERNAL';
  return { ok: false, error, code };
}

function extractSenderId(event: unknown): number {
  if (
    event &&
    typeof event === 'object' &&
    'sender' in event &&
    event.sender &&
    typeof event.sender === 'object' &&
    'id' in event.sender &&
    typeof event.sender.id === 'number'
  ) {
    return event.sender.id;
  }
  return 0;
}

/**
 * 类型化 IPC 注册表：
 * - 编译期：handler 签名由 shared 契约推导（request/response 强制匹配）
 * - 运行期：拒绝未在契约中声明的通道、拒绝重复注册、运行时 payload schema 校验、统一错误→Result 信封
 *
 * payload schema 校验在 handler 之前完成；任何 malformed 输入都会以
 * `{ ok:false, code:'IPC_PAYLOAD_INVALID', error }` 信封返回，handler 看不到污染数据。
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
      ipcMain.handle(channel, async (event: unknown, payload: unknown) => {
        const validation = validatePayload(channel, payload);
        if (validation) {
          return toErrorResult(
            Object.assign(new Error(`${channel}: ${validation.message}`), {
              code: validation.code,
            }),
          );
        }
        const senderId = extractSenderId(event);
        const context: IpcHandlerContext = { senderId };
        try {
          return await handler(payload as ChannelRequest<C>, services, context);
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
