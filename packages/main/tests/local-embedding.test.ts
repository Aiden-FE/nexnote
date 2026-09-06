import { describe, expect, it } from 'vitest';
import { LocalEmbeddingAdapter } from '../src/ai/provider/local-embedding';
import { ProviderError } from '../src/ai/provider/types';

describe('LocalEmbeddingAdapter（本地 embedding runtime backend）', () => {
  const a = new LocalEmbeddingAdapter();

  it('可发现且连接测试声明仅 embedding 能力', async () => {
    expect(a.declaredCapabilities()).toEqual({
      chat: false,
      streaming: false,
      embeddings: true,
      tools: false,
    });
    expect(await a.listModels()).toEqual(['local-hash-384']);
    await expect(a.testConnection()).resolves.toMatchObject({
      reachable: true,
      models: ['local-hash-384'],
      capabilities: { embeddings: true },
    });
  });

  it('在本地返回稳定、归一化的 384 维向量', async () => {
    const first = await a.embeddings({
      model: 'local-hash-384',
      inputs: ['NexNote local embedding', '另一个文档'],
    });
    const second = await a.embeddings({
      model: 'local-hash-384',
      inputs: ['NexNote local embedding'],
    });
    expect(first.vectors).toHaveLength(2);
    expect(first.vectors[0]).toHaveLength(384);
    expect(first.vectors[0]).toEqual(second.vectors[0]);
    expect(first.vectors[0]).not.toEqual(first.vectors[1]);
    expect(Math.hypot(...first.vectors[0]!)).toBeCloseTo(1);
  });

  it('拒绝未知模型，chat 明确报告能力不支持', async () => {
    await expect(a.embeddings({ model: 'missing', inputs: ['x'] })).rejects.toMatchObject({
      code: 'MODEL_NOT_FOUND',
    });
    await expect(
      a.chatCompletion({ model: 'x', messages: [{ role: 'user', content: 'y' }] }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('chatCompletionStream 以 UNSUPPORTED_CAPABILITY error 收尾', async () => {
    const events: Array<{ type: string; message?: string; code?: string }> = [];
    const handle = a.chatCompletionStream(
      { model: 'x', messages: [{ role: 'user', content: 'y' }] },
      (event) => events.push(event),
    );
    await handle.done;
    expect(events.at(-1)?.code).toBe('UNSUPPORTED_CAPABILITY');
  });
});
