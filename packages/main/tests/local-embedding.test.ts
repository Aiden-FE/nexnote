import { describe, expect, it } from 'vitest';
import { LocalEmbeddingAdapter } from '../src/ai/provider/local-embedding';
import { ProviderError } from '../src/ai/provider/types';

describe('LocalEmbeddingAdapter（本地 embedding 降级 seam）', () => {
  const a = new LocalEmbeddingAdapter();

  it('declaredCapabilities：只声明 embeddings（chat/streaming/tools 协议层不可用）', () => {
    expect(a.declaredCapabilities()).toEqual({
      chat: false,
      streaming: false,
      embeddings: true,
      tools: false,
    });
  });

  it('testConnection：reachable=false（未接入）', async () => {
    const r = await a.testConnection();
    expect(r.reachable).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.models).toEqual([]);
  });

  it('embeddings：抛 NOT_IMPLEMENTED（明确 seam 行为）', async () => {
    await expect(a.embeddings({ model: 'bge-small', inputs: ['x'] })).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
    });
  });

  it('chatCompletion：抛 NOT_IMPLEMENTED', async () => {
    await expect(
      a.chatCompletion({ model: 'x', messages: [{ role: 'user', content: 'y' }] }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('chatCompletionStream：以 error 事件收尾（统一内部事件协议）', async () => {
    const events: Array<{ type: string; message?: string; code?: string }> = [];
    const handle = a.chatCompletionStream(
      { model: 'x', messages: [{ role: 'user', content: 'y' }] },
      (e) => events.push(e),
    );
    await handle.done;
    const err = events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    expect(err?.code).toBe('NOT_IMPLEMENTED');
  });

  it('listModels：空数组（本地模型列表由适配器内部暴露，不在协议层）', async () => {
    expect(await a.listModels()).toEqual([]);
  });
});
