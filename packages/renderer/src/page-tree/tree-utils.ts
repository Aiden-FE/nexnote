import type { DirEntry } from '@nexnote/shared';

/**
 * 页面树纯函数（可单测）：扁平 DirEntry 列表 ↔ 树结构、搜索过滤、标签过滤。
 * 路径均为 vault 相对路径（'/' 分隔，根为 ''）。
 */

export interface TreeNode {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children: TreeNode[];
}

export function parentPath(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? '' : relPath.slice(0, idx);
}

export function isMarkdown(name: string): boolean {
  return name.toLowerCase().endsWith('.md') || name.toLowerCase().endsWith('.markdown');
}

export function isDocx(name: string): boolean {
  return name.toLowerCase().endsWith('.docx');
}

/** 文件显示名；默认隐藏 Markdown 后缀，其他格式始终保留后缀。 */
export function displayName(
  node: { name: string; kind: 'file' | 'directory' },
  options: { showExtensions?: boolean } = {},
): string {
  return node.kind === 'file' && !options.showExtensions && isMarkdown(node.name)
    ? node.name.replace(/\.(?:md|markdown)$/i, '')
    : node.name;
}

/** 扁平列表 → 树。输入含目录与（已按 showAllFiles 过滤的）文件；孤儿节点自动挂到最近存在的祖先。 */
export function buildTree(entries: DirEntry[]): TreeNode[] {
  const dirMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  // 先建目录骨架（保证父先于子插入）
  for (const e of entries) {
    if (e.kind === 'directory') dirMap.set(e.path, { ...e, children: [] });
  }
  for (const e of entries) {
    const node: TreeNode = e.kind === 'directory' ? dirMap.get(e.path)! : { ...e, children: [] };
    const parent = dirMap.get(parentPath(e.path));
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  sortTree(roots);
  return roots;
}

/** 目录在前、同层按名称（本地化）排序。 */
export function sortTree(nodes: TreeNode[]): TreeNode[] {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true });
  });
  for (const n of nodes) sortTree(n.children);
  return nodes;
}

/**
 * 应用 fs:changed 增量事件到扁平列表（避免每次事件全量重拉）。
 * 返回新数组（不可变更新）；目录的 addDir/unlinkDir 不级联其子项——
 * chokidar 会为子项各自推送事件。
 */
export function applyFsChangeEvent(
  entries: DirEntry[],
  event: {
    kind: 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change';
    path: string;
  },
): DirEntry[] {
  const name = event.path.slice(event.path.lastIndexOf('/') + 1);
  if (event.kind === 'add' || event.kind === 'addDir') {
    if (entries.some((e) => e.path === event.path)) return entries;
    const next = [
      ...entries,
      {
        name,
        path: event.path,
        kind: event.kind === 'addDir' ? ('directory' as const) : ('file' as const),
      },
    ];
    return next;
  }
  if (event.kind === 'unlink' || event.kind === 'unlinkDir') {
    // unlinkDir：目录可能已带着未及推送的子项消失，前缀过滤一并清掉
    const prefix = `${event.path}/`;
    return entries.filter((e) => e.path !== event.path && !e.path.startsWith(prefix));
  }
  // change：内容变化不影响树结构
  return entries;
}

export interface FilterOptions {
  /** 搜索词（对显示名做大小写不敏感子串匹配） */
  query: string;
  /** 标签过滤：仅显示这些文件（vault 相对路径集合）+ 其祖先目录 */
  tagFiles: Set<string> | null;
  /** 是否显示文件扩展名 */
  showExtensions?: boolean;
}

/**
 * 过滤树：保留命中节点；目录只要子树有命中即保留（搜索时可自动展开暴露命中）。
 * 返回过滤后的树与「因搜索而应强制展开的目录路径集合」。
 */
export function filterTree(
  roots: TreeNode[],
  { query, tagFiles, showExtensions = false }: FilterOptions,
): { tree: TreeNode[]; matchedFiles: Set<string>; expandDirs: Set<string> } {
  const q = query.trim().toLowerCase();
  const filtering = q.length > 0 || tagFiles !== null;
  const matchedFiles = new Set<string>();
  const expandDirs = new Set<string>();

  const walk = (node: TreeNode): TreeNode | null => {
    const children = node.children.map(walk).filter((c): c is TreeNode => c !== null);
    if (node.kind === 'file') {
      const nameHit =
        q.length === 0 || displayName(node, { showExtensions }).toLowerCase().includes(q);
      const tagHit = tagFiles === null || tagFiles.has(node.path);
      if (nameHit && tagHit) {
        matchedFiles.add(node.path);
        return { ...node, children: [] };
      }
      return null;
    }
    // 目录：搜索命中目录名也视为命中（展开其全部子树）
    const selfHit = q.length > 0 && node.name.toLowerCase().includes(q) && tagFiles === null;
    if (selfHit) {
      collectFiles(node, matchedFiles);
      return node;
    }
    if (children.length > 0) {
      // 仅在过滤时才需要强制展开祖先以暴露命中节点
      if (filtering) expandDirs.add(node.path);
      return { ...node, children };
    }
    // 空目录：仅在无任何过滤时保留
    if (!filtering) return node;
    return null;
  };

  return {
    tree: roots.map(walk).filter((n): n is TreeNode => n !== null),
    matchedFiles,
    expandDirs,
  };
}

function collectFiles(node: TreeNode, out: Set<string>): void {
  if (node.kind === 'file') out.add(node.path);
  for (const c of node.children) collectFiles(c, out);
}

/** 页面路径 → 面包屑段（vault 名由调用方拼在最前）。 */
export function breadcrumbSegments(pagePath: string): string[] {
  const parts = pagePath.split('/').filter((p) => p.length > 0);
  const last = parts.pop();
  const dirs = parts;
  const leaf = last ? last.replace(/\.md$/i, '') : '';
  return [...dirs, leaf].filter((s) => s.length > 0);
}
