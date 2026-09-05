import { useMemo } from 'react';
import { Tags, X } from 'lucide-react';
import { sidebarPanelRegistry } from '../../../registries';
import { useTagStore } from '../../../stores/tag-store';
import { usePageTreeStore } from '../../../stores/page-tree-store';
import { cn } from '../../../lib/utils';

/**
 * 标签面板（DEV-003 基础版）：fs:scanTags 聚合（frontmatter tags + 内联 #tag）。
 * 点击标签 → 过滤页面树；再次点击取消。DEV-004 索引完成后换数据源。
 */
sidebarPanelRegistry.register({
  id: 'tags',
  title: '标签',
  icon: Tags,
  render: TagsPanel,
});

function TagsPanel() {
  const stats = useTagStore((s) => s.stats);
  const status = useTagStore((s) => s.status);
  const error = useTagStore((s) => s.error);
  const activeTag = usePageTreeStore((s) => s.tagFilter);

  const sorted = useMemo(
    () => [...stats].sort((a, b) => b.files.length - a.files.length || a.tag.localeCompare(b.tag)),
    [stats],
  );

  const toggle = (tag: string, files: string[]): void => {
    const tree = usePageTreeStore.getState();
    if (tree.tagFilter === tag) tree.setTagFilter(null, null);
    else tree.setTagFilter(tag, files);
  };

  return (
    <div data-testid="sidebar-panel-tags" className="flex h-full min-h-0 flex-col">
      <p className="mb-2 shrink-0 text-[10px] text-muted-foreground">
        全库标签 · frontmatter + 内联 #tag{status === 'loading' && '（扫描中…）'}
      </p>
      {status === 'error' && (
        <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          扫描失败：{error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {sorted.length === 0 && status !== 'loading' && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            还没有标签。在笔记 frontmatter 写 tags: [xxx] 或正文用 #xxx 即可聚合到此处。
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {sorted.map((s) => {
            const active = activeTag === s.tag;
            return (
              <button
                key={s.tag}
                type="button"
                data-testid="tag-chip"
                data-tag={s.tag}
                data-active={active}
                onClick={() => toggle(s.tag, s.files)}
                title={s.files.map((f) => f.replace(/\.md$/i, '')).join('\n')}
                className={cn(
                  'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                  active
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'bg-muted/60 text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                #{s.tag}
                <span className="text-[9px] opacity-60">{s.files.length}</span>
                {active && <X className="size-2.5" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
