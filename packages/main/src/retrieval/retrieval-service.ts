import type {
  RetrievalOptions,
  RetrievalResponse,
  RetrievalSource,
  RetrievalStageStats,
} from '@nexnote/shared';
import type { EmbedResult, RetrievalIndexStatusPayload } from '@nexnote/shared';
import type { CandidateBlock, LinkIndexService, VectorItem } from '../indexer/index-service';

/** 可替身的 embedding 提供者（AiService.embedWithMetadata 满足；测试可 fake）。 */
export interface Embedder {
  embedWithMetadata(texts: string[]): Promise<EmbedResult>;
}

export interface RetrievalServiceDeps {
  index: LinkIndexService;
  embedder?: Embedder;
  /** 后台索引进度回调（状态栏/事件）。 */
  onStatus?: (status: RetrievalIndexStatusPayload) => void;
  /** 向量分批大小。 */
  embedBatchSize?: number;
}


const TIER_BASE: Record<string, number> = { title: 4, tag: 3, alias: 2, content: 1 };
const LINK_BASE = 0.3;
const DEBOUNCE_MS = 220;

function clampSnippet(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}…`;
}

/** 余弦相似度（向量通常已归一化，未归一化则现场归一）。 */
export function cosineSim(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * 三阶段渐进式召回（DEV-011）。
 * 向量存于 index.db 的 block_vectors（JSON number[]），分代由 embedding 模型标记；
 * 阶段三在候选集（<TopN）上用精确余弦重排，规模下 <500ms，sqlite-vec ANN 可后续替换。
 */
export class RetrievalService {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private building: Promise<void> | null = null;

  constructor(private readonly deps: RetrievalServiceDeps) {}

  close(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  get status(): RetrievalIndexStatusPayload {
    const cov = this.deps.index.vectorCoverage();
    return {
      phase: this.building ? 'building' : 'ready',
      mode: 'full',
      blocksTotal: cov.blocks,
      blocksDone: cov.blocks,
      model: cov.model,
    };
  }

  /** 索引事件钩子：paths=null 全量重建；否则增量重嵌这些页（随防抖聚合）。 */
  invalidate(paths: string[] | null): void {
    const key = paths === null ? '__rebuild__' : '__update__';
    const prior = this.timers.get(key);
    if (prior) clearTimeout(prior);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void (paths === null ? this.buildAll() : this.updatePages(paths)).catch(() => undefined);
      }, DEBOUNCE_MS),
    );
    // 全量重建也挂一个防抖，取消挂起的增量。
    if (paths === null) {
      const up = this.timers.get('__update__');
      if (up) {
        clearTimeout(up);
        this.timers.delete('__update__');
      }
    }
  }

  /** 全量构建：遍历全部块，分批 embedding，逐页替换向量。 */
  async buildAll(): Promise<void> {
    if (!this.deps.embedder) return;
    if (this.building) return this.building;
    const index = this.deps.index;
    const blocks = index.allBlocks();
    this.building = (async () => {
      try {
        this.deps.onStatus?.({ phase: 'building', mode: 'full', blocksTotal: blocks.length, blocksDone: 0, model: index.vectorCoverage().model });
        const perPage = new Map<string, CandidateBlock[]>();
        for (const b of blocks) {
          const list = perPage.get(b.path) ?? [];
          list.push(b);
          perPage.set(b.path, list);
        }
        let model: string | null = null;
        let done = 0;
        for (const [path, pageBlocks] of perPage) {
          const vectors = await this.embedBlocks(pageBlocks);
          if (vectors.length > 0 && vectors[0]) model = vectors[0].model;
          index.replacePageVectors(path, vectors);
          done += pageBlocks.length;
          this.deps.onStatus?.({ phase: 'building', mode: 'full', blocksTotal: blocks.length, blocksDone: done, model });
        }
        if (model) index.setVectorMeta('embedding_model', model);
        index.setVectorMeta('embedding_generation', String(Date.now()));
        this.deps.onStatus?.({ phase: 'ready', mode: 'full', blocksTotal: blocks.length, blocksDone: blocks.length, model });
      } catch (e) {
        this.deps.onStatus?.({
          phase: 'error', mode: 'full', blocksTotal: blocks.length, blocksDone: 0,
          model: index.vectorCoverage().model, error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      } finally {
        this.building = null;
      }
    })();
    return this.building;
  }

  /** 增量重嵌：文件更新/改名后只重建受影响页；模型变更则回退全量。 */
  async updatePages(paths: string[]): Promise<void> {
    if (!this.deps.embedder) return;
    const index = this.deps.index;
    try {
      const storedModel = index.vectorCoverage().model;
      for (const path of [...new Set(paths)]) {
        const blocks = index.blocksForPaths([path]);
        if (blocks.length === 0) {
          index.replacePageVectors(path, []); // 页面删除/无块 → 清理其向量
          continue;
        }
        const vectors = await this.embedBlocks(blocks);
        if (storedModel && vectors[0] && vectors[0].model !== storedModel) {
          await this.buildAll(); // embedding 指纹变更 → 全量重建
          return;
        }
        if (vectors[0]) index.setVectorMeta('embedding_model', vectors[0].model);
        index.replacePageVectors(path, vectors);
      }
    } catch (e) {
      this.deps.onStatus?.({
        phase: 'error', mode: 'incremental', blocksTotal: 0, blocksDone: 0,
        model: index.vectorCoverage().model, error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private async embedBlocks(blocks: CandidateBlock[]): Promise<VectorItem[]> {
    const embedder = this.deps.embedder!;
    const batchSize = this.deps.embedBatchSize ?? 48;
    const out: VectorItem[] = [];
    for (let i = 0; i < blocks.length; i += batchSize) {
      const batch = blocks.slice(i, i + batchSize);
      const texts = batch.map((b) => b.content);
      const res = await embedder.embedWithMetadata(texts);
      for (let j = 0; j < batch.length; j += 1) {
        const vec = res.vectors[j];
        if (vec && vec.length === res.dimensions) {
          out.push({ blockRowid: batch[j]!.blockRowid, blockId: batch[j]!.blockId, blockType: batch[j]!.blockType, vector: vec, model: res.model });
        }
      }
    }
    return out;
  }

  /** 三阶段召回；embedding 不可用时自动降级为两阶段。 */
  async retrieve(options: RetrievalOptions): Promise<RetrievalResponse> {
    const query = options.query.trim();
    if (!query) return { query, degraded: true, model: null, contextText: '', sources: [], stages: [] };
    const index = this.deps.index;
    const stages: RetrievalStageStats[] = [];
    const pageIdByBlock = new Map<number, number>();
    const ftsLimit = options.ftsLimit ?? 20;
    const topK = options.topK ?? 8;
    const confidenceWeight = options.confidenceWeight ?? 0.3;

    // 阶段一：FTS 粗筛（页级 + tier）
    const t0 = Date.now();
    const ftsHits = index.search(query, ftsLimit);
    const stage1Paths = ftsHits.map((h) => h.path);
    const tierByPath = new Map(ftsHits.map((h) => [h.path, h.tier]));
    const stage1Blocks = index.blocksForPaths(stage1Paths);
    const scored = new Map<number, RetrievalSource>();
    for (const b of stage1Blocks) {
      const tier = tierByPath.get(b.path) ?? 'content';
      pageIdByBlock.set(b.blockRowid, b.pageId);
      scored.set(b.blockRowid, {
        path: b.path, title: b.title, blockId: b.blockId, blockType: b.blockType,
        snippet: clampSnippet(b.content), score: TIER_BASE[tier] ?? 1,
        vectorSim: null, confidenceScore: null, via: 'fts',
      });
    }
    stages.push({ stage: 'fts', candidates: stage1Blocks.length, elapsedMs: Date.now() - t0, enabled: true });

    // 阶段二：双链 1 跳邻居
    const t1 = Date.now();
    const neighborPaths = index.neighborPaths(stage1Paths);
    const neighborBlocks = index.blocksForPaths(neighborPaths).slice(0, 60);
    for (const b of neighborBlocks) {
      if (scored.has(b.blockRowid)) continue;
      pageIdByBlock.set(b.blockRowid, b.pageId);
      scored.set(b.blockRowid, {
        path: b.path, title: b.title, blockId: b.blockId, blockType: b.blockType,
        snippet: clampSnippet(b.content), score: LINK_BASE,
        vectorSim: null, confidenceScore: null, via: 'links',
      });
    }
    stages.push({ stage: 'links', candidates: neighborBlocks.length, elapsedMs: Date.now() - t1, enabled: true });

    // 阶段三：向量重排（失败/未配置 → 降级）
    const t2 = Date.now();
    let degraded = options.disableVector === true;
    let model: string | null = null;
    if (!degraded) {
      try {
        const embedder = this.deps.embedder;
        if (!embedder) {
          degraded = true;
        } else {
          const queryRes = await embedder.embedWithMetadata([query]);
          const queryVector = queryRes.vectors[0];
          const rowids = [...scored.keys()];
          const vectorMap = index.vectorsForBlockRowids(rowids);
          model = queryRes.model;
          if (!queryVector || vectorMap.size === 0) {
            degraded = true;
          } else {
            for (const [rowid, src] of scored) {
              const v = vectorMap.get(rowid);
              if (!v) continue;
              const sim = cosineSim(queryVector, v);
              src.vectorSim = Number(sim.toFixed(4));
              const pageId = pageIdByBlock.get(rowid) ?? 0;
              const conf = pageId ? index.getConfidence(pageId) : null;
              const conf01 = conf ? Math.max(0, Math.min(1, conf.score / 100)) : 1;
              src.confidenceScore = conf ? conf.score : null;
              // 文本基础分 + 向量相似度主导，再乘置信度因子（默认置信度影响 30%）
              src.score = (src.score + sim * 3) * (1 - confidenceWeight + confidenceWeight * conf01);
            }
          }
        }
      } catch (e) {
        degraded = true;
        model = null;
        stages.push({
          stage: 'vector', candidates: 0, elapsedMs: Date.now() - t2, enabled: false,
          note: e instanceof Error ? e.message : String(e),
        });
      }
    }
    if (!stages.some((s) => s.stage === 'vector')) {
      stages.push({
        stage: 'vector', candidates: scored.size, elapsedMs: Date.now() - t2,
        enabled: !degraded, note: degraded ? 'embedding 不可用，已降级为两阶段召回' : undefined,
      });
    }

    const sources = [...scored.values()].sort((a, b) => b.score - a.score).slice(0, topK);
    const contextText = this.packContext(sources, options.budgetChars ?? 4000);
    return { query, degraded, model, contextText, sources, stages };
  }

  private packContext(sources: RetrievalSource[], budgetChars: number): string {
    const parts: string[] = [];
    let used = 0;
    for (const s of sources) {
      const block = `《${s.title}》${s.blockId ? ` [^${s.blockId}]` : ''}\n${s.snippet}`;
      if (used + block.length > budgetChars) break;
      parts.push(block);
      used += block.length + 2;
    }
    return parts.join('\n\n');
  }
}
