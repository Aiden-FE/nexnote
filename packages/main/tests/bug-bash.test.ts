/**
 * DEV-019 Bug Bash：重点检查模块交界处（vault-handlers / fs-handlers / indexer / retrieval）
 * 暴露出但尚未在既有测试覆盖的缺陷。
 *
 * 该文件中的用例分两类：
 *  - Bug 复现：先标记 .todo 或失败说明根因，然后修复并改为通过；
 *  - 回归保护：修复后留下通过断言。
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LinkIndexService } from '../src/indexer/index-service';
import { RetrievalService } from '../src/retrieval/retrieval-service';
import { computeConfidenceResults } from '../src/confidence/confidence-service';

let tmp: string;
let vaultRoot: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-bug-'));
  vaultRoot = path.join(tmp, 'vault');
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function waitReady(index: LinkIndexService, timeoutMs = 5_000): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = (): void => {
      if (index.status.phase === 'ready') return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe('DEV-019 模块交界缺陷', () => {
  it('scheduleUpdate 在文件未变化（相同 hash）时不会升级为全量 onIndexed（confidence 链保护）', async () => {
    await mkdir(vaultRoot, { recursive: true });
    await writeFile(path.join(vaultRoot, 'a.md'), '# A\n\nhello\n', 'utf8');
    const indexedCalls: Array<string[] | null> = [];
    const index = new LinkIndexService(
      () => undefined,
      (paths) => {
        indexedCalls.push(paths);
      },
    );
    index.setRoot(vaultRoot);
    expect(await waitReady(index)).toBe(true);
    expect(indexedCalls).toEqual([null]); // 全量 rebuild → paths=null
    // 相同 hash 再 upsert 同一文件：upsertPage 早退（hash 相同）。
    // updateFiles 批次结束仍会发一次 incremental onIndexed(paths)（含该 path），
    // 这是已知设计：下游 confidence.refresh(相同文件) 幂等、向量 invalidate 也幂等。
    // 回归保护点：无变化批次绝不升级为 paths=null（否则会触发不必要的全量置信度重算）。
    index.updateFile('a.md');
    expect(await waitReady(index)).toBe(true);
    const last = indexedCalls[indexedCalls.length - 1];
    expect(last === null || (Array.isArray(last) && last.includes('a.md'))).toBe(true);
    expect(indexedCalls.filter((c) => c === null).length).toBe(1);
    index.close();
  });

  it('retrieval 在 fts 阶段命中为 0 时仍走完整三阶段并返回空结果而非抛错', async () => {
    await mkdir(vaultRoot, { recursive: true });
    const index = new LinkIndexService();
    index.setRoot(vaultRoot);
    expect(await waitReady(index)).toBe(true);
    const ret = new RetrievalService({ index });
    const result = await ret.retrieve({ query: '不存在的词', topK: 5 });
    expect(result.sources).toEqual([]);
    expect(result.stages.length).toBe(3);
    expect(result.contextText).toBe('');
    expect(result.degraded).toBe(true); // 无 embedder
    ret.close();
    index.close();
  });

  it('confidence 空图（0 页）不会 NaN / 抛错', async () => {
    const results = computeConfidenceResults({
      pages: [],
      graph: { pages: [], links: [] },
      histories: new Map(),
    });
    expect(results).toEqual([]);
  });

  it('confidence 单页无链接图：manual_boost=null 时 score 仍合法', async () => {
    const results = computeConfidenceResults({
      pages: [{ id: 1, path: 'a.md', createdAt: null, confidenceBoost: null }],
      graph: {
        pages: [
          { path: 'a.md', title: 'a', folder: '', tags: [], inboundLinks: 0, outboundLinks: 0 },
        ],
        links: [],
      },
      histories: new Map(),
    });
    expect(results.length).toBe(1);
    expect(results[0]!.score).toBeGreaterThanOrEqual(0);
    expect(results[0]!.score).toBeLessThanOrEqual(100);
    // link_authority 因子存在但应为 0
    const la = results[0]!.factors.find((f) => f.key === 'link_authority')!;
    expect(la.score).toBe(0);
  });

  it('obsidian 方言：wikilink 大小写不敏感匹配 basename（大小写不同也可解析）', async () => {
    await mkdir(vaultRoot, { recursive: true });
    await writeFile(path.join(vaultRoot, 'Target.md'), '# Target\n\nBody\n', 'utf8');
    await writeFile(
      path.join(vaultRoot, 'src.md'),
      '# S\n\n[[target]] 和 [[TARGET]] 和 [[tArGeT]]\n',
      'utf8',
    );
    const index = new LinkIndexService();
    index.setRoot(vaultRoot);
    expect(await waitReady(index)).toBe(true);
    const back = index.backlinks('Target.md');
    // resolveLinks 里 target_name.toLowerCase() 处理，3 个引用应全部解析
    expect(back.length).toBeGreaterThan(0);
    index.close();
  });

  it('增量更新时 watcher 触发 scheduleUpdate，文件存在 → 索引内容被更新', async () => {
    await mkdir(vaultRoot, { recursive: true });
    await writeFile(path.join(vaultRoot, 'a.md'), '# A\n\noriginal\n', 'utf8');
    const index = new LinkIndexService();
    index.setRoot(vaultRoot);
    expect(await waitReady(index)).toBe(true);
    expect(index.search('original').length).toBeGreaterThan(0);
    expect(index.search('updated').length).toBe(0);
    // 修改文件
    await writeFile(path.join(vaultRoot, 'a.md'), '# A\n\nupdated content\n', 'utf8');
    index.updateFile('a.md');
    expect(await waitReady(index)).toBe(true);
    expect(index.search('updated').length).toBeGreaterThan(0);
    expect(index.search('original').length).toBe(0);
    index.close();
  });
});
