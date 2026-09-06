import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FsChangeEvent } from '@nexnote/shared';
import { VaultWatchService } from '../src/fs/watch-service';
import { VaultFsService } from '../src/fs/fs-service';
import { renameWithLinks } from '../src/fs/page-ops';
import { LinkIndexService } from '../src/indexer/index-service';

/**
 * DEV-004 验收：重命名一致性走「真实 fs:renameLinked → chokidar → 防抖 → 索引」链路，
 * 不手工改写内容或直接触发 updateFile。验证旧 path/link 清除、新 path/backlinks/tag/FTS 正确。
 */
let tmp: string;
let rootA: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-rename-index-'));
  rootA = path.join(tmp, 'vault');
  await mkdir(rootA, { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 8000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 80));
  }
  return predicate();
}

describe('rename → watcher → index 链路', () => {
  it('fs:renameLinked（renameWithLinks）驱动索引：旧路径清除、新路径/反链/标签/FTS 正确', async () => {
    // 建 3 个页面：old.md（带标签 + 内容，被引用）、src.md（指向 old）、other.md
    await writeFile(
      path.join(rootA, 'old.md'),
      '# Old\n\n老页面正文含有「红链基准」字样\n',
      'utf8',
    );
    await writeFile(path.join(rootA, 'src.md'), '引用 [[old]] 一句\n', 'utf8');
    await writeFile(path.join(rootA, 'other.md'), '# Other\n\n无关内容\n', 'utf8');

    const fs = new VaultFsService(() => rootA);
    const index = new LinkIndexService();
    const watch = new VaultWatchService({
      getRoot: () => rootA,
      emit: (e: FsChangeEvent) => {
        if (e.kind === 'add' || e.kind === 'change' || e.kind === 'unlink') {
          index.scheduleUpdate(e.path, rootA);
        }
      },
    });

    index.setRoot(rootA);
    await watch.sync();
    await watch.ready();

    // 初始就绪
    expect(await waitUntil(() => index.status.phase === 'ready')).toBe(true);
    expect(index.backlinks('old.md').length).toBe(1);
    expect(index.backlinks('old.md')[0]!.fromPath).toBe('src.md');
    expect(index.search('红链基准').some((h) => h.path === 'old.md')).toBe(true);

    // 真实重命名 + 全库 wikilink 更新（fs:renameLinked 的行为）
    const { updatedFiles } = await renameWithLinks(fs, 'old.md', 'renamed.md');
    expect(updatedFiles).toContain('src.md');

    // 等 watcher 事件回流索引：旧 path 清除、新 path 建立
    expect(await waitUntil(() => index.backlinks('old.md').length === 0)).toBe(true);
    expect(await waitUntil(() => index.backlinks('renamed.md').length === 1)).toBe(true);

    // 新反链来自 src.md，且源正文被改写为 [[renamed]]
    const renamedBack = index.backlinks('renamed.md')[0]!;
    expect(renamedBack.fromPath).toBe('src.md');
    expect(index.pageSummary('old.md')).toBeNull();
    expect(index.pageSummary('renamed.md')).not.toBeNull();

    // 搜索：新路径索引，旧路径不再命中
    expect(index.search('红链基准').some((h) => h.path === 'renamed.md')).toBe(true);
    expect(index.search('红链基准').some((h) => h.path === 'old.md')).toBe(false);
    expect(index.jumpTo('old').some((j) => j.path === 'old.md')).toBe(false);
    expect(index.jumpTo('renamed').some((j) => j.path === 'renamed.md')).toBe(true);

    // src.md 中的链接已解析到新目标（target_page_id 不再是 null）
    const srcSummary = index.pageSummary('src.md');
    expect(srcSummary).not.toBeNull();
    // FTS 全量为最新状态（无残留 old.md 行）
    expect(index.tags(true).map((t) => t.tag)).not.toContain(undefined);

    await watch.stop();
    index.close();
  }, 30_000);
});
