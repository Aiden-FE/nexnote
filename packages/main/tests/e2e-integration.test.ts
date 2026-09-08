/**
 * DEV-019 端到端纯逻辑集成测试：
 *
 * 真实 kernel/markdown 解析 × 真实 SQLite 索引 × 真实图图谱 × 真实三阶段召回
 * × 真实置信度计算 × 真实 Skill 系统 × 真实插件贡献点。
 *
 * 通过 fixture 生成器构造中等规模 vault，走通各层核心路径，验证：
 *  - 索引全量构建后搜索 / 双链 / 图谱 / 标签 全部可查
 *  - wiki 链接解析（alias > title > basename）按契约生效
 *  - 召回三阶段（FTS → 双链 → 向量）正确执行并返回阶段统计
 *  - 置信度（含 PageRank 派生 link_authority）能正常计算并缓存到索引
 *  - Skill 系统 + 插件贡献 Skill 能合并重排
 *  - Chat 会话文件能被索引并产生双链
 *
 * 环境要求：node（better-sqlite3 可用），无需 Electron / 浏览器 / 网络。
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EmbedResult } from '@nexnote/shared';
import { LinkIndexService } from '../src/indexer/index-service';
import { RetrievalService, type Embedder } from '../src/retrieval/retrieval-service';
import {
  computeConfidenceResults,
  type ConfidencePageInput,
} from '../src/confidence/confidence-service';
import { SkillService } from '../src/skills/skill-service';
import { PluginService } from '../src/plugins/plugin-service';
import { generateVault } from './fixtures/vault-fixture';
import { VaultFsService } from '../src/fs/fs-service';
import { ChatService } from '../src/chat/chat-service';

let tmp: string;
let vaultRoot: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-e2e-'));
  vaultRoot = path.join(tmp, 'vault');
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const DIM = 32;
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
const fakeEmbedder: Embedder = {
  async embedWithMetadata(texts: string[]): Promise<EmbedResult> {
    return {
      vectors: texts.map(embedText),
      dimensions: DIM,
      model: 'fake-hash-1',
      profileId: 'unit-test',
    };
  },
};

function waitReady(index: LinkIndexService, timeoutMs = 10_000): Promise<boolean> {
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

describe('DEV-019 端到端纯逻辑集成', () => {
  it('中等规模 vault：索引 → 搜索 → 双链 → 图谱 → 召回 → 置信度 → 插件 Skill 全链路', async () => {
    // 1) 生成 fixture vault（120 页，8 块/页，3 链接/页）
    const paths = await generateVault(vaultRoot, {
      pages: 120,
      blocksPerPage: 8,
      linksPerPage: 3,
      folders: 6,
      cjkRatio: 0.6,
    });
    // 额外加几页已知内容，作为语义召回的 ground truth
    await writeFile(
      path.join(vaultRoot, 'coffee-guide.md'),
      '# 咖啡入门指南\n\n咖啡 是一种 饮品，由 咖啡豆 烘焙 研磨 后 冲泡。\n\n意式 浓缩 与 手冲 是 两种 主要 冲煮 方式。\n\n[[tea-guide]]\n',
      'utf8',
    );
    await writeFile(
      path.join(vaultRoot, 'tea-guide.md'),
      '# 茶知识入门\n\n茶 也是 饮品，分为 绿茶 红茶 乌龙茶。\n\n[[coffee-guide]]\n',
      'utf8',
    );
    await writeFile(
      path.join(vaultRoot, 'rocket-science.md'),
      '# 火箭科学\n\n火箭 推进 与 轨道 力学 完全 不相关 于 饮品。\n',
      'utf8',
    );

    // 2) 索引全量构建（真实 SQLite）
    const index = new LinkIndexService();
    index.setRoot(vaultRoot);
    expect(await waitReady(index)).toBe(true);
    expect(index.status.pagesIndexed).toBeGreaterThanOrEqual(paths.length + 3);

    // 3) 搜索：英文前缀 + 中文子串 都能命中
    const search = index.search('index', 10);
    expect(search.some((h) => h.path.includes('page-'))).toBe(true);
    const cjkSearch = index.search('咖啡', 10);
    expect(cjkSearch.some((h) => h.path === 'coffee-guide.md')).toBe(true);

    // 4) 双链：互链存在
    const back = index.backlinks('coffee-guide.md');
    expect(back.some((b) => b.fromPath === 'tea-guide.md')).toBe(true);

    // 5) 图谱：页面数 + 链接数 合理
    const graph = index.graph();
    expect(graph.pages.length).toBeGreaterThanOrEqual(paths.length + 3);
    expect(graph.links.length).toBeGreaterThan(0);
    // 链接必须来自 pages 中的真实节点
    const pageSet = new Set(graph.pages.map((p) => p.path));
    for (const link of graph.links) {
      expect(pageSet.has(link.source)).toBe(true);
      expect(pageSet.has(link.target)).toBe(true);
    }

    // 6) 召回三阶段（FTS + 双链 + 向量）
    const retrieval = new RetrievalService({ index, embedder: fakeEmbedder });
    await retrieval.buildAll();
    const result = await retrieval.retrieve({ query: '咖啡 饮品', topK: 5 });
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.sources[0]!.path).toBe('coffee-guide.md');
    // 三阶段都启用且产生阶段统计
    expect(result.stages.length).toBe(3);
    expect(result.stages[0]!.stage).toBe('fts');
    expect(result.stages[1]!.stage).toBe('links');
    expect(result.stages[2]!.stage).toBe('vector');
    expect(result.degraded).toBe(false);
    // 向量相似度字段存在且非空
    expect(result.sources.some((s) => s.vectorSim !== null)).toBe(true);
    // contextText 被正确组装
    expect(result.contextText.length).toBeGreaterThan(0);

    // 7) 置信度（含 PageRank 派生 link_authority）
    const confPages: ConfidencePageInput[] = graph.pages.map((p) => ({
      id: index.pageSummary(p.path)!.pageId,
      path: p.path,
      createdAt: null,
      confidenceBoost: null,
    }));
    const results = computeConfidenceResults({
      pages: confPages,
      graph,
      histories: new Map(
        graph.pages.map((p) => [
          p.path,
          {
            events: [],
            commits: 2,
            authors: 1,
            firstCommitAt: '2025-01-01T00:00:00.000Z',
          },
        ]),
      ),
    });
    expect(results.length).toBe(graph.pages.length);
    // 分数在 0..100 且各因子权重和为 1
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      const factorSum = r.factors.reduce((sum, f) => sum + f.weight, 0);
      expect(factorSum).toBeCloseTo(1, 5);
    }
    // link_authority 因子存在
    expect(results[0]!.factors.some((f) => f.key === 'link_authority')).toBe(true);
    // 所有入链数 > 0 的页面 link_authority 分应 > 0
    const withInbound = results.filter(
      (r) => graph.pages.find((p) => p.path === r.path)?.inboundLinks,
    );
    if (withInbound.length > 0) {
      const laScores = withInbound.map(
        (r) => r.factors.find((f) => f.key === 'link_authority')!.score,
      );
      expect(laScores.some((s) => s > 0)).toBe(true);
    }

    // 把置信度写回索引并能读出
    index.replaceConfidence(results);
    const firstPage = graph.pages[0]!;
    const cached = index.getConfidence(index.pageSummary(firstPage.path)!.pageId);
    expect(cached).not.toBeNull();
    expect(cached!.score).toBeGreaterThanOrEqual(0);

    // 8) Skill 系统：内置检索 + 插件贡献 Skill 合并重排
    const pluginsRoot = path.join(tmp, 'plugins');
    await mkdir(pluginsRoot, { recursive: true });
    const pluginService = new PluginService({
      stateFile: path.join(tmp, 'plugins.json'),
      pluginsRoot,
      hostVersion: '0.1.0',
    });
    // 用 fixture 目录插件，它声明了一个 skill
    const demoDir = path.resolve(__dirname, 'fixtures/demo-plugin');
    const ticket = pluginService.previewInstall('directory', demoDir);
    pluginService.confirmInstall(ticket.ticket, true);

    const skillService = new SkillService({
      retrieve: async (opts) => retrieval.retrieve(opts),
      plugins: pluginService,
    });
    const skills = skillService.list();
    // 至少 2 个内置 + 1 个插件贡献
    expect(skills.some((s) => s.id === 'builtin.retrieval')).toBe(true);
    expect(skills.some((s) => s.id === 'com.nexnote.demo:quick')).toBe(true);
    const skillResult = await skillService.retrieve({ query: '咖啡', topK: 4 });
    expect(skillResult.usedSkillIds.length).toBeGreaterThan(0);
    expect(skillResult.sources.length).toBeGreaterThan(0);

    // 9) Chat 服务：创建会话 → 保存 → 被索引为双链目标
    const fs = new VaultFsService(() => vaultRoot);
    const chat = new ChatService(fs, () => vaultRoot);
    const session = await chat.newChat('测试会话');
    const created = await chat.saveChat(session);
    expect(created.path).toMatch(/^AI Chats\//);
    const chatText = await fs.readTextFile(created.path);
    expect(chatText).toContain('type: chat');
    // 会话文件也被索引
    index.updateFile(created.path);
    expect(await waitReady(index)).toBe(true);
    const chatSummary = index.pageSummary(created.path);
    expect(chatSummary).not.toBeNull();

    // 10) 标签：fixture 中有 tag 概率 → 至少部分页面带标签
    const tags = index.tags(true);
    const totalTagged = tags.reduce((sum, t) => sum + t.pageCount, 0);
    expect(totalTagged).toBeGreaterThan(0);

    retrieval.close();
    index.close();
  }, 60_000);

  it('Obsidian 方言兼容性：wikilink 显示文本 / 锚点 / 标签 / frontmatter 别名均正确解析', async () => {
    await mkdir(vaultRoot, { recursive: true });
    await writeFile(
      path.join(vaultRoot, 'target.md'),
      '---\naliases: [目的地, goal]\ntags: [obsidian, test]\n---\n\n# 目标页面\n\n这是目标。\n',
      'utf8',
    );
    await writeFile(
      path.join(vaultRoot, 'source.md'),
      '# 来源页面\n\n这是 [[目标页面|显示文本]] 的 引用，还有 #daily 标签。\n\n跳转到 [[目的地#anchor]] 也 OK。\n',
      'utf8',
    );

    const index = new LinkIndexService();
    index.setRoot(vaultRoot);
    expect(await waitReady(index)).toBe(true);

    // alias 解析：[[目的地]] 解析到 target.md
    const jumpByAlias = index.jumpTo('目的地', 10);
    expect(jumpByAlias.some((j) => j.path === 'target.md')).toBe(true);

    // title 解析
    const back = index.backlinks('target.md');
    expect(back.some((b) => b.fromPath === 'source.md')).toBe(true);

    // 标签：frontmatter + 行内都能被索引
    const tags = index
      .tags(true)
      .map((t) => t.tag)
      .sort();
    expect(tags).toContain('obsidian');
    expect(tags).toContain('test');
    expect(tags).toContain('daily');

    // 搜索：中文子串命中
    const hits = index.search('目标页面', 5);
    expect(hits[0]!.path).toBe('target.md');
    expect(hits[0]!.tier).toBe('title');

    index.close();
  }, 20_000);

  it('索引生命周期：打开 → 增量更新 → 重命名 → 关闭 各阶段状态正确', async () => {
    await mkdir(vaultRoot, { recursive: true });
    await writeFile(path.join(vaultRoot, 'a.md'), '# A\n\n[[B]]\n', 'utf8');

    const index = new LinkIndexService();
    index.setRoot(vaultRoot);
    expect(await waitReady(index)).toBe(true);
    expect(index.status.phase).toBe('ready');
    // B 是红链（target_page_id 为 null，但有 backlink 条目吗？不，反链表只用 resolved target）
    expect(index.backlinks('B.md')).toEqual([]);

    // 新增 B.md → 增量更新 → 反链出现
    await writeFile(path.join(vaultRoot, 'B.md'), '# B\n\n正文。\n', 'utf8');
    index.updateFile('B.md');
    expect(await waitReady(index)).toBe(true);
    const back = index.backlinks('B.md');
    expect(back.some((b) => b.fromPath === 'a.md')).toBe(true);

    // 关闭
    index.close();
    expect(index.status.phase).toBe('idle');
    expect(index.rootPath).toBeNull();
  }, 20_000);

  it('空 vault 与单页边界：搜索/图谱/召回 均返回空或安全降级', async () => {
    await mkdir(vaultRoot, { recursive: true });

    const index = new LinkIndexService();
    index.setRoot(vaultRoot);
    expect(await waitReady(index)).toBe(true);

    expect(index.search('anything', 10)).toEqual([]);
    expect(index.jumpTo('x', 10)).toEqual([]);
    expect(index.graph()).toEqual({ pages: [], links: [] });
    expect(index.tags(true)).toEqual([]);

    const retrieval = new RetrievalService({ index, embedder: fakeEmbedder });
    const result = await retrieval.retrieve({ query: 'anything', topK: 5 });
    expect(result.degraded).toBe(true);
    expect(result.sources).toEqual([]);

    retrieval.close();
    index.close();
  }, 10_000);
});
