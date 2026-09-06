import type { TagIndexEntry } from '@nexnote/shared';

/**
 * 把扁平标签条目（含中间节点）构造成 `/` 分层嵌套树。
 * 叶节点（isIntermediate=false）直接命中；中间节点聚合其后代的页面数。
 * 所有祖先前缀节点必须已存在（index:tags 已保证），否则会缺父层。
 */
export interface TagNode {
  fullPath: string;
  name: string;
  pageCount: number;
  descPageCount: number;
  isLeaf: boolean;
  children: TagNode[];
}

export function buildTagTree(entries: TagIndexEntry[]): TagNode[] {
  const nodes = new Map<string, TagNode>();
  const byParent = new Map<string, TagNode[]>();

  const register = (parentKey: string, node: TagNode): void => {
    const arr = byParent.get(parentKey) ?? [];
    arr.push(node);
    byParent.set(parentKey, arr);
  };

  for (const e of entries) {
    const name = e.path[e.path.length - 1] ?? e.tag;
    const node: TagNode = {
      fullPath: e.tag,
      name,
      pageCount: e.pageCount,
      descPageCount: e.descendantPageCount,
      isLeaf: !e.isIntermediate,
      children: [],
    };
    nodes.set(e.tag, node);
    if (e.path.length <= 1) {
      register('', node);
    } else {
      register(e.path.slice(0, -1).join('/'), node);
    }
  }

  const build = (parentKey: string): TagNode[] => {
    const arr = byParent.get(parentKey) ?? [];
    return arr
      .map((node) => {
        node.children = build(node.fullPath);
        // A tag can be both directly assigned and a parent of nested tags.
        // Tree shape, rather than the optional index hint, determines leaf UI.
        node.isLeaf = node.children.length === 0;
        return node;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  return build('');
}

/** 展开/折叠逻辑用的默认展开层级：保留所有已有分支. */
export function isAncestorOf(prefix: string, fullPath: string): boolean {
  return fullPath === prefix || fullPath.startsWith(`${prefix}/`);
}
