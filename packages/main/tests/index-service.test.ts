import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    expect(svc.tagPages('work')).toEqual(['a.md']);

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
