import { Link2 } from 'lucide-react';
import { sidebarPanelRegistry } from '../../../registries';

/**
 * 反向链接面板（DEV-003 占位）：UI 骨架 + 假数据。
 * DEV-004 关系索引完成后接入真实回链数据（含别名解析）。
 */
sidebarPanelRegistry.register({
  id: 'backlinks',
  title: '反向链接',
  icon: Link2,
  render: BacklinksPanel,
});

const FAKE_BACKLINKS = [
  { from: '产品架构.md', snippet: '…信息架构见 [[003-页面树]]…' },
  { from: '研究/竞品分析.md', snippet: '…与 Obsidian 的页面树对齐（[[003-页面树]]）…' },
];

function BacklinksPanel() {
  return (
    <div data-testid="sidebar-panel-backlinks" className="flex h-full min-h-0 flex-col">
      <p className="mb-2 shrink-0 text-[10px] text-muted-foreground">
        当前页面的入链 · DEV-004 关系索引接入真实数据（当前为示例）
      </p>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-auto">
        {FAKE_BACKLINKS.map((b) => (
          <div
            key={b.from}
            data-testid="backlink-item"
            className="rounded-md border bg-card px-2.5 py-2 text-xs"
          >
            <p className="mb-1 font-medium text-foreground">{b.from}</p>
            <p className="leading-relaxed text-muted-foreground">{b.snippet}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
