import { describe, expect, it, vi } from 'vitest';
import {
  classifyExternalChange,
  fileVersionOf,
  saveSourceText,
  sameVersion,
  type PageFileIo,
} from '../src/editor/source/page-source-io';

function io(overrides: Partial<PageFileIo> = {}): PageFileIo {
  return {
    stat: async () => ({ path: 'a.md', name: 'a.md', kind: 'file', size: 1, modifiedAt: 't1' }),
    read: async () => 'different',
    exists: async () => false,
    write: async () => ({ path: 'a.md', name: 'a.md', kind: 'file', size: 2, modifiedAt: 't2' }),
    renameLinked: async () => undefined,
    ...overrides,
  };
}

describe('源码模式保存（DEV-020）', () => {
  it('逐字节写回编辑框文本，不做 Markdown 规范化', async () => {
    const write = vi.fn(async () => ({
      path: 'a.md',
      name: 'a.md',
      kind: 'file' as const,
      size: 3,
      modifiedAt: 't2',
    }));
    const raw = '---\nid: 1\n---\n\n# A\r\n\n*  item\n\n\n';
    const result = await saveSourceText({
      io: io({ write }),
      path: 'a.md',
      text: raw,
      baseVersion: { modifiedAt: 't1', size: 1 },
    });

    expect(write).toHaveBeenCalledWith('a.md', raw);
    expect(result.kind).toBe('saved');
  });

  it('首个 H1 改名：先改名（连带 wikilink）再写入新路径', async () => {
    const renameLinked = vi.fn(async () => undefined);
    const write = vi.fn(async (path: string) => ({
      path,
      name: path,
      kind: 'file' as const,
      size: 5,
      modifiedAt: 't2',
    }));
    const result = await saveSourceText({
      io: io({ renameLinked, write, exists: async () => false }),
      path: 'notes/旧名.md',
      text: '# 新名\n\n正文\n',
      baseVersion: { modifiedAt: 't1', size: 1 },
    });

    expect(renameLinked).toHaveBeenCalledWith('notes/旧名.md', 'notes/新名.md');
    expect(write).toHaveBeenCalledWith('notes/新名.md', '# 新名\n\n正文\n');
    expect(result).toMatchObject({ kind: 'saved', path: 'notes/新名.md', title: '新名' });
  });

  it('改名目标已存在时报错，不写入也不改名', async () => {
    const renameLinked = vi.fn();
    const write = vi.fn();
    await expect(
      saveSourceText({
        io: io({ exists: async () => true, renameLinked, write }),
        path: 'a.md',
        text: '# b\n',
        baseVersion: { modifiedAt: 't1', size: 1 },
      }),
    ).rejects.toThrow(/已存在/);
    expect(renameLinked).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('写入前版本检查发现外部改动：返回 conflict 且不落盘', async () => {
    const write = vi.fn();
    const result = await saveSourceText({
      io: io({
        write,
        stat: async () => ({
          path: 'a.md',
          name: 'a.md',
          kind: 'file',
          size: 9,
          modifiedAt: 't9',
        }),
      }),
      path: 'a.md',
      text: '# a\n',
      baseVersion: { modifiedAt: 't1', size: 1 },
    });

    expect(result).toMatchObject({ kind: 'conflict' });
    expect(write).not.toHaveBeenCalled();
  });

  it('首次保存（baseVersion 为空）不触发冲突', async () => {
    const result = await saveSourceText({
      io: io(),
      path: 'a.md',
      text: '# a\n',
      baseVersion: null,
    });
    expect(result.kind).toBe('saved');
  });
});

describe('外部变更分类（写入前版本检查）', () => {
  const base = { modifiedAt: 't1', size: 10 };

  it('版本一致视为无变化', async () => {
    const result = await classifyExternalChange({
      io: io({
        stat: async () => ({
          path: 'a.md',
          name: 'a.md',
          kind: 'file',
          size: 10,
          modifiedAt: 't1',
        }),
      }),
      path: 'a.md',
      baseVersion: base,
      baseText: 'baseline',
      dirty: true,
    });
    expect(result.kind).toBe('unchanged');
  });

  it('保存后 mtime 抖动但磁盘文本仍是基线时视为自身写入', async () => {
    const result = await classifyExternalChange({
      io: io({
        read: async () => 'baseline',
        stat: async () => ({ path: 'a.md', name: 'a.md', kind: 'file', size: 20, modifiedAt: 't2' }),
      }),
      path: 'a.md',
      baseVersion: base,
      baseText: 'baseline',
      dirty: true,
    });
    expect(result.kind).toBe('unchanged');
  });


  it('无本地修改时直接重载', async () => {
    const result = await classifyExternalChange({
      io: io({
        stat: async () => ({
          path: 'a.md',
          name: 'a.md',
          kind: 'file',
          size: 20,
          modifiedAt: 't2',
        }),
      }),
      path: 'a.md',
      baseVersion: base,
      baseText: 'baseline',
      dirty: false,
    });
    expect(result).toMatchObject({ kind: 'reload', version: { modifiedAt: 't2', size: 20 } });
  });

  it('存在未保存源码时报告冲突，不自动覆盖', async () => {
    const result = await classifyExternalChange({
      io: io({
        stat: async () => ({
          path: 'a.md',
          name: 'a.md',
          kind: 'file',
          size: 20,
          modifiedAt: 't2',
        }),
      }),
      path: 'a.md',
      baseVersion: base,
      baseText: 'baseline',
      dirty: true,
    });
    expect(result).toMatchObject({ kind: 'conflict' });
  });

  it('文件已被删除时不报冲突（交给 tab 关闭流程）', async () => {
    const result = await classifyExternalChange({
      io: io({ stat: async () => null }),
      path: 'a.md',
      baseVersion: base,
      baseText: 'baseline',
      dirty: true,
    });
    expect(result.kind).toBe('unchanged');
  });
});

describe('文件版本比较', () => {
  it('mtime 与 size 同时相同才算同一版本', () => {
    expect(sameVersion({ modifiedAt: 't', size: 1 }, { modifiedAt: 't', size: 1 })).toBe(true);
    expect(sameVersion({ modifiedAt: 't', size: 1 }, { modifiedAt: 't', size: 2 })).toBe(false);
    expect(sameVersion(null, { modifiedAt: 't', size: 1 })).toBe(false);
  });

  it('fileVersionOf 从 FileInfo 抽取版本', () => {
    expect(fileVersionOf({ path: 'a', name: 'a', kind: 'file', size: 4, modifiedAt: 'x' })).toEqual(
      { modifiedAt: 'x', size: 4 },
    );
    expect(fileVersionOf(null)).toBeNull();
  });
});
