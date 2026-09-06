import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Tags, X } from 'lucide-react';
import { sidebarPanelRegistry } from '../../../registries';
import { useIndexStore } from '../../../stores/index-store';
import { useTagStore } from '../../../stores/tag-store';
import { usePageTreeStore } from '../../../stores/page-tree-store';
import { useUiStore } from '../../../stores/ui-store';
import { invoke } from '../../../lib/ipc';
import { cn } from '../../../lib/utils';
import { useVault } from '../../../shell/vault-context';
import { buildTagTree, type TagNode } from './tree';

/**
 * 标签面板（DEV-004 索引驱动版）：index:tags 读取计数 + 嵌套树。
 * 点击标签 → index:tagPages 拉取该标签（含子树）的页面并过滤页面树。
 * 索引不可用时回退 DEV-003 的 fs:scanTags。
 */
sidebarPanelRegistry.register({
  id: 'tags',
  title: '标签',
  icon: Tags,
  render: TagsPanel,
});

export function TagsPanel() {
  const vault = useVault();
  const entries = useIndexStore((s) => s.tags);
  const indexStatus = useIndexStore((s) => s.status.phase);
  const legacyStats = useTagStore((s) => s.stats);
  const legacyStatus = useTagStore((s) => s.status);
  const legacyError = useTagStore((s) => s.error);
  const activeTag = usePageTreeStore((s) => s.tagFilter);
  const loadIndexTags = useIndexStore((s) => s.loadTags);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const tagRequest = useRef(0);

  useEffect(() => {
    tagRequest.current += 1; // invalidate pending tagPages from the previous vault/session
    void loadIndexTags();
    return () => { tagRequest.current += 1; };
  }, [loadIndexTags, vault?.root]);

  // 索引不可用（错误/未就绪）→ 回退 fs:scanTags 数据
  const useLegacy = indexStatus === 'error' || (indexStatus !== 'ready' && legacyStatus === 'ready');
  const tree = useMemo(() => buildTagTree(
    useLegacy
      ? legacyStats.map((s) => ({ tag: s.tag, pageCount: s.files.length, descendantPageCount: s.files.length, path: s.tag.split('/') }))
      : entries,
  ), [useLegacy, entries, legacyStats]);

  const filesFor = async (tag: string): Promise<string[]> => {
    if (!useLegacy) {
      try {
        return await invoke('index:tagPages', { tag });
      } catch {
        // fall through to the legacy data below
      }
    }
    return legacyStats.filter((s) => s.tag === tag || s.tag.startsWith(`${tag}/`)).flatMap((s) => s.files);
  };

  const openTagResults = (tag: string): void => {
    const pageTree = usePageTreeStore.getState();
    if (pageTree.tagFilter === tag) {
      tagRequest.current += 1;
      pageTree.setTagFilter(null, null);
      return;
    }
    const request = ++tagRequest.current;
    void filesFor(tag).then((files) => {
      // A later tag click owns the UI; never let an older promise overwrite it.
      if (request !== tagRequest.current) return;
      const paths = [...new Set(files)].sort();
      pageTree.setTagFilter(tag, paths); // optional tree filter stays in sync with search route
      useUiStore.getState().showTagSearch(tag, paths);
    });
  };

  const toggleExpanded = (tag: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  return (
    <div data-testid="sidebar-panel-tags" className="flex h-full min-h-0 flex-col">
      <p className="mb-2 shrink-0 text-[10px] text-muted-foreground">
        全库标签 · {useLegacy ? '文件扫描（索引未就绪）' : 'Link Index 索引驱动'}
      </p>
      {useLegacy && legacyStatus === 'error' && (
        <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          扫描失败：{legacyError}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {tree.length === 0 && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            还没有标签。在笔记 frontmatter 写 tags: [xxx] 或正文用 #xxx 即可聚合到此处。
          </p>
        )}
        <TagTree
          nodes={tree}
          activeTag={activeTag}
          expanded={expanded}
          onToggleExpanded={toggleExpanded}
          onToggleFilter={openTagResults}
        />
      </div>
    </div>
  );
}

function TagTree({ nodes, activeTag, expanded, onToggleExpanded, onToggleFilter }: {
  nodes: TagNode[];
  activeTag: string | null;
  expanded: Set<string>;
  onToggleExpanded: (tag: string) => void;
  onToggleFilter: (tag: string) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const open = expanded.has(node.fullPath);
        const active = activeTag === node.fullPath;
        const count = hasChildren ? node.descPageCount : node.pageCount;
        return (
          <li key={node.fullPath}>
            <div className="flex items-center" style={{ paddingLeft: `${Math.max(0, node.fullPath.split('/').length - 1) * 12}px` }}>
              {hasChildren ? (
                <button
                  type="button"
                  data-testid="tag-expand"
                  data-tag={node.fullPath}
                  data-open={open}
                  aria-label={`${open ? '折叠' : '展开'} #${node.fullPath}`}
                  onClick={() => onToggleExpanded(node.fullPath)}
                  className="mr-0.5 rounded p-0.5 text-muted-foreground hover:bg-accent"
                >
                  <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
                </button>
              ) : <span className="mr-0.5 inline-block size-4" />}
              <button
                type="button"
                data-testid="tag-node"
                data-tag={node.fullPath}
                data-active={active}
                onClick={() => onToggleFilter(node.fullPath)}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-0.5 text-left text-[11px] transition-colors',
                  active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <span className="truncate">#{node.name}</span>
                <span data-testid="tag-count" className="ml-auto text-[9px] opacity-60">{count}</span>
                {active && <X className="size-2.5" />}
              </button>
            </div>
            {hasChildren && open && (
              <TagTree nodes={node.children} activeTag={activeTag} expanded={expanded} onToggleExpanded={onToggleExpanded} onToggleFilter={onToggleFilter} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
