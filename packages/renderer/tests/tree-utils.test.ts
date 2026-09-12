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
    let entries = [
      d('a.md', 'file'),
      d('sub', 'directory'),
      d('sub/x.md', 'file'),
      d('sub/y.md', 'file'),
      d('other.md', 'file'),
    ];
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
    let entries = [
      d('sub', 'directory'),
      d('sub/x.md', 'file'),
      d('sub2', 'directory'),
      d('sub2/y.md', 'file'),
    ];
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
    const {
      tree: t,
      matchedFiles,
      expandDirs,
    } = filterTree(tree(), { query: 'alp', tagFiles: null });
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

  it('过滤搜索使用后缀显示开关', () => {
    const roots = buildTree([{ name: '笔记.markdown', path: '笔记.markdown', kind: 'file' }]);
    expect(filterTree(roots, { query: 'markdown', tagFiles: null }).matchedFiles.size).toBe(0);
    expect(
      filterTree(roots, { query: 'markdown', tagFiles: null, showExtensions: true }).matchedFiles
        .size,
    ).toBe(1);
  });

  it('过滤时空目录被隐藏', () => {
    const { tree: t } = filterTree(tree(), { query: 'alpha', tagFiles: null });
    expect(t.some((n) => n.path === 'empty')).toBe(false);
  });
});

describe('杂项', () => {
  it('displayName 按开关处理 Markdown，其他格式始终保留后缀', () => {
    for (const showExtensions of [false, true]) {
      expect(displayName({ name: '笔记.md', kind: 'file' }, { showExtensions })).toBe(
        showExtensions ? '笔记.md' : '笔记',
      );
      expect(displayName({ name: '文档.markdown', kind: 'file' }, { showExtensions })).toBe(
        showExtensions ? '文档.markdown' : '文档',
      );
      expect(displayName({ name: '文档.docx', kind: 'file' }, { showExtensions })).toBe(
        '文档.docx',
      );
      expect(displayName({ name: '附件.png', kind: 'file' }, { showExtensions })).toBe('附件.png');
    }
    expect(displayName({ name: '笔记.md', kind: 'file' })).toBe('笔记');
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

describe('applyFsChangeEvent sidecar format 携带', () => {
  it('add 事件携带 format 时写入条目；未携带时缺省（legacy → native-block 兼容）', () => {
    const withFormat = applyFsChangeEvent([], { kind: 'add', path: '新页.md', format: 'markdown' });
    expect(withFormat).toEqual([
      { name: '新页.md', path: '新页.md', kind: 'file', format: 'markdown' },
    ]);
    const legacy = applyFsChangeEvent([], { kind: 'add', path: '旧页.md' });
    expect(legacy).toEqual([{ name: '旧页.md', path: '旧页.md', kind: 'file' }]);
    expect(legacy[0]?.format).toBeUndefined();
  });

  it('rename（unlink + add）携带原条目 format，重命名后不丢格式', () => {
    let entries = applyFsChangeEvent([], { kind: 'add', path: '旧名.md', format: 'markdown' });
    entries = applyFsChangeEvent(entries, { kind: 'unlink', path: '旧名.md' });
    entries = applyFsChangeEvent(entries, { kind: 'add', path: '新名.md', format: 'markdown' });
    expect(entries).toEqual([
      { name: '新名.md', path: '新名.md', kind: 'file', format: 'markdown' },
    ]);
  });

  it('addDir 事件不携带 format', () => {
    const entries = applyFsChangeEvent([], { kind: 'addDir', path: '目录' });
    expect(entries).toEqual([{ name: '目录', path: '目录', kind: 'directory' }]);
  });
});
