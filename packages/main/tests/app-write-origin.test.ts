import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_WRITE_MAX_ENTRIES, AppWriteTracker } from '../src/fs/app-write-tracker';
import { VaultFsService } from '../src/fs/fs-service';
import { renameWithLinks } from '../src/fs/page-ops';

let tmp: string;
let vaultRoot: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-app-write-test-'));
  vaultRoot = path.join(tmp, 'vault');
  await mkdir(vaultRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function abs(rel: string): string {
  return path.resolve(vaultRoot, rel);
}

describe('AppWriteTracker（TTL + 上限）', () => {
  it('登记后命中，未登记不命中', () => {
    const now = 1_000;
    const tracker = new AppWriteTracker(10_000, 500, () => now);
    tracker.record(abs('a.md'));
    expect(tracker.isRecent(abs('a.md'))).toBe(true);
    expect(tracker.isRecent(abs('b.md'))).toBe(false);
  });

  it('TTL 过期后不再命中（覆盖 awaitWriteFinish 120ms 延迟窗口）', () => {
    let now = 1_000;
    const tracker = new AppWriteTracker(10_000, 500, () => now);
    tracker.record(abs('a.md'));
    now += 9_999; // TTL 内（watcher 延迟远小于此）
    expect(tracker.isRecent(abs('a.md'))).toBe(true);
    now += 2; // 超过 TTL
    expect(tracker.isRecent(abs('a.md'))).toBe(false);
  });

  it('重复登记刷新 TTL 起点', () => {
    let now = 1_000;
    const tracker = new AppWriteTracker(10_000, 500, () => now);
    tracker.record(abs('a.md'));
    now += 9_000;
    tracker.record(abs('a.md'));
    now += 9_000;
    expect(tracker.isRecent(abs('a.md'))).toBe(true);
    now += 1_001;
    expect(tracker.isRecent(abs('a.md'))).toBe(false);
  });

  it('超过上限时逐出最旧登记，有界防泄漏', () => {
    let now = 1_000;
    const tracker = new AppWriteTracker(10_000, 5, () => now);
    for (let i = 0; i < APP_WRITE_MAX_ENTRIES + 10; i += 1) {
      tracker.record(abs(`f${i}.md`));
    }
    expect(tracker.isRecent(abs('f0.md'))).toBe(false);
    expect(tracker.isRecent(abs(`f${APP_WRITE_MAX_ENTRIES + 9}.md`))).toBe(true);
    now += 10_001;
    expect(tracker.isRecent(abs(`f${APP_WRITE_MAX_ENTRIES + 9}.md`))).toBe(false);
  });
});

describe('VaultFsService 应用写入登记', () => {
  it('writeTextFile / createTextFile 落盘后登记为应用写入', async () => {
    const service = new VaultFsService(() => vaultRoot);
    await service.writeTextFile('note.md', '# v1\n');
    expect(service.isRecentAppWrite(abs('note.md'))).toBe(true);

    const created = await service.createTextFile('fresh.md', '# fresh\n');
    expect(created.created).toBe(true);
    expect(service.isRecentAppWrite(abs('fresh.md'))).toBe(true);

    expect(service.isRecentAppWrite(abs('other.md'))).toBe(false);
  });

  it('importBinaryFile（覆盖与去重两条路径）均登记实际写入路径', async () => {
    const service = new VaultFsService(() => vaultRoot);
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const overwritten = await service.importBinaryFile('assets/pic.png', data, {
      createParentDirs: true,
      overwrite: true,
    });
    expect(overwritten).toBe('assets/pic.png');
    expect(service.isRecentAppWrite(abs('assets/pic.png'))).toBe(true);

    const deduped = await service.importBinaryFile('assets/pic.png', data, {
      createParentDirs: true,
    });
    expect(deduped).toBe('assets/pic 2.png');
    expect(service.isRecentAppWrite(abs('assets/pic 2.png'))).toBe(true);
    expect(service.isRecentAppWrite(abs('assets/missing.png'))).toBe(false);
  });

  it('rename 登记目标路径；renameWithLinks 联动重写的其它文件也被登记', async () => {
    const service = new VaultFsService(() => vaultRoot);
    await service.writeTextFile('a.md', '# A\n');
    await service.writeTextFile('b.md', '# B\n\n[[a]]\n');

    const result = await renameWithLinks(service, 'a.md', 'a-renamed.md');
    expect(result.info.path).toBe('a-renamed.md');
    expect(service.isRecentAppWrite(abs('a-renamed.md'))).toBe(true);
    // 联动重写：b.md 的 wikilink 被更新并写回 → 必须登记为应用写入
    expect(result.updatedFiles).toContain('b.md');
    expect(await service.readTextFile('b.md')).toContain('[[a-renamed]]');
    expect(service.isRecentAppWrite(abs('b.md'))).toBe(true);
  });

  it('登记随 TTL 过期（短 TTL 注入 + 真实等待）', async () => {
    const service = new VaultFsService(() => vaultRoot, new AppWriteTracker(30, 10));
    await service.writeTextFile('short-ttl.md', '# x\n');
    expect(service.isRecentAppWrite(abs('short-ttl.md'))).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(service.isRecentAppWrite(abs('short-ttl.md'))).toBe(false);
  });
});
