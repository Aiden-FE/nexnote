
import { useEffect, useMemo } from 'react';
import { Tags, X } from 'lucide-react';
import { sidebarPanelRegistry } from '../../../registries';
import { useIndexStore } from '../../../stores/index-store';
import { useTagStore } from '../../../stores/tag-store';
import { usePageTreeStore } from '../../../stores/page-tree-store';
import { invoke } from '../../../lib/ipc';
import { cn } from '../../../lib/utils';

/**
 * 标签面板（DEV-004 索引驱动版）：index:tags 读取计数 + 嵌套树。
 * 点击标签 → 用 index:search(tag:) 拉取含该标签的页面并过滤页面树。
 * 索引不可用时回退 DEV-003 的 fs:scanTags。
 */
sidebarPanelRegistry.register({
  id: 'tags',
  title: '标签',
  icon: Tags,
  render: TagsPanel,
});

function TagsPanel() {
  const entries = useIndexStore((s) => s.tags);
  const indexStatus = useIndexStore((s) => s.status.phase);
  const legacyStats = useTagStore((s) => s.stats);
  const legacyStatus = useTagStore((s) => s.status);
  const legacyError = useTagStore((s) => s.error);
  const activeTag = usePageTreeStore((s) => s.tagFilter);
  const loadIndexTags = useIndexStore((s) => s.loadTags);

  useEffect(() => {
    void loadIndexTags();
  }, [loadIndexTags]);

  // 索引不可用（错误/未就绪）→ 回退 fs:scanTags 数据
  const useLegacy = indexStatus === 'error' || (indexStatus !== 'ready' && legacyStatus === 'ready');

  const items = useMemo(() => {
    if (!useLegacy) {
      return entries
        .filter((e) => !e.isIntermediate)
        .sort((a, b) => b.pageCount - a.pageCount || a.tag.localeCompare(b.tag));
    }
    return legacyStats
      .map((s) => ({ tag: s.tag, pageCount: s.files.length, path: s.tag.split('/') }))
      .sort((a, b) => b.pageCount - a.pageCount || a.tag.localeCompare(b.tag));
  }, [useLegacy, entries, legacyStats]);

  const filesFor = async (tag: string): Promise<string[]> => {
    if (!useLegacy) {
      try {
        return await invoke('index:tagPages', { tag });
      } catch {
        // fallthrough to legacy
      }
    }
    return legacyStats.find((s) => s.tag === tag)?.files ?? [];
  };

  const toggle = (tag: string): void => {
    const tree = usePageTreeStore.getState();
    if (tree.tagFilter === tag) {
      tree.setTagFilter(null, null);
    } else {
      void filesFor(tag).then((files) => tree.setTagFilter(tag, files));
    }
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
        {items.length === 0 && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            还没有标签。在笔记 frontmatter 写 tags: [xxx] 或正文用 #xxx 即可聚合到此处。
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {items.map((s) => {
            const active = activeTag === s.tag;
            return (
              <button
                key={s.tag}
                type="button"
                data-testid="tag-chip"
                data-tag={s.tag}
                data-active={active}
                onClick={() => toggle(s.tag)}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                  active
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'bg-muted/60 text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                #{s.tag}
                <span className="text-[9px] opacity-60">{s.pageCount}</span>
                {active && <X className="size-2.5" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
