import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EmbedResult } from '@nexnote/shared';
import { LinkIndexService } from '../src/indexer/index-service';
import { RetrievalService, type Embedder } from '../src/retrieval/retrieval-service';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-retrieval-test-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function page(rel: string, body: string): Promise<void> {
  const abs = path.join(tmp, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body, 'utf8');
}

const DIM = 64;
function hashIndex(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i += 1) h = Math.imul(h ^ token.charCodeAt(i), 16777619) >>> 0;
  return h % DIM;
}
function embedText(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (const token of text.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []) {
    v[hashIndex(token)] = (v[hashIndex(token)] ?? 0) + 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}
function bagOfWordsEmbedder(model = 'fake-1'): { embedder: Embedder; model: string } {
  return {
    model,
    embedder: {
      async embedWithMetadata(texts: string[]): Promise<EmbedResult> {
        return { vectors: texts.map(embedText), dimensions: DIM, model, profileId: 'fake' };
      },
    },
  };
}

async function freshVault(): Promise<LinkIndexService> {
  const index = new LinkIndexService();
  index.setRoot(tmp);
  expect(index.status.phase).toBe('ready');
  return index;
}

describe('RetrievalService 向量索引', () => {
  it('全量构建向量索引并记录模型指纹', async () => {
    await page('a.md', '# 咖啡知识\n\n咖啡 是一种 饮品，咖啡 风味 醇厚。');
    await page('b.md', '# 茶知识\n\n茶 也是 饮品。');
    const index = await freshVault();
    const { embedder } = bagOfWordsEmbedder();
    const retrieval = new RetrievalService({ index, embedder });
    await retrieval.buildAll();
    const cov = index.vectorCoverage();
    expect(cov.blocks).toBeGreaterThan(0);
    expect(cov.pages).toBe(2);
    expect(cov.model).toBe('fake-1');
    index.close();
  });

  it('增量更新：新增页后重嵌，删除页清理向量', async () => {
    await page('a.md', '# 咖啡\n\n咖啡 风味');
    const index = await freshVault();
    const { embedder } = bagOfWordsEmbedder();
    const retrieval = new RetrievalService({ index, embedder });
    await retrieval.buildAll();
    const before = index.vectorCoverage().blocks;

    await page('c.md', '# 新增页\n\n新增 的 内容 咖啡');
    index.updateFile('c.md');
    await retrieval.updatePages(['c.md']);
    const after = index.vectorCoverage();
    expect(after.blocks).toBeGreaterThan(before);
    expect(after.pages).toBe(2);
    index.close();
  });

  it('embedding 模型指纹变更触发全量重建', async () => {
    await page('a.md', '# 咖啡\n\n咖啡 风味');
    const index = await freshVault();
    let model = 'fake-1';
    const embedder: Embedder = {
      async embedWithMetadata(texts) {
        return { vectors: texts.map(embedText), dimensions: DIM, model, profileId: 'fake' };
      },
    };
    const retrieval = new RetrievalService({ index, embedder });
    await retrieval.buildAll();
    expect(index.vectorCoverage().model).toBe('fake-1');
    model = 'fake-2';
    await retrieval.updatePages(['a.md']);
    expect(index.vectorCoverage().model).toBe('fake-2');
    index.close();
  });
});

describe('RetrievalService 三阶段召回', () => {
  it('三阶段均有命中统计，向量重排返回最相关来源', async () => {
    await page('coffee.md', '# 咖啡\n\n咖啡 萃取 浓缩 风味，咖啡 是 饮品。');
    await page('tea.md', '# 茶\n\n茶 是 饮品，也 有 风味。');
    await page('unrelated.md', '# 汽车\n\n汽车 引擎 轮胎 保养。');
    await page('neighbor.md', '# 链接页\n\n参考 [[coffee]]。');
    const index = await freshVault();
    const { embedder } = bagOfWordsEmbedder();
    const retrieval = new RetrievalService({ index, embedder });
    await retrieval.buildAll();

    const res = await retrieval.retrieve({ query: '咖啡 风味', topK: 5 });
    expect(res.degraded).toBe(false);
    expect(res.model).toBe('fake-1');
    const byName = Object.fromEntries(res.stages.map((s) => [s.stage, s]));
    expect(byName.fts!.enabled).toBe(true);
    expect(byName.fts!.candidates).toBeGreaterThan(0);
    expect(byName.links!.enabled).toBe(true);
    expect(byName.vector!.enabled).toBe(true);
    expect(res.sources.length).toBeGreaterThan(0);
    expect(res.contextText.length).toBeGreaterThan(0);
    // 最相关来源为咖啡页
    expect(res.sources[0]!.title).toBe('咖啡');
    // 双链邻居也被纳入候选
    expect(res.sources.some((s) => s.path === 'neighbor.md')).toBe(true);
    index.close();
  });

  it('embedding 不可用/抛错时降级为两阶段，仍返回 FTS 来源', async () => {
    await page('coffee.md', '# 咖啡\n\n咖啡 风味 饮品');
    const index = await freshVault();
    const throwing: Embedder = {
      async embedWithMetadata() {
        throw new Error('provider 401');
      },
    };
    const retrieval = new RetrievalService({ index, embedder: throwing });
    const res = await retrieval.retrieve({ query: '咖啡', topK: 5 });
    expect(res.degraded).toBe(true);
    expect(res.model).toBeNull();
    const vectorStage = res.stages.find((s) => s.stage === 'vector');
    expect(vectorStage?.enabled).toBe(false);
    expect(res.sources.length).toBeGreaterThan(0);
    index.close();
  });

  it('置信度乘性重排：相近相关度时高置信度排前', async () => {
    // 两页关键词高度重叠（向量相似度接近），靠置信度区分。
    await page('x.md', '# 同义页X\n\n语义 检索 向量 索引 语义 检索 向量');
    await page('y.md', '# 同义页Y\n\n语义 检索 向量 索引 语义 检索 向量');
    const index = await freshVault();
    const { embedder } = bagOfWordsEmbedder();
    const retrieval = new RetrievalService({ index, embedder });
    await retrieval.buildAll();
    const xId = index.pageSummary('x.md')!.pageId;
    const yId = index.pageSummary('y.md')!.pageId;
    index.replaceConfidence([
      { pageId: xId, path: 'x.md', score: 95, factors: [], computedAt: new Date().toISOString() },
      { pageId: yId, path: 'y.md', score: 5, factors: [], computedAt: new Date().toISOString() },
    ]);
    const res = await retrieval.retrieve({ query: '语义 检索 向量', topK: 2, confidenceWeight: 0.95 });
    const withConf = res.sources.filter((s) => s.confidenceScore !== null);
    expect(withConf.length).toBeGreaterThan(0);
    const ordered = withConf.map((s) => s.confidenceScore as number);
    expect(ordered[0]).toBeGreaterThanOrEqual(ordered[ordered.length - 1] as number);
    expect(res.sources[0]!.title).toBe('同义页X');
    index.close();
  });

  it('千级块规模下单次召回 < 500ms', async () => {
    const files: Promise<void>[] = [];
    for (let i = 0; i < 150; i += 1) {
      const blocks = Array.from({ length: 8 }, (_v, b) => `第${b}段 笔记${i} 咖啡 风味 语义 检索 内容${i}-${b}`).join('\n\n');
      files.push(page(`note-${i}.md`, `# 笔记${i}\n\n${blocks}`));
    }
    await Promise.all(files);
    const index = await freshVault();
    const { embedder } = bagOfWordsEmbedder();
    const retrieval = new RetrievalService({ index, embedder, embedBatchSize: 128 });
    await retrieval.buildAll();
    expect(index.vectorCoverage().blocks).toBeGreaterThan(1000);
    const start = Date.now();
    const res = await retrieval.retrieve({ query: '咖啡 风味 内容12', topK: 8, ftsLimit: 30 });
    const elapsed = Date.now() - start;
    expect(res.sources.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
    index.close();
  });
});
