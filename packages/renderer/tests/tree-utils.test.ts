import { describe, expect, it } from 'vitest';
import type { DirEntry } from '@nexnote/shared';
import {
  applyFsChangeEvent,
  breadcrumbSegments,
  buildTree,
  displayName,
  filterTree,
  parentPath,
} from '../src/page-tree/tree-utils';

const d = (path: string, kind: 'file' | 'directory'): DirEntry => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  kind,
});

describe('buildTree', () => {
  it('扁平列表组树：目录在前、同层排序', () => {
    const tree = buildTree([
      d('z.md', 'file'),
      d('adir', 'directory'),
      d('adir/x.md', 'file'),
      d('a.md', 'file'),
      d('bdir', 'directory'),
    ]);
    expect(tree.map((n) => n.path)).toEqual(['adir', 'bdir', 'a.md', 'z.md']);
    expect(tree[0]?.children.map((c) => c.path)).toEqual(['adir/x.md']);
  });

  it('孤儿文件（目录缺失）挂到根而不是丢失', () => {
    const tree = buildTree([d('ghost/x.md', 'file')]);
    expect(tree.map((n) => n.path)).toEqual(['ghost/x.md']);
  });
});

describe('applyFsChangeEvent（fs:changed 增量）', () => {
  it('add / addDir 追加（不重复）', () => {
    let entries = [d('a.md', 'file')];
    entries = applyFsChangeEvent(entries, { kind: 'add', path: 'b.md' });
    entries = applyFsChangeEvent(entries, { kind: 'add', path: 'b.md' });
    entries = applyFsChangeEvent(entries, { kind: 'addDir', path: 'sub' });
    expect(entries.map((e) => e.path)).toEqual(['a.md', 'b.md', 'sub']);
    expect(entries.find((e) => e.path === 'sub')?.kind).toBe('directory');
  });

  it('unlink 移除；unlinkDir 连带移除子项（前缀）', () => {
    let entries = [d('a.md', 'file'), d('sub', 'directory'), d('sub/x.md', 'file'), d('sub/y.md', 'file'), d('other.md', 'file')];
    entries = applyFsChangeEvent(entries, { kind: 'unlink', path: 'a.md' });
    expect(entries.some((e) => e.path === 'a.md')).toBe(false);
    entries = applyFsChangeEvent(entries, { kind: 'unlinkDir', path: 'sub' });
    expect(entries.map((e) => e.path)).toEqual(['other.md']);
  });

  it('change 不改变结构（返回原数组引用）', () => {
    const entries = [d('a.md', 'file')];
    expect(applyFsChangeEvent(entries, { kind: 'change', path: 'a.md' })).toBe(entries);
  });

  it('同名前缀目录不受兄弟路径误伤（sub 与 sub2）', () => {
    let entries = [d('sub', 'directory'), d('sub/x.md', 'file'), d('sub2', 'directory'), d('sub2/y.md', 'file')];
    entries = applyFsChangeEvent(entries, { kind: 'unlinkDir', path: 'sub' });
    expect(entries.map((e) => e.path).sort()).toEqual(['sub2', 'sub2/y.md']);
  });
});

describe('filterTree', () => {
  const tree = () =>
    buildTree([
      d('dir', 'directory'),
      d('dir/alpha.md', 'file'),
      d('dir/beta.md', 'file'),
      d('root-note.md', 'file'),
      d('assets', 'directory'),
      d('empty', 'directory'),
    ]);

  it('无过滤原样返回（含空目录），全部文件计入 matched', () => {
    const { tree: t, matchedFiles, expandDirs } = filterTree(tree(), { query: '', tagFiles: null });
    expect(t.length).toBe(4);
    expect(matchedFiles.size).toBe(3);
    expect(expandDirs.size).toBe(0);
  });

  it('搜索：匹配文件名、祖先目录保留并强制展开', () => {
    const { tree: t, matchedFiles, expandDirs } = filterTree(tree(), { query: 'alp', tagFiles: null });
    expect(matchedFiles).toEqual(new Set(['dir/alpha.md']));
    expect(expandDirs.has('dir')).toBe(true);
    const dir = t.find((n) => n.path === 'dir');
    expect(dir?.children.map((c) => c.path)).toEqual(['dir/alpha.md']);
  });

  it('搜索命中目录名时保留整个子树', () => {
    const { matchedFiles } = filterTree(tree(), { query: 'dir', tagFiles: null });
    expect(matchedFiles.has('dir/alpha.md')).toBe(true);
    expect(matchedFiles.has('dir/beta.md')).toBe(true);
    expect(matchedFiles.has('root-note.md')).toBe(false);
  });

  it('标签过滤：仅保留集合内文件与祖先', () => {
    const { matchedFiles } = filterTree(tree(), {
      query: '',
      tagFiles: new Set(['dir/beta.md']),
    });
    expect(matchedFiles).toEqual(new Set(['dir/beta.md']));
  });

  it('搜索与标签叠加为交集', () => {
    const { matchedFiles } = filterTree(tree(), {
      query: 'alpha',
      tagFiles: new Set(['dir/beta.md']),
    });
    expect(matchedFiles.size).toBe(0);
  });

  it('过滤时空目录被隐藏', () => {
    const { tree: t } = filterTree(tree(), { query: 'alpha', tagFiles: null });
    expect(t.some((n) => n.path === 'empty')).toBe(false);
  });
});

describe('杂项', () => {
  it('displayName 去 .md 后缀（仅 .md 文件）', () => {
    expect(displayName({ name: '笔记.md', kind: 'file' })).toBe('笔记');
    expect(displayName({ name: '附件.png', kind: 'file' })).toBe('附件.png');
    expect(displayName({ name: '目录', kind: 'directory' })).toBe('目录');
  });

  it('parentPath', () => {
    expect(parentPath('a.md')).toBe('');
    expect(parentPath('x/y/a.md')).toBe('x/y');
  });

  it('breadcrumbSegments', () => {
    expect(breadcrumbSegments('x/y/a.md')).toEqual(['x', 'y', 'a']);
    expect(breadcrumbSegments('a.md')).toEqual(['a']);
  });
});
