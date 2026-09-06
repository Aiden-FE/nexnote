import { contextBridge, ipcRenderer } from 'electron';
import { isIpcChannel, isIpcEventChannel } from '@nexnote/shared';

/**
 * 最小化 preload 桥：sandboxed、contextIsolation 下渲染层唯一的原生通道。
 * - invoke 白名单校验：只放行 shared 契约中声明的通道
 * - on 只放行事件契约中声明的推送事件，返回反订阅函数
 */
contextBridge.exposeInMainWorld('nexnote', {
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    if (!isIpcChannel(channel)) {
      return Promise.resolve({
        ok: false,
        error: `未在 IPC 契约中声明的通道: ${channel}`,
        code: 'UNKNOWN_CHANNEL',
      });
    }
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel: string, callback: (payload: unknown) => void): () => void {
    if (!isIpcEventChannel(channel)) {
      throw new Error(`未在事件契约中声明的通道: ${channel}`);
    }
    const listener = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});

// 冒烟测试专用桥（仅 NEXNOTE_SMOKE=1 时存在；内部 smoke:* 通道不进公共契约）
if (process.env.NEXNOTE_SMOKE === '1') {
  contextBridge.exposeInMainWorld('nexnoteSmoke', {
    capture: (name: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke('smoke:capture', name),
    mkdtemp: (): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke('smoke:mkdtemp'),
    writeFile: (
      root: string,
      rel: string,
      content: string,
    ): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke('smoke:writeFile', { root, rel, content }),
    seedGraph: (
      root: string,
    ): Promise<{ ok: boolean; pages?: number; links?: number; error?: string }> =>
      ipcRenderer.invoke('smoke:seedGraph', root),
    finish: (report: unknown): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('smoke:finish', report),
    // DEV-009：AI 冒烟场景用的内嵌 mock OpenAI 服务器地址
    aiMock: (): Promise<{ ok: boolean; url?: string; error?: string }> =>
      ipcRenderer.invoke('smoke:aiMock'),
  });
}
