import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FsChangeEvent } from '@nexnote/shared';
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
    await untilEvent((e) => e.kind === 'add');
    await writeFile(path.join(rootA, 'w.md'), 'v2', 'utf8');
    expect(await untilEvent((e) => e.kind === 'change' && e.path === 'w.md')).toBe(true);
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
