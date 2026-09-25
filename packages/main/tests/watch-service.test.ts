import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FsChangeEvent } from '@nexnote/shared';
import { AppWriteTracker } from '../src/fs/app-write-tracker';
import { VaultFsService } from '../src/fs/fs-service';
import { renameWithLinks } from '../src/fs/page-ops';
import { VaultWatchService } from '../src/fs/watch-service';

let tmp: string;
let rootA: string;
let rootB: string;
let rootC: string;
let events: FsChangeEvent[];

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-watch-test-'));
  rootA = path.join(tmp, 'vault-a');
  rootB = path.join(tmp, 'vault-b');
  rootC = path.join(tmp, 'vault-c');
  await mkdir(rootA, { recursive: true });
  await mkdir(rootB, { recursive: true });
  await mkdir(rootC, { recursive: true });
  events = [];
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function makeService(getRoot: () => string | null): VaultWatchService {
  return new VaultWatchService({
    getRoot,
    emit: (e) => events.push(e),
  });
}

/** 等到收集到匹配事件（watcher 异步 + awaitWriteFinish 均有延迟）。 */
async function untilEvent(
  predicate: (e: FsChangeEvent) => boolean,
  timeoutMs = 8000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (events.some(predicate)) return true;
    await new Promise((r) => setTimeout(r, 60));
  }
  return events.some(predicate);
}

describe('VaultWatchService（真实临时目录 + chokidar）', () => {
  it('外部创建/删除文件与目录均推送相对路径事件', async () => {
    const svc = makeService(() => rootA);
    await svc.sync();
    await svc.ready();
    await writeFile(path.join(rootA, 'note.md'), '# hi', 'utf8');
    expect(await untilEvent((e) => e.kind === 'add' && e.path === 'note.md')).toBe(true);

    await mkdir(path.join(rootA, 'sub'));
    expect(await untilEvent((e) => e.kind === 'addDir' && e.path === 'sub')).toBe(true);

    await writeFile(path.join(rootA, 'sub', 'inner.md'), 'x', 'utf8');
    expect(await untilEvent((e) => e.kind === 'add' && e.path === 'sub/inner.md')).toBe(true);

    await rm(path.join(rootA, 'sub'), { recursive: true, force: true });
    expect(await untilEvent((e) => e.kind === 'unlinkDir' && e.path === 'sub')).toBe(true);
    expect(await untilEvent((e) => e.kind === 'unlink' && e.path === 'sub/inner.md')).toBe(true);

    await svc.stop();
  });

  it('内容变化推送 change 事件（相对路径）', async () => {
    const svc = makeService(() => rootA);
    await svc.sync();
    await svc.ready();
    await writeFile(path.join(rootA, 'w.md'), 'v1', 'utf8');
    expect(
      await untilEvent((e) => e.kind === 'add' && e.path === 'w.md'),
      JSON.stringify(events),
    ).toBe(true);
    await writeFile(path.join(rootA, 'w.md'), 'v2', 'utf8');
    expect(
      await untilEvent((e) => e.kind === 'change' && e.path === 'w.md'),
      JSON.stringify(events),
    ).toBe(true);
    await svc.stop();
  });

  it('.nexnote/.git/.trash/node_modules 变化不推送事件', async () => {
    const svc = makeService(() => rootA);
    await svc.sync();
    await svc.ready();
    const baseline = events.length;
    await mkdir(path.join(rootA, '.nexnote'), { recursive: true });
    await mkdir(path.join(rootA, '.git'), { recursive: true });
    await mkdir(path.join(rootA, '.trash'), { recursive: true });
    await mkdir(path.join(rootA, 'node_modules'), { recursive: true });
    await writeFile(path.join(rootA, '.nexnote', 'config.json'), '{}', 'utf8');
    await new Promise((r) => setTimeout(r, 600));
    expect(events.length).toBe(baseline);
    await svc.stop();
  });

  it('vault 切换：sync 到新 root 后监听新目录', async () => {
    let current: string | null = rootA;
    const svc = makeService(() => current);
    await svc.sync();
    await svc.ready();
    expect(svc.watched).toBe(rootA);

    current = rootB;
    await svc.sync();
    await svc.ready();
    expect(svc.watched).toBe(rootB);
    const baseline = events.length;
    await writeFile(path.join(rootA, 'outside.md'), 'x', 'utf8');
    await writeFile(path.join(rootB, 'inside.md'), 'x', 'utf8');
    expect(await untilEvent((e) => e.kind === 'add' && e.path === 'inside.md')).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(events.slice(baseline).some((e) => e.path === 'outside.md')).toBe(false);
    await svc.stop();
  });

  it('root=null（vault 关闭）停止监听', async () => {
    let current: string | null = rootA;
    const svc = makeService(() => current);
    await svc.sync();
    current = null;
    await svc.sync();
    await svc.ready();
    expect(svc.watched).toBeNull();
    const baseline = events.length;
    await writeFile(path.join(rootA, 'after.md'), 'x', 'utf8');
    await new Promise((r) => setTimeout(r, 500));
    expect(events.length).toBe(baseline);
  });

  it('重复 sync 同一 root 是幂等操作', async () => {
    const svc = makeService(() => rootA);
    await svc.sync();
    await svc.sync();
    await svc.ready();
    expect(svc.watched).toBe(rootA);
    await svc.stop();
  });

  it('sync 串行化：快速连续切多个 root，只监听最终 root，旧 root 事件被丢弃', async () => {
    let current: string | null = rootA;
    const svc = makeService(() => current);
    // 不 await，立刻连续切换 root：A → B → C
    current = rootB;
    const p1 = svc.sync();
    current = rootC;
    const p2 = svc.sync();
    current = rootC;
    const p3 = svc.sync();
    await Promise.all([p1, p2, p3]);
    await svc.ready();
    expect(svc.watched).toBe(rootC);

    const baseline = events.length;
    // 写旧 root（B）不应产生事件（B watcher 已关 / 串行化了）
    await writeFile(path.join(rootB, 'stale.md'), 'x', 'utf8');
    await new Promise((r) => setTimeout(r, 400));
    expect(events.slice(baseline).some((e) => e.path === 'stale.md')).toBe(false);

    // 写最终 root（C）应产生事件
    await writeFile(path.join(rootC, 'fresh.md'), 'x', 'utf8');
    expect(await untilEvent((e) => e.kind === 'add' && e.path === 'fresh.md')).toBe(true);
    await svc.stop();
  });

  it('emit 防线：getRoot 已切换（旧 watcher 尚未 stop）时，旧 vault 事件不发送', async () => {
    let current: string | null = rootA;
    const svc = makeService(() => current);
    await svc.sync();
    await svc.ready();
    // 视图已切换（getRoot 返回 B），但尚未停止 A 的 watcher → 模拟切换中的竞态窗口
    current = rootB;
    const baseline = events.length;
    await writeFile(path.join(rootA, 'late.md'), 'x', 'utf8');
    // 给 A watcher 的 awaitWriteFinish 时间发送事件
    await new Promise((r) => setTimeout(r, 500));
    // 事件应被 emit 防线丢弃（getRoot()=B ≠ capturedRoot=A）
    expect(events.slice(baseline).some((e) => e.path === 'late.md')).toBe(false);
    // 完成切换后正确监听 B
    await svc.sync();
    await svc.ready();
    expect(svc.watched).toBe(rootB);
    await svc.stop();
  });
});

describe('VaultWatchService origin 标记（应用自身写入 vs 外部写入）', () => {
  function makeTrackedService(
    getRoot: () => string | null,
    tracker: AppWriteTracker,
  ): VaultWatchService {
    return new VaultWatchService({
      getRoot,
      emit: (e) => events.push(e),
      isRecentAppWrite: (absPath) => tracker.isRecent(absPath),
    });
  }

  it('应用自身写入（fs 服务落盘）的 add/change 事件带 origin:"app"', async () => {
    const tracker = new AppWriteTracker();
    const fs = new VaultFsService(() => rootA, tracker);
    const svc = makeTrackedService(() => rootA, tracker);
    await svc.sync();
    await svc.ready();

    // 首次写入 → add 事件带 origin
    await fs.writeTextFile('app-note.md', '# v1\n');
    expect(await untilEvent((e) => e.path === 'app-note.md' && e.origin === 'app')).toBe(true);

    // 后续写入 → change 事件带 origin（awaitWriteFinish 延迟 120ms+ 后到达，TTL 覆盖）
    await fs.writeTextFile('app-note.md', '# v2\n');
    expect(
      await untilEvent(
        (e) => e.kind === 'change' && e.path === 'app-note.md' && e.origin === 'app',
      ),
    ).toBe(true);
    await svc.stop();
  });

  it('外部写入（不经 fs 服务）的事件不带 origin，保持外部语义', async () => {
    const tracker = new AppWriteTracker();
    const fs = new VaultFsService(() => rootA, tracker);
    const svc = makeTrackedService(() => rootA, tracker);
    await svc.sync();
    await svc.ready();

    // 应用写入外部未曾触碰的路径：首写 add、再写 change，均带 origin
    await fs.writeTextFile('app-note-2.md', '# by app\n');
    expect(await untilEvent((e) => e.path === 'app-note-2.md' && e.origin === 'app')).toBe(true);
    await fs.writeTextFile('app-note-2.md', '# by app v2\n');
    expect(
      await untilEvent(
        (e) => e.kind === 'change' && e.path === 'app-note-2.md' && e.origin === 'app',
      ),
    ).toBe(true);

    // 外部直接写盘另一路径：不登记 tracker → 事件无 origin
    //（同路径在 TTL 窗口内的外部写入按设计归入应用写入，此处用全新路径验证外部语义）
    await writeFile(path.join(rootA, 'ext-note.md'), '# external\n', 'utf8');
    expect(
      await untilEvent(
        (e) => e.kind === 'add' && e.path === 'ext-note.md' && e.origin === undefined,
      ),
    ).toBe(true);
    await svc.stop();
  });

  it('renameWithLinks 联动重写的其它文件，change 事件带 origin:"app"', async () => {
    const tracker = new AppWriteTracker();
    const fs = new VaultFsService(() => rootA, tracker);
    const svc = makeTrackedService(() => rootA, tracker);
    await svc.sync();
    await svc.ready();

    await fs.writeTextFile('a.md', '# A\n');
    await fs.writeTextFile('b.md', '# B\n\n[[a]]\n');
    // 等 b.md 的 add 事件消费完，避免 initial add 事件干扰断言
    expect(await untilEvent((e) => e.kind === 'add' && e.path === 'b.md')).toBe(true);
    const baseline = events.length;

    const result = await renameWithLinks(fs, 'a.md', 'a-renamed.md');
    expect(result.updatedFiles).toContain('b.md');
    // b.md 的联动重写必须被标记为应用写入：打开中的 b.md 不应弹外部修改冲突
    expect(
      await untilEvent(
        (e) =>
          events.indexOf(e) >= baseline &&
          e.kind === 'change' &&
          e.path === 'b.md' &&
          e.origin === 'app',
      ),
    ).toBe(true);
    await svc.stop();
  });
});
