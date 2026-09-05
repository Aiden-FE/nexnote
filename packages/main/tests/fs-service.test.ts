import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsError, VaultFsService } from '../src/fs/fs-service';

let tmp: string;
let vaultRoot: string;
let service: VaultFsService;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'nexnote-fs-test-'));
  vaultRoot = path.join(tmp, 'vault');
  await mkdir(vaultRoot, { recursive: true });
  service = new VaultFsService(() => vaultRoot);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('沙箱校验', () => {
  it('未打开 vault 时全部拒绝', async () => {
    const noVault = new VaultFsService(() => null);
    await expect(noVault.readTextFile('a.md')).rejects.toMatchObject({ code: 'NO_VAULT' });
  });

  it('拒绝绝对路径', async () => {
    await expect(service.readTextFile('/etc/passwd')).rejects.toMatchObject({
      code: 'ABSOLUTE_PATH',
    });
    await expect(service.readTextFile('C:\\Windows\\win.ini')).rejects.toMatchObject({
      code: 'ABSOLUTE_PATH',
    });
  });

  it('拒绝 .. 逃逸', async () => {
    await expect(service.readTextFile('../outside.md')).rejects.toMatchObject({
      code: 'OUTSIDE_VAULT',
    });
    await expect(service.readTextFile('a/../../escape.md')).rejects.toMatchObject({
      code: 'OUTSIDE_VAULT',
    });
  });

  it('允许内部 .. 归一化（仍在 vault 内）', async () => {
    await mkdir(path.join(vaultRoot, 'a'), { recursive: true });
    await writeFile(path.join(vaultRoot, 'a', 'note.md'), '# hello', 'utf8');
    await expect(service.readTextFile('a/../a/note.md')).resolves.toBe('# hello');
  });

  it('拒绝符号链接逃逸（链接指向 vault 外）', async () => {
    const outsideDir = path.join(tmp, 'outside');
    await mkdir(outsideDir, { recursive: true });
    await writeFile(path.join(outsideDir, 'secret.md'), 'secret', 'utf8');
    await symlink(outsideDir, path.join(vaultRoot, 'link-to-outside'), 'dir');
    await expect(service.readTextFile('link-to-outside/secret.md')).rejects.toMatchObject({
      code: 'OUTSIDE_VAULT',
    });
    // 写入经逃逸链接同样被拒（校验的是父目录 realpath）
    await expect(
      service.writeTextFile('link-to-outside/new.md', 'x'),
    ).rejects.toMatchObject({ code: 'OUTSIDE_VAULT' });
  });
});

describe('读写与目录操作', () => {
  it('writeTextFile 自动建父目录并原子写入；readTextFile 读回', async () => {
    const info = await service.writeTextFile('notes/deep/note.md', '# 标题', true);
    expect(info.kind).toBe('file');
    expect(info.path).toBe('notes/deep/note.md');
    await expect(service.readTextFile('notes/deep/note.md')).resolves.toBe('# 标题');
  });

  it('exists / stat', async () => {
    expect(await service.exists('missing.md')).toBe(false);
    await service.writeTextFile('a.md', 'x');
    expect(await service.exists('a.md')).toBe(true);
    const st = await service.stat('a.md');
    expect(st?.kind).toBe('file');
    expect(st?.name).toBe('a.md');
    expect(await service.stat('missing.md')).toBeNull();
  });

  it('listDir 返回目录优先排序的条目', async () => {
    await service.writeTextFile('z.md', 'z');
    await service.writeTextFile('sub/a.md', 'a');
    const entries = await service.listDir('');
    expect(entries.map((e) => e.name)).toEqual(['sub', 'z.md']);
    expect(entries[0]?.kind).toBe('directory');
    const sub = await service.listDir('sub');
    expect(sub.map((e) => e.path)).toEqual(['sub/a.md']);
  });

  it('mkdir / rename / delete', async () => {
    await service.mkdir('new-dir', true);
    expect(await service.exists('new-dir')).toBe(true);
    const renamed = await service.rename('new-dir', 'renamed-dir/nested');
    expect(renamed.kind).toBe('directory');
    await service.writeTextFile('renamed-dir/nested/f.md', 'f');
    await service.delete('renamed-dir/nested/f.md');
    expect(await service.exists('renamed-dir/nested/f.md')).toBe(false);
    await service.delete('renamed-dir');
    expect(await service.exists('renamed-dir')).toBe(false);
  });

  it('listDir 不存在的目录报 READ_DIR_FAILED', async () => {
    await expect(service.listDir('nope')).rejects.toMatchObject({ code: 'READ_DIR_FAILED' });
    await expect(service.readTextFile('nope.md')).rejects.toBeInstanceOf(FsError);
  });
});
