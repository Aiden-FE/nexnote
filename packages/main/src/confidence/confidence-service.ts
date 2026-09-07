import type { ConfidenceFactor, ConfidenceResult, GraphSnapshot } from '@nexnote/shared';
import { promises as fsp } from 'node:fs';
import * as nodePath from 'node:path';
import type { GitFileHistoryIndex, GitService } from '../git/git-service';
import type { LinkIndexService } from '../indexer/index-service';
import { readVaultConfig } from '../vault/vault-manager';
import { setFrontmatterNumber } from '../fs/page-ops';

export interface ConfidencePageInput {
  id: number;
  path: string;
  createdAt: string | null;
  confidenceBoost: number | null;
}

export interface ConfidenceComputationInput {
  pages: ConfidencePageInput[];
  graph: GraphSnapshot;
  histories: GitFileHistoryIndex;
  now?: Date;
}

export const CONFIDENCE_WEIGHTS = {
  stability: 0.25,
  review_count: 0.15,
  author_count: 0.15,
  age: 0.15,
  link_authority: 0.2,
  manual_boost: 0.1,
} as const;

const FACTOR_LABELS: Record<ConfidenceFactor['key'], string> = {
  stability: '内容稳定性',
  review_count: '修订次数',
  author_count: '作者数量',
  age: '文档年龄',
  link_authority: '链接权威度',
  manual_boost: '手动加权',
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pageAuthority(pages: ConfidencePageInput[], graph: GraphSnapshot): Map<string, number> {
  const ranks = new Map(graph.pages.map((page) => [page.path, 1 / Math.max(1, graph.pages.length)]));
  const incoming = new Map<string, string[]>();
  for (const link of graph.links) {
    const sources = incoming.get(link.target) ?? [];
    sources.push(link.source);
    incoming.set(link.target, sources);
  }
  const outgoing = new Map<string, number>();
  const outgoingTargets = new Map<string, string[]>();
  for (const link of graph.links) {
    outgoing.set(link.source, (outgoing.get(link.source) ?? 0) + 1);
    const targets = outgoingTargets.get(link.source) ?? [];
    targets.push(link.target);
    outgoingTargets.set(link.source, targets);
  }

  for (let iteration = 0; iteration < 20; iteration += 1) {
    const next = new Map(graph.pages.map((page) => [page.path, 0]));
    const pageCount = Math.max(1, graph.pages.length);
    const teleport = 0.15 / pageCount;
    const danglingMass =
      graph.pages.reduce((total, page) => total + ((outgoing.get(page.path) ?? 0) === 0 ? ranks.get(page.path) ?? 0 : 0), 0);
    const danglingShare = (0.85 * danglingMass) / pageCount;
    for (const page of graph.pages) next.set(page.path, teleport + danglingShare);
    for (const page of graph.pages) {
      const sourceCount = outgoing.get(page.path) ?? 0;
      if (sourceCount === 0) continue;
      const share = (ranks.get(page.path) ?? 0) * 0.85 / sourceCount;
      for (const target of outgoingTargets.get(page.path) ?? []) {
        next.set(target, (next.get(target) ?? 0) + share);
      }
    }
    for (const [path, rank] of next) ranks.set(path, rank);
  }

  const maxRank = Math.max(...ranks.values(), 0);
  const baseline = 1 / Math.max(1, graph.pages.length);
  const incomingCount = new Map(graph.pages.map((page) => [page.path, 0]));
  for (const link of graph.links) incomingCount.set(link.target, (incomingCount.get(link.target) ?? 0) + 1);
  return new Map([...ranks].map(([path, rank]) => {
    const rankScore = maxRank > baseline ? clamp01((rank - baseline) / (maxRank - baseline)) : 0;
    const inboundScore = clamp01((incomingCount.get(path) ?? 0) / 5);
    return [path, clamp01(0.7 * rankScore + 0.3 * inboundScore)];
  }));
}

function factor(
  key: ConfidenceFactor['key'],
  score: number,
  detail: string,
): ConfidenceFactor {
  const normalized = clamp01(score);
  const weight = CONFIDENCE_WEIGHTS[key];
  return {
    key,
    label: FACTOR_LABELS[key],
    score: Number(normalized.toFixed(4)),
    weight,
    contribution: Number((normalized * weight * 100).toFixed(2)),
    detail,
  };
}

export function computeConfidenceResults({
  pages,
  graph,
  histories,
  now = new Date(),
}: ConfidenceComputationInput): ConfidenceResult[] {
  const authority = pageAuthority(pages, graph);
  const computedAt = now.toISOString();
  return pages.map((page) => {
    const history = histories.get(page.path);
    const events = history?.events ?? [];
    let stabilityScore = 0.4;
    if (events.length > 0) {
      let weightedScore = 0;
      let weightTotal = 0;
      events.forEach((event, index) => {
        const volatility = Math.min(1, (event.additions + event.deletions) / 400);
        const decay = 0.9 ** index;
        weightedScore += (1 - volatility) * decay;
        weightTotal += decay;
      });
      stabilityScore = weightTotal === 0 ? 0 : weightedScore / weightTotal;
    }

    const reviewScore = Math.log1p(history?.commits ?? 0) / Math.log(21);
    const authorCount = history?.authors ?? 1;
    const authorScore = 0.25 + 0.75 * (Math.log2(Math.max(1, authorCount)) / Math.log2(6));
    const createdValue = Date.parse(history?.firstCommitAt ?? page.createdAt ?? '');
    const ageDays = Number.isFinite(createdValue) ? Math.max(0, (now.getTime() - createdValue) / 86_400_000) : 0;
    const ageScore = Math.log1p(ageDays) / Math.log(366);
    const linkScore = authority.get(page.path) ?? 0;
    const manualScore = page.confidenceBoost === null ? 0.5 : clamp01(page.confidenceBoost / 100);

    const factors = [
      factor('stability', stabilityScore, `${events.length} 次历史改动按近期权重聚合，改动越小越稳定`),
      factor('review_count', reviewScore, `${history?.commits ?? 0} 次提交，20 次后饱和`),
      factor('author_count', authorScore, `${authorCount} 位作者，单人保留基础分`),
      factor('age', ageScore, `文档存活 ${Math.floor(ageDays)} 天，按对数增长`),
      factor('link_authority', linkScore, '由去重入链图的简化 PageRank 归一化'),
      factor(
        'manual_boost',
        manualScore,
        page.confidenceBoost === null ? '未设置 confidence_boost，使用中性分' : `confidence_boost=${page.confidenceBoost}`,
      ),
    ];
    const score = Math.round(factors.reduce((total, item) => total + item.contribution, 0));
    return { pageId: page.id, path: page.path, score, factors, computedAt };
  });
}

/** Serial, coalescing main-process queue. Full refresh is never downgraded by an incremental path. */
export class ConfidenceService {
  private pendingFull = false;
  private pendingPaths = new Set<string>();
  private running: Promise<void> | null = null;

  constructor(
    private readonly index: LinkIndexService,
    private readonly git: GitService,
    private readonly onComputed: (paths: string[] | null) => void = () => undefined,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  refresh(paths?: string[]): Promise<void> {
    if (paths === undefined) this.pendingFull = true;
    else for (const path of paths) this.pendingPaths.add(path);
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        while (this.pendingFull || this.pendingPaths.size > 0) {
          const isFull = this.pendingFull;
          const paths = isFull ? undefined : [...this.pendingPaths];
          this.pendingFull = false;
          this.pendingPaths.clear();
          await this.compute(paths);
        }
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async compute(paths?: string[]): Promise<void> {
    try {
      const root = this.index.rootPath;
      if (!root) return;
      const graph = this.index.graph();
      let scope = paths;
      if (scope) {
        const affected = new Set(scope);
        for (const link of graph.links) if (scope.includes(link.source)) affected.add(link.target);
        scope = [...affected];
      }
      const histories = await this.git.confidenceHistory();
      if (this.index.rootPath !== root) return;
      const results = computeConfidenceResults({
        pages: this.index.confidencePages(scope),
        graph,
        histories,
      });
      this.index.replaceConfidence(results, scope);
      await this.syncFrontmatter(results, root);
      this.onComputed(scope ?? null);
    } catch (error) {
      this.onError(error);
    }
  }

  private async syncFrontmatter(results: ConfidenceResult[], root: string): Promise<void> {
    const config = await readVaultConfig(root);
    if (!config.features.confidenceFrontmatter) return;
    let changed = false;
    for (const result of results) {
      const absolute = nodePath.join(root, result.path);
      const current = await fsp.readFile(absolute, 'utf8').catch(() => null);
      if (current === null) continue;
      const updated = setFrontmatterNumber(current, 'confidence', result.score);
      if (updated === null) continue;
      await fsp.writeFile(absolute, updated, 'utf8');
      changed = true;
    }
    if (changed) this.git.scheduleAutoCommit('同步置信度到 frontmatter', 0);
  }
}
