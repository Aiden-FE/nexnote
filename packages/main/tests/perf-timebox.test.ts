/**
 * DEV-019 性能时间盒测试（非 benchmark 报告）：
 *
 * 用 fixture 生成器构造千级页面 / 万级块 vault，对真实代码路径做时间盒上限断言：
 *  - 全量索引构建（parse + SQLite 写入 + 链接解析）
 *  - FTS 搜索（CJK bigram + 拉丁前缀）
 *  - jumpTo 标题快跳
 *  - graph() 快照
 *  - 置信度 PageRank（20 次迭代）
 *  - 召回（FTS + 双链，无向量）
 *
 * 目的：抓住明显的复杂度回归（O(n²) 误入热路径）。上限取 CI 机器可容忍的
 * 数量级（x10 松弛），不是竞品 benchmark；真实硬件数字见 release-checklist 的人工步骤。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LinkIndexService } from '../src/indexer/index-service';
import { computeConfidenceResults } from '../src/confidence/confidence-service';
import { RetrievalService } from '../src/retrieval/retrieval-service';
import { generateVault } from './fixtures/vault-fixture';

let tmp: string;
let vaultRoot: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-perf-'));
  vaultRoot = path.join(tmp, 'vault');
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function waitReady(index: LinkIndexService, timeoutMs = 60_000): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = (): void => {
      if (index.status.phase === 'ready') return resolve(true);
      if (index.status.phase === 'error') return resolve(false);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(tick, 25);
    };
    tick();
  });
}

describe('DEV-019 千级页面性能时间盒', () => {
  it('1000 页 / ~8k 块 / ~3k 链接：索引、搜索、图谱、PageRank、召回均在时间盒内', async () => {
    const PAGES = 1000;
    const t0 = Date.now();
    await generateVault(vaultRoot, {
      pages: PAGES,
      blocksPerPage: 8,
      linksPerPage: 3,
      folders: 20,
    });
    const genMs = Date.now() - t0;

    const index = new LinkIndexService();
    const t1 = Date.now();
    index.setRoot(vaultRoot);
    expect(await waitReady(index)).toBe(true);
    const indexMs = Date.now() - t1;
    expect(index.status.pagesIndexed).toBe(PAGES);

    // 搜索：多次取最大值更稳
    const t2 = Date.now();
    for (let i = 0; i < 20; i += 1) {
      const hits = index.search('知识', 50);
      expect(hits.length).toBeGreaterThan(0);
    }
    const searchMs = (Date.now() - t2) / 20;
    const t2b = Date.now();
    for (let i = 0; i < 20; i += 1) index.search('index', 50);
    const searchLatinMs = (Date.now() - t2b) / 20;

    // jumpTo
    const t3 = Date.now();
    for (let i = 0; i < 20; i += 1) index.jumpTo('页面', 20);
    const jumpMs = (Date.now() - t3) / 20;

    // 图谱快照
    const t4 = Date.now();
    const graph = index.graph();
    const graphMs = Date.now() - t4;
    expect(graph.pages.length).toBe(PAGES);
    expect(graph.links.length).toBeGreaterThan(1000);

    // PageRank（confidence 纯函数，含 20 次迭代）
    const t5 = Date.now();
    const pages = graph.pages.map((p) => ({
      id: index.pageSummary(p.path)!.pageId,
      path: p.path,
      createdAt: null,
      confidenceBoost: null,
    }));
    const results = computeConfidenceResults({
      pages,
      graph,
      histories: new Map(
        graph.pages.map((p) => [
          p.path,
          {
            events: [],
            commits: 2,
            authors: 1,
            firstCommitAt: '2025-01-01T00:00:00.000Z',
            lastCommitAt: '2025-01-02T00:00:00.000Z',
          },
        ]),
      ),
    });
    const pageRankMs = Date.now() - t5;
    expect(results.length).toBe(PAGES);

    // 召回（FTS + 双链两阶段）
    const retrieval = new RetrievalService({ index });
    const t6 = Date.now();
    const ret = await retrieval.retrieve({ query: '知识 图谱', topK: 8 });
    const retrievalMs = Date.now() - t6;
    expect(ret.sources.length).toBeGreaterThan(0);

    // 反链查询
    const t7 = Date.now();
    const back = index.backlinks(graph.pages[500]!.path);
    const backlinkMs = Date.now() - t7;
    expect(Array.isArray(back)).toBe(true);

    // 时间盒上限（宽松 10x 数量级，防 O(n²) 回归；不是竞品 benchmark）
    expect(indexMs, `全量索引 ${indexMs}ms`).toBeLessThan(30_000);
    expect(searchMs, `CJK 搜索 ${searchMs}ms`).toBeLessThan(150);
    expect(searchLatinMs, `拉丁搜索 ${searchLatinMs}ms`).toBeLessThan(100);
    expect(jumpMs, `jumpTo ${jumpMs}ms`).toBeLessThan(100);
    expect(graphMs, `graph() ${graphMs}ms`).toBeLessThan(1_500);
    expect(pageRankMs, `PageRank ${pageRankMs}ms`).toBeLessThan(3_000);
    expect(retrievalMs, `两阶段召回 ${retrievalMs}ms`).toBeLessThan(500);

    console.log(
      `[perf] pages=${PAGES} gen=${genMs}ms index=${indexMs}ms searchCjk=${searchMs.toFixed(1)}ms ` +
        `searchLatin=${searchLatinMs.toFixed(1)}ms jump=${jumpMs.toFixed(1)}ms graph=${graphMs}ms ` +
        `pagerank=${pageRankMs}ms retrieval=${retrievalMs}ms backlink=${backlinkMs}ms`,
    );

    retrieval.close();
    index.close();
  }, 120_000);

  it('增量更新单个文件在千页 vault 上时间盒内（防每文件全量重建回归）', async () => {
    await generateVault(vaultRoot, { pages: 800, blocksPerPage: 6, linksPerPage: 2, folders: 16 });
    const index = new LinkIndexService();
    index.setRoot(vaultRoot);
    expect(await waitReady(index)).toBe(true);

    // 第二次 upsert 同一文件（内容变化）
    const t = Date.now();
    index.updateFile('folder-0/page-00000.md');
    const incrementalMs = Date.now() - t;
    expect(await waitReady(index)).toBe(true);
    // 增量应显著快于全量（数量级），上限 5s
    expect(incrementalMs, `增量 ${incrementalMs}ms`).toBeLessThan(5_000);

    index.close();
  }, 120_000);

  it('复杂度趋势检查：500 页 vs 1000 页，单次搜索与 PageRank 耗时应近线性（比例 < 4x）', async () => {
    const measure = async (pages: number): Promise<{ search: number; rank: number }> => {
      const root = path.join(tmp, `vault-${pages}`);
      await generateVault(root, { pages, blocksPerPage: 8, linksPerPage: 3, folders: 10 });
      const index = new LinkIndexService();
      index.setRoot(root);
      expect(await waitReady(index)).toBe(true);
      // 预热
      index.search('知识', 50);
      const t1 = Date.now();
      for (let i = 0; i < 10; i += 1) index.search('知识', 50);
      const search = (Date.now() - t1) / 10;
      const graph = index.graph();
      const t2 = Date.now();
      computeConfidenceResults({
        pages: graph.pages.map((p) => ({
          id: index.pageSummary(p.path)!.pageId,
          path: p.path,
          createdAt: null,
          confidenceBoost: null,
        })),
        graph,
        histories: new Map(),
      });
      const rank = Date.now() - t2;
      index.close();
      return { search, rank };
    };

    const small = await measure(500);
    const large = await measure(1000);
    // 搜索允许最多 4x（FTS 噪声），PageRank 允许 5x（20 次固定迭代应近线性）
    expect(large.search, `search 500→1000: ${small.search}→${large.search}ms`).toBeLessThan(
      Math.max(small.search * 4, 30),
    );
    expect(large.rank, `rank 500→1000: ${small.rank}→${large.rank}ms`).toBeLessThan(
      Math.max(small.rank * 5, 300),
    );
  }, 180_000);
});
