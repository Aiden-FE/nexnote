import type {
  ChannelRequest,
  ChannelResponse,
  IpcChannel,
  IpcEventChannel,
  IpcEventMap,
} from '@nexnote/shared';

export class IpcError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'IpcError';
  }
}

/** unwrap Result<T> → T：结构匹配 Ok 分支（渲染层拿到的永远是成功数据或异常）。 */
type Unwrap<R> = R extends { ok: true; data: infer T } ? T : never;

interface NexnoteBridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  on(channel: string, callback: (payload: unknown) => void): () => void;
}

function bridge(): NexnoteBridge {
  const b = (window as { nexnote?: NexnoteBridge }).nexnote;
  if (!b) throw new IpcError('window.nexnote 不可用（preload 未加载）', 'NO_BRIDGE');
  return b;
}

/** 类型化 invoke：通道名、请求、响应全部由 shared 契约推导。 */
export async function invoke<C extends IpcChannel>(
  channel: C,
  ...args: ChannelRequest<C> extends void ? [] : [payload: ChannelRequest<C>]
): Promise<Unwrap<ChannelResponse<C>>> {
  const raw = (await bridge().invoke(channel, args[0])) as ChannelResponse<C>;
  if (!raw.ok) throw new IpcError(raw.error, raw.code);
  return raw.data as Unwrap<ChannelResponse<C>>;
}

/** 订阅主进程推送事件，返回反订阅函数。 */
export function onEvent<C extends IpcEventChannel>(
  channel: C,
  callback: (payload: IpcEventMap[C]) => void,
): () => void {
  return bridge().on(channel, callback as (payload: unknown) => void);
}
