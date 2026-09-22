import { useEffect } from 'react';
import { invoke } from '../lib/ipc';
import { useTabStore, isBinaryKind, type TabDescriptor } from '../stores/tab-store';

/**
 * DEV-074 二进制 tab 容器（docx / xlsx / mindmap）。
 * 真正的编辑器运行在独立 WebContentsView（主进程管理）；本组件：
 * - tab 激活时通知主进程 setActive（确保宿主满铺内容区、其余宿主隐藏）；
 * - 挂载时打开宿主、卸载（关闭 tab）时通知主进程 flush + 回收；
 * - 自身渲染一个占位（宿主 WebContentsView 悬浮在其上）。
 */
export function BinaryTabView({ tab }: { tab: TabDescriptor }): React.JSX.Element {
  const activeTabId = useTabStore((state) => state.activeTabId);
  const isActive = activeTabId === tab.id;

  const kind = isBinaryKind(tab.kind) ? tab.kind : null;
  const path = tab.pagePath ?? '';

  useEffect(() => {
    if (!kind || !path) return;
    void invoke('binary:host:open', { kind, path }).catch(() => undefined);
    return () => {
      void invoke('binary:host:close', { kind, path }).catch(() => undefined);
    };
  }, [kind, path]);

  useEffect(() => {
    if (!kind || !path) return;
    void invoke(
      'binary:host:setActive',
      isActive ? { kind, path } : null,
    ).catch(() => undefined);
  }, [isActive, kind, path]);

  if (!kind) return <div className="p-4 text-sm text-muted-foreground">未知二进制类型</div>;

  return (
    <div
      data-testid={`binary-host-${kind}`}
      className="flex h-full min-h-0 flex-col items-center justify-center bg-background text-sm text-muted-foreground"
    >
      <p className="mt-2">{tab.title}</p>
      <p className="text-xs">编辑器加载中…</p>
    </div>
  );
}
