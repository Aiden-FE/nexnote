import { FolderTree, Link2, Tags } from 'lucide-react';
import { sidebarPanelRegistry } from '../../registries';

/**
 * 侧栏内置面板（占位）。
 * DEV-003：页面树面板在此替换/新增；DEV-004：反向链接与标签面板接入真实数据。
 * 模式：新增文件 + register + 在 features/bootstrap.ts import，不动核心壳组件。
 */

sidebarPanelRegistry.register({
  id: 'pages',
  title: '页面',
  icon: FolderTree,
  render: PagesPlaceholder,
});

sidebarPanelRegistry.register({
  id: 'backlinks',
  title: '反向链接',
  icon: Link2,
  render: BacklinksPlaceholder,
});

sidebarPanelRegistry.register({
  id: 'tags',
  title: '标签',
  icon: Tags,
  render: TagsPlaceholder,
});

function PagesPlaceholder() {
  return (
    <div data-testid="sidebar-panel-pages" className="space-y-1.5 text-muted-foreground">
      <p className="mb-3 text-xs leading-relaxed">
        页面树将在 <span className="font-medium text-foreground">DEV-003</span> 接入（文件夹 → .md
        文件的树形视图、右键菜单、拖拽移动）。
      </p>
      {[72, 88, 60, 96, 48].map((w, i) => (
        <div
          key={i}
          className="flex items-center gap-1.5"
          style={{ paddingLeft: `${(i % 3) * 14}px` }}
        >
          <div className="h-1.5 rounded-full bg-muted-foreground/25" style={{ width: `${w}px` }} />
        </div>
      ))}
    </div>
  );
}

function BacklinksPlaceholder() {
  return (
    <div data-testid="sidebar-panel-backlinks" className="space-y-2 text-muted-foreground">
      <p className="text-xs leading-relaxed">
        反向链接面板将在 <span className="font-medium text-foreground">DEV-004</span>{' '}
        接入（关系索引驱动，支持别名解析）。
      </p>
      <div className="rounded-md border border-dashed px-3 py-4 text-center text-[11px]">
        当前页面暂无引用
      </div>
    </div>
  );
}

function TagsPlaceholder() {
  return (
    <div data-testid="sidebar-panel-tags" className="text-muted-foreground">
      <p className="mb-3 text-xs leading-relaxed">
        标签面板将在 <span className="font-medium text-foreground">DEV-003/004</span>{' '}
        接入（frontmatter tags + 内联 #tag 聚合）。
      </p>
      <div className="flex flex-wrap gap-1.5">
        {['占位', 'inbox', 'draft'].map((t) => (
          <span key={t} className="rounded-full border bg-muted/60 px-2 py-0.5 text-[11px]">
            #{t}
          </span>
        ))}
      </div>
    </div>
  );
}
