
import { Database } from 'lucide-react';
import { statusBarRegistry } from '../../registries';
import { useIndexStore } from '../../stores/index-store';

/**
 * 状态栏索引条目（DEV-004）：扫描进度 / ready 页面数 / 错误。
 */
statusBarRegistry.register({ id: 'index', align: 'left', render: IndexStatusItem });

function IndexStatusItem() {
  const status = useIndexStore((s) => s.status);
  if (status.phase === 'idle') return null;
  const label =
    status.phase === 'scanning'
      ? `索引中 ${status.pagesIndexed}/${status.pagesTotal}`
      : status.phase === 'error'
        ? '索引错误'
        : `索引就绪`;
  return (
    <span
      className="flex items-center gap-1.5"
      data-testid="status-index"
      title={status.error ?? `Link Index · ${status.mode}`}
    >
      <Database className="size-3.5" />
      {label}
    </span>
  );
}
