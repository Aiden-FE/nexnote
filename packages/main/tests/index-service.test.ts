import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { LinkIndexService, } from '../src/indexer/index-service';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-index-test-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function page(rel: string, frontmatter: string, body: string): Promise<void> {
  const abs = path.join(tmp, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, frontmatter + body, 'utf8');
}

describe('LinkIndexService', () => {
  it('migrates a v3 index database to confidence schema v4', async () => {
    await page('a.md', '---\nconfidence_boost: 55\n---\n', '# A\n');
    await mkdir(path.join(tmp, '.nexnote'), { recursive: true });
    const legacy = new Database(path.join(tmp, '.nexnote', 'index.db'));
    legacy.exec(`
      PRAGMA user_version = 3;
      CREATE TABLE pages (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, title TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]', created_at TEXT, updated_at TEXT, hash TEXT NOT NULL);
      CREATE TABLE links (id INTEGER PRIMARY KEY, source_page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE, target_page_id INTEGER REFERENCES pages(id) ON DELETE SET NULL, target_raw TEXT NOT NULL, target_name TEXT NOT NULL, link_type TEXT NOT NULL DEFAULT 'wiki', anchor TEXT, source_block_id INTEGER, source_text TEXT NOT NULL DEFAULT '');
      CREATE TABLE tags (id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE, tag_name TEXT NOT NULL, tag_path TEXT NOT NULL);
      CREATE TABLE blocks (id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE, block_id TEXT, block_type TEXT NOT NULL, content_text TEXT NOT NULL, position INTEGER NOT NULL);
      CREATE VIRTUAL TABLE page_fts USING fts5(path UNINDEXED, title UNINDEXED, aliases UNINDEXED, tags UNINDEXED, content UNINDEXED, tok);
    `);
    legacy.close();

    const svc = new LinkIndexService();
    svc.setRoot(tmp);
    const summary = svc.pageSummary('a.md');
    expect(summary?.pageId).toBeGreaterThan(0);
    expect(svc.getConfidence(summary!.pageId)).toBeNull();
    svc.close();
  });

  it('full rebuild: 解析 frontmatter / wikilink / 标签 / 块，反链可查', async () => {
    await page('a.md', '---\naliases: [甲, Alpha]\ntags: [work]\n---\n', '# A\n\n见 [[b]] 与 [[甲|self]]\n\n含 #inline 标签\n\n块一 ^blk1\n');
    await page('dir/b.md', '', '# B\n\n引用 [[a]] 和 [[dir/c#head]] 与红链 [[ghost]]\n');
    await page('dir/c.md', '', '---\ntags: [work/project]\n---\n# C\n');

    const svc = new LinkIndexService();
    svc.setRoot(tmp);
    expect(svc.status.phase).toBe('ready');

    // 反向链接：a 的入链来自 dir/b
    const back = svc.backlinks('a.md');
    expect(back.length).toBeGreaterThanOrEqual(1);
    expect(back.some((b) => b.fromPath === 'dir/b.md')).toBe(true);
    expect(back[0]!.targetExists).toBe(true);

    // 红链：ghost 无 target 页面 → 不出现在任何页面 backlinks 中
    const ghost = svc.backlinks('ghost.md');
    expect(ghost).toEqual([]);

    // FTS 搜索：标题/标签/正文
    const byTitle = svc.search('B');
    expect(byTitle.some((h) => h.path === 'dir/b.md')).toBe(true);
    const byTag = svc.search('#work');
    expect(byTag.some((h) => h.path === 'a.md' || h.path === 'dir/c.md')).toBe(true);
    const byContent = svc.search('红链');
    expect(byContent.some((h) => h.path === 'dir/b.md')).toBe(true);

    // 标签索引（含嵌套中间节点）
    const tags = svc.tags(false);
    const names = tags.map((t) => t.tag);
    expect(names).toContain('work');
    expect(names).toContain('work/project');
    expect(names).toContain('inline');
    expect(svc.tagPages('work').sort()).toEqual(['a.md', 'dir/c.md']);

    // 块索引
    const summary = svc.pageSummary('a.md');
    expect(summary?.blockCount).toBeGreaterThanOrEqual(3);

    // ⌘K 跳转：别名匹配
    const jump = svc.jumpTo('Alpha');
    expect(jump.length).toBeGreaterThanOrEqual(1);
    expect(jump[0]!.path).toBe('a.md');
    expect(jump[0]!.match).toBe('alias');

    svc.close();
  });

  it('resolves a wikilink by filename basename when H1 title differs', async () => {
    await page('nested/file-name.md', '', '# Different Heading\n');
    await page('source.md', '', 'See [[file-name]]\n');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);
    expect(svc.backlinks('nested/file-name.md').map((item) => item.fromPath)).toEqual(['source.md']);
    svc.close();
  });

  it('search applies title tier before the requested limit', async () => {
    // More than the old 1000-candidate cap: title must still win after global tier sort.
    for (let i = 0; i < 1_001; i += 1) await page(`content-${i}.md`, '', `# Page ${i}\n\nneedle body\n`);
    await page('title.md', '', '# Needle title\n');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);
    const hits = svc.search('needle', 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe('title.md');
    expect(hits[0]?.tier).toBe('title');
    svc.close();
  });

  it('search returns the matching content block id and a block-local snippet', async () => {
    await page('blocks.md', '', '# Blocks\n\nFirst unrelated paragraph.\n\nNeedle appears in this target block with context. ^target-block\n\nLast unrelated paragraph.\n');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);
    const hit = svc.search('needle').find((item) => item.path === 'blocks.md');
    expect(hit).toMatchObject({ tier: 'content', blockId: 'target-block' });
    expect(hit?.snippet).toContain('Needle appears in this target block');
    expect(hit?.snippet).not.toContain('First unrelated paragraph');
    svc.close();
  });

  it('ambiguous basename does not arbitrarily resolve to the last page', async () => {
    await page('referrer.md', '', '# Ref\n\n短名引用 [[note]]；精确路径 [[x/note]]');
    await page('x/note.md', '', '# Note in x');
    await page('y/note.md', '', '# Note in y');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);
    // 同名 basename 跨目录歧义 → 短名 [[note]] 保持红链（不落到任意一页）
    expect(svc.backlinks('x/note.md').map((b) => b.fromPath)).toEqual(['referrer.md']);
    expect(svc.backlinks('y/note.md').map((b) => b.fromPath)).toEqual([]);
    svc.close();
  });

  it('normal Markdown links resolve relative to their source dir, not by basename', async () => {
    await page('dir/index.md', '', '[本地](b.md)');
    await page('dir/b.md', '', '# Local target');
    await page('b.md', '', '# Root target');
    await page('other/index.md', '', '[本地](b.md)');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);
    // dir/index.md 的 [本地](b.md) → dir/b.md（源目录相对），不落到根 b.md
    expect(svc.backlinks('dir/b.md').map((b) => b.fromPath)).toEqual(['dir/index.md']);
    expect(svc.backlinks('b.md').map((b) => b.fromPath)).toEqual([]); // other/index → other/b（红链）；根 b 无入链
    // 资源/外链不产生笔记反链
    svc.close();
  });

  it('asset and external Markdown links do not create note backlinks', async () => {
    await page('assets.md', '', '![封面](cover.png) [文档](doc.pdf) [站点](https://x.com/a.md) [真实](real.md)');
    await page('real.md', '', '# Real note');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);
    expect(svc.backlinks('real.md').map((b) => b.fromPath)).toEqual(['assets.md']);
    svc.close();
  });

  it('pageSummary reports real distinct inbound/outbound link counts (DEV-005)', async () => {
    await page('x.md', '', '# X\n\n链接 [[y]] 与 [Z](z.md)，以及红链 [[ghost]]');
    await page('y.md', '', '# Y\n\n回链 [[x]]');
    await page('z.md', '', '# Z');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);
    // x → y(wiki) 与 x → z(normal)：出链去重目标页 = 2；红链不计。入链来自 y = 1。
    const sx = svc.pageSummary('x.md');
    expect(sx?.outboundLinks).toBe(2);
    expect(sx?.inboundLinks).toBe(1);
    // y 出链指向 x = 1；入链来自 x = 1。
    const sy = svc.pageSummary('y.md');
    expect(sy?.outboundLinks).toBe(1);
    expect(sy?.inboundLinks).toBe(1);
    // z 仅被 x 引用：入链 1，出链 0。
    const sz = svc.pageSummary('z.md');
    expect(sz?.inboundLinks).toBe(1);
    expect(sz?.outboundLinks).toBe(0);
    svc.close();
  });

  it('CJK substring search matches through FTS without LIKE fallback', async () => {
    await page('p.md', '', '# P\n\n这是知识库搜索基准的正文片段');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);
    for (const q of ['基准', '搜索', '识库', '正文']) {
      expect(svc.search(q).some((h) => h.path === 'p.md'), `query ${q}`).toBe(true);
    }
    svc.close();
  });

  it('search applies tag tier before limit across a global candidate set', async () => {
    for (let i = 0; i < 1_001; i += 1) await page(`content-tag-${i}.md`, '', `# Page ${i}\n\nneedle body\n`);
    await page('tag.md', '---\ntags: [needle]\n---\n', '# Untitled\n');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);
    const hits = svc.search('needle', 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe('tag.md');
    expect(hits[0]?.tier).toBe('tag');
    svc.close();
  });

  it('增量：新文件/改名后反链与索引正确更新（验收项 1、2）', async () => {
    await page('target.md', '', '# Target\n');
    await page('src.md', '', '链到 [[target]]\n');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);

    expect(svc.backlinks('target.md').length).toBe(1);

    // 新增一个带 wikilink 的页面 → 反链实时 +1
    await page('src2.md', '', '也链 [[target]]\n');
    svc.updateFile('src2.md');
    expect(svc.backlinks('target.md').length).toBe(2);

    // 重命名 target → newname（DEV-003 renameWithLinks 会改写正文；这里直接模拟改写后状态）
    await rm(path.join(tmp, 'target.md'));
    await page('newname.md', '', '# Target\n');
    await writeFile(path.join(tmp, 'src.md'), '链到 [[newname]]\n', 'utf8');
    await writeFile(path.join(tmp, 'src2.md'), '也链 [[newname]]\n', 'utf8');
    svc.updateFile('target.md'); // unlink
    svc.updateFile('newname.md');
    svc.updateFile('src.md');
    svc.updateFile('src2.md');

    expect(svc.backlinks('target.md')).toEqual([]);
    const renamed = svc.backlinks('newname.md');
    expect(renamed.length).toBe(2);
    // 索引中不再有指向旧名的已解析链接
    const jumpOld = svc.jumpTo('target');
    expect(jumpOld.find((j) => j.path === 'target.md')).toBeUndefined();

    svc.close();
  });

  it('全量重建与文件系统一致；防抖增量合并多次变化（验收项 3）', async () => {
    await page('x.md', '', '# X\n\n内容甲\n');
    await page('y.md', '', '---\ntags: [t]\n---\n# Y\n\n内容乙\n');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);

    // 全量重建后数据一致
    svc.rebuild();
    expect(svc.search('内容甲').length).toBe(1);
    expect(svc.tags(true).map((t) => t.tag)).toEqual(['t']);

    // 防抖：连续多次 scheduleUpdate 合并为一次（结果正确即可）
    await writeFile(path.join(tmp, 'x.md'), '# X\n\n内容丙\n', 'utf8');
    svc.scheduleUpdate('x.md');
    svc.scheduleUpdate('x.md');
    svc.scheduleUpdate('x.md');
    await new Promise((r) => setTimeout(r, 300));
    expect(svc.search('内容甲')).toEqual([]);
    expect(svc.search('内容丙').length).toBe(1);

    svc.close();
  });

  it('置信度回调在链接边变化时升级为全量，纯内容变化保持增量', async () => {
    await page('target.md', '', '# Target\n');
    await page('source.md', '', '# Source\n\n[[target]]\n');
    const indexed: Array<string[] | null> = [];
    const svc = new LinkIndexService(() => undefined, (paths) => indexed.push(paths));
    svc.setRoot(tmp);
    expect(indexed).toEqual([null]);

    await writeFile(path.join(tmp, 'source.md'), '# Source\n\n保留链接 [[target]]，仅改正文\n', 'utf8');
    svc.updateFile('source.md');
    expect(indexed.at(-1)).toEqual(['source.md']);

    await writeFile(path.join(tmp, 'source.md'), '# Source\n\n移除链接\n', 'utf8');
    svc.updateFile('source.md');
    expect(indexed.at(-1)).toBeNull();
    svc.close();
  });

  it('反链 snippet 围绕原始 wikilink 定位，alias [[Target|显示]] 也能定位', async () => {
    await page('target.md', '', '# Target\n');
    await page(
      'src.md',
      '',
      '# 头\n\n首段无关内容\n\n这里有上下文 [[target|显示别名]] 在末尾\n\n下一段\n',
    );
    const svc = new LinkIndexService();
    svc.setRoot(tmp);

    const back = svc.backlinks('target.md');
    expect(back.length).toBe(1);
    const item = back[0]!;
    expect(item.sourceText).toBe('[[target|显示别名]]');
    expect(item.snippet).toContain('[[target|显示别名]]');
    expect(item.snippet).toContain('这里有上下文');
    // 应定位到 alias 所在段，而不是首段
    expect(item.snippet).not.toContain('首段无关内容');
    expect(item.snippet).not.toContain('下一段');
    // 块元数据齐备
    expect(item.blockId === null || typeof item.blockId === 'string').toBe(true);
    expect(typeof item.blockPosition).toBe('number');

    svc.close();
  });

  it('搜索：FTS 抛错不会吞掉 LIKE 兜底；malformed query 仍命中中文子串', async () => {
    // 内容含带引号的畸形 token，保证 LIKE 子串命中且 FTS 语法非法
    await page('a.md', '', '# A\n\n含 "未闭合 引号红色\n');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);

    // 合法 query 命中
    expect(svc.search('红色').length).toBe(1);
    // 畸形 FTS（未闭合引号）：仍应返回 LIKE 结果而非空
    const malformed = svc.search('"未闭合');
    expect(malformed.length).toBe(1);
    expect(malformed[0]!.path).toBe('a.md');

    svc.close();
  });

  it('标签 descPageCount 聚合：中间节点 pageCount=0，descPageCount=子页面去重数', async () => {
    await page('a.md', '', '---\ntags: [work/project, work/notes]\n---\n# A\n');
    await page('b.md', '', '---\ntags: [work/notes]\n---\n# B\n');
    await page('c.md', '', '---\ntags: [archive]\n---\n# C\n');

    const svc = new LinkIndexService();
    svc.setRoot(tmp);

    const map = new Map(svc.tags(false).map((t) => [t.tag, t]));
    expect(map.get('work')?.descendantPageCount).toBe(2);
    expect(map.get('work')?.pageCount).toBe(0);
    expect(map.get('work')?.isIntermediate).toBe(true);
    expect(map.get('work/project')?.pageCount).toBe(1);
    expect(map.get('work/project')?.descendantPageCount).toBe(1);
    expect(map.get('work/notes')?.pageCount).toBe(2);
    expect(map.get('archive')?.pageCount).toBe(1);
    expect(map.get('archive')?.descendantPageCount).toBe(1);

    // 过滤中间节点 work 应返回 a/b 两个文件（c 不同子树）
    expect(svc.tagPages('work').sort()).toEqual(['a.md', 'b.md']);

    svc.close();
  });

  it('索引 root 切换防线：旧 root 事件不会以新 root 重新索引', async () => {
    await page('a.md', '', '# A\n\n旧库内容甲\n');
    await page('b.md', '', '# B\n\n旧库内容乙\n');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);
    expect(svc.search('内容甲').length).toBe(1);

    // 切换 root：为不同 vault 建目录并 setRoot
    const other = path.join(tmp, 'other');
    await mkdir(other, { recursive: true });
    await writeFile(path.join(other, 'n.md'), '# N\n\n新库内容丙\n', 'utf8');
    svc.setRoot(other);
    expect(svc.search('内容丙').length).toBe(1);

    // 旧 root 的事件（在切换后到达）应被丢弃：updateFile 带旧 sourceRoot
    svc.updateFile('a.md', tmp);
    // 新 root 不应出现 旧库内容甲
    expect(svc.search('内容甲')).toEqual([]);
    // 旧 root 也应没有 a.md 页面残留
    expect(svc.pageSummary('a.md')).toBeNull();

    svc.close();
  });

  it('graph exports page metadata, resolved links, and ignores red links', async () => {
    await page('a.md', '---\ntags: [work/project]\n---\n', '# Alpha\n');
    await page('docs/b.md', '', '# Beta\n\n[[a]] [[a]] [[ghost]]\n');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);

    const snapshot = svc.graph();
    expect(snapshot.pages).toEqual([
      { path: 'a.md', title: 'Alpha', folder: '', tags: ['work/project'], inboundLinks: 1, outboundLinks: 0 },
      { path: 'docs/b.md', title: 'Beta', folder: 'docs', tags: [], inboundLinks: 0, outboundLinks: 1 },
    ]);
    expect(snapshot.links).toEqual([{ source: 'docs/b.md', target: 'a.md' }]);

    await page('c.md', '', '# Gamma\n\n[[a]]\n');
    svc.updateFile('c.md');
    expect(svc.graph().links).toEqual([
      { source: 'c.md', target: 'a.md' },
      { source: 'docs/b.md', target: 'a.md' },
    ]);
    svc.close();
  });

  it('graph exports the 500-page / 2000-link acceptance scale in bounded time', async () => {
    const jobs: Promise<void>[] = [];
    for (let page = 0; page < 500; page += 1) {
      const targets = Array.from(
        { length: 4 },
        (_, offset) => `[[page-${(page + offset + 1) % 500}]]`,
      ).join(' ');
      jobs.push(writeFile(path.join(tmp, `page-${page}.md`), `# Page ${page}\n\n${targets}\n`, 'utf8'));
    }
    await Promise.all(jobs);

    const svc = new LinkIndexService();
    svc.setRoot(tmp);
    const started = performance.now();
    const snapshot = svc.graph();
    const graphMs = performance.now() - started;

    expect(snapshot.pages).toHaveLength(500);
    expect(snapshot.links).toHaveLength(2000);
    expect(snapshot.pages.every((page) => page.inboundLinks === 4 && page.outboundLinks === 4)).toBe(true);
    console.log(`[bench] graph export 500 pages / 2000 links=${graphMs.toFixed(2)}ms`);
    expect(graphMs).toBeLessThan(500);
    svc.close();
  }, 60_000);

  it('coalesces directory churn into one authoritative rebuild', async () => {
    await page('before.md', '', '# Before\n');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);
    await page('bulk/one.md', '', '# One\n');
    await page('bulk/two.md', '', '# Two\n');
    svc.scheduleRebuild();
    svc.scheduleRebuild();
    svc.scheduleRebuild();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(svc.jumpTo('one').some((page) => page.path === 'bulk/one.md')).toBe(true);
    expect(svc.jumpTo('two').some((page) => page.path === 'bulk/two.md')).toBe(true);
    svc.close();
  });

  it('service boundary rejects absolute and traversal update paths', async () => {
    await page('safe.md', '', '# Safe\n\n原内容\n');
    const outside = path.join(tmp, '..', 'outside.md');
    await writeFile(outside, '# Outside\n\n不应索引\n', 'utf8');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);
    svc.updateFile('../outside.md');
    svc.updateFile(outside);
    svc.scheduleUpdate('../outside.md');
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(svc.search('不应索引')).toEqual([]);
    expect(svc.pageSummary('safe.md')).not.toBeNull();
    svc.close();
    await rm(outside, { force: true });
  });

  it('maps repeated identical blocks to their actual source block', async () => {
    await page('target.md', '', '# Target\n');
    await page('src.md', '', '重复段落\n\n重复段落含 [[target]]\n');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);
    const backlink = svc.backlinks('target.md')[0]!;
    expect(backlink.blockPosition).toBe(1);
    expect(backlink.snippet).toContain('[[target]]');
    svc.close();
  });

  it('LIKE fallback applies AND semantics to multi-term Chinese queries', async () => {
    await page('both.md', '', '# Both\n\n中文甲 中文乙\n');
    await page('one.md', '', '# One\n\n中文甲\n');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);
    // The LIKE path supplements FTS; both terms must be present in a matching document.
    expect(svc.search('中文甲 中文乙').map((hit) => hit.path)).toEqual(['both.md']);
    svc.close();
  });

  it('LIKE fallback treats % and _ as literal characters', async () => {
    await page('percent.md', '', '# Percent\n\n值为 100%_done\n');
    await page('wildcard.md', '', '# Wildcard\n\n值为 100XXdone\n');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);
    expect(svc.search('100%_done').map((hit) => hit.path)).toEqual(['percent.md']);
    svc.close();
  });

  it('jumpTo treats %, _, and backslash as literal query characters', async () => {
    await page('literal.md', '', '# 100%_Done\\Path\n');
    await page('wildcard.md', '', '# 100XXDoneXPath\n');
    const svc = new LinkIndexService();
    svc.setRoot(tmp);
    expect(svc.jumpTo('100%_done\\path').map((hit) => hit.path)).toEqual(['literal.md']);
    svc.close();
  });

  it('删除 index.db 后重开自动全量重建（验收项 5）', async () => {
    await page('keep.md', '', '# Keep\n');
    const svc1 = new LinkIndexService();
    svc1.setRoot(tmp);
    expect(svc1.search('Keep').length).toBe(1);
    svc1.close();

    // 删除数据库文件（含 WAL/SHM）
    LinkIndexService.removeDatabase(tmp);
    expect(existsSync(path.join(tmp, '.nexnote', 'index.db'))).toBe(false);

    const svc2 = new LinkIndexService();
    svc2.setRoot(tmp);
    expect(svc2.status.phase).toBe('ready');
    expect(svc2.search('Keep').length).toBe(1); // 自动重建完成
    svc2.close();
  });

  it('FTS 性能：千级页面搜索 < 100ms（验收项 4）', async () => {
    // 生成 1000 个小页面
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < 1000; i += 1) {
      const dir = `p${Math.floor(i / 100)}`;
      jobs.push(
        mkdir(path.join(tmp, dir), { recursive: true }).then(() =>
          writeFile(path.join(tmp, dir, `page${i}.md`), `---\ntags: [bench]\n---\n# 性能页 ${i}\n\n第 ${i} 页正文内容：知识库搜索基准\n`, 'utf8'),
        ),
      );
    }
    await Promise.all(jobs);

    const svc = new LinkIndexService();
    const t0 = performance.now();
    svc.setRoot(tmp); // 包含全量构建
    const buildMs = performance.now() - t0;

    // 多种查询取最坏值
    const queries = ['性能页', '基准', '知识库'];
    let worst = 0;
    for (const q of queries) {
      const s = performance.now();
      const hits = svc.search(q);
      worst = Math.max(worst, performance.now() - s);
      expect(hits.length).toBeGreaterThan(0);
    }
    console.log(`[bench] 1000 pages build=${buildMs.toFixed(0)}ms worstSearch=${worst.toFixed(2)}ms`);
    expect(worst).toBeLessThan(100);

    svc.close();
  }, 60_000);
});
