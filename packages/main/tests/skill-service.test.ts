import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { RetrievalResponse, RetrievalSource } from '@nexnote/shared';
import { SkillService } from '../src/skills/skill-service';
import { mergeSkillResults } from '../src/skills/merge-rerank';
import type { PluginService } from '../src/plugins/plugin-service';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'nexnote-skill-test-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function source(partial: Partial<RetrievalSource> & { path: string; title: string }): RetrievalSource {
  return {
    blockId: null,
    blockType: 'p',
    snippet: '片段',
    score: 1,
    vectorSim: null,
    confidenceScore: null,
    via: 'fts',
    ...partial,
  };
}

function fakeRetrieve(canned: RetrievalSource[], degraded = false) {
  return async (): Promise<RetrievalResponse> => ({
    query: 'q',
    degraded,
    model: null,
    contextText: '',
    sources: canned,
    stages: [
      { stage: 'fts', candidates: canned.length, elapsedMs: 1, enabled: true },
    ],
  });
}

describe('mergeSkillResults', () => {
  it('normalizes per skill, dedupes across skills and reranks descending', () => {
    const a = source({ path: 'a.md', title: 'A', blockId: '^a1', score: 10 });
    const b = source({ path: 'b.md', title: 'B', blockId: '^b1', score: 2 });
    const bPrime = source({ path: 'b.md', title: 'B', blockId: '^b1', score: 99 });
    const merged = mergeSkillResults(
      [
        { skillId: 's1', sources: [a, b] },
        { skillId: 's2', sources: [bPrime] },
      ],
      10,
    );
    // b 同 path+blockId 跨 skill 去重为一条，且保留最高分；A 单 skill 命中归一化为 1。
    expect(merged).toHaveLength(2);
    expect(merged[0]!.path).toBe('b.md');
    expect(merged[0]!.score).toBe(99);
    expect(merged.map((s) => s.path).sort()).toEqual(['a.md', 'b.md']);
  });

  it('caps to topK and preserves cross-skill provenance', () => {
    const sources = Array.from({ length: 6 }, (_, i) =>
      source({ path: `p${i}.md`, title: `P${i}`, score: i }),
    );
    const merged = mergeSkillResults([{ skillId: 'builtin', sources }], 3);
    expect(merged).toHaveLength(3);
    expect(merged.every((s) => s.skillId === 'builtin')).toBe(true);
  });
});

describe('SkillService', () => {
  it('lists built-in skills with sensible defaults (retrieval on, fts off)', () => {
    const service = new SkillService({ retrieve: fakeRetrieve([]) });
    const views = service.list();
    const builtin = views.find((s) => s.id === 'builtin.retrieval');
    const fts = views.find((s) => s.id === 'builtin.retrieval-fts');
    expect(builtin?.enabled).toBe(true);
    expect(builtin?.source).toBe('builtin');
    expect(fts?.enabled).toBe(false);
  });

  it('retrieves only enabled skills, merges + annotates provenance', async () => {
    const service = new SkillService({
      retrieve: async (options) => {
        if (options.disableVector) {
          return fakeRetrieve([source({ path: 'kw.md', title: 'KW', score: 5 })] as RetrievalSource[])();
        }
        return fakeRetrieve([
          source({ path: 'shared.md', title: 'Shared', blockId: '^b', score: 8 }),
          source({ path: 'vec.md', title: 'Vec', score: 4 }),
        ] as RetrievalSource[])();
      },
    });
    service.setEnabled('builtin.retrieval-fts', true);
    const result = await service.retrieve({ query: '双链', topK: 10 });
    expect(result.usedSkillIds.sort()).toEqual(['builtin.retrieval', 'builtin.retrieval-fts']);
    const paths = result.sources.map((s) => s.path).sort();
    expect(paths).toEqual(['kw.md', 'shared.md', 'vec.md']);
    // 每个来源标注召回它的 skill。
    expect(result.sources.find((s) => s.path === 'kw.md')?.skillId).toBe('builtin.retrieval-fts');
    expect(result.contextText).toContain('Shared');
  });

  it('honors explicit skillIds selection', async () => {
    const service = new SkillService({
      retrieve: fakeRetrieve([source({ path: 'only.md', title: 'Only', score: 9 })] as RetrievalSource[]),
    });
    service.setEnabled('builtin.retrieval-fts', true);
    const result = await service.retrieve({ query: 'q', skillIds: ['builtin.retrieval-fts'] });
    expect(result.usedSkillIds).toEqual(['builtin.retrieval-fts']);
    expect(result.sources.map((s) => s.path)).toEqual(['only.md']);
  });

  it('exposes plugin-contributed skills and persists enable/order/params', async () => {
    const stateFile = join(tmp, 'skills.json');
    const plugins = {
      listPluginSkillContributions: () => [
        { id: 'com.demo.search:quick', name: 'Demo Quick Search', pluginId: 'com.demo.search', params: { topK: 3 } },
      ],
    } as unknown as PluginService;
    const service = new SkillService({
      retrieve: fakeRetrieve([source({ path: 'p.md', title: 'P', score: 3 })] as RetrievalSource[]),
      plugins,
      stateFile,
    });
    const pluginSkill = service.list().find((s) => s.id === 'com.demo.search:quick');
    expect(pluginSkill?.source).toBe('plugin');
    expect(pluginSkill?.available).toBe(true);
    expect(pluginSkill?.params.topK).toBe(3);
    service.setParams('com.demo.search:quick', { topK: 5 });
    service.setOrder(['com.demo.search:quick', 'builtin.retrieval']);

    // 重启：设置持久化。
    const restored = new SkillService({
      retrieve: fakeRetrieve([]),
      plugins,
      stateFile,
    });
    const again = restored.list().find((s) => s.id === 'com.demo.search:quick');
    expect(again?.params.topK).toBe(5);
    expect(again?.order).toBeLessThan(restored.list().find((s) => s.id === 'builtin.retrieval')!.order);
    // 持久化文件可解析。
    expect(JSON.parse(readFileSync(stateFile, 'utf8'))).toHaveProperty('settings');
  });

  it('returns empty gracefully when no skill is enabled', async () => {
    const service = new SkillService({ retrieve: fakeRetrieve([]) });
    service.setEnabled('builtin.retrieval', false);
    const result = await service.retrieve({ query: 'q' });
    expect(result.usedSkillIds).toEqual([]);
    expect(result.sources).toEqual([]);
  });
});
