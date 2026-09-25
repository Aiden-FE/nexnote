import { useEffect, useRef } from 'react';
import { invoke } from '../lib/ipc';
import { useTabStore, isBinaryKind, type TabDescriptor } from '../stores/tab-store';
import { useThemeStore } from '../theme/theme-store';

/**
 * DEV-074：主题桥（ADR-0015 Decision 3「主题经 IPC 桥」）。
 * 主窗口 resolved 主题变化时推送给全部二进制编辑器宿主。
 */
let themeBridgeInstalled = false;
function installThemeBridge(): void {
  if (themeBridgeInstalled) return;
  themeBridgeInstalled = true;
  let last: string | null = null;
  useThemeStore.subscribe((state) => {
    if (state.resolved === last) return;
    last = state.resolved;
    void invoke('binary:editorTheme', { theme: state.resolved }).catch(() => undefined);
  });
}

/**
 * DEV-074 二进制 tab 容器（docx / xlsx / mindmap）。
 * 真正的编辑器运行在独立 WebContentsView（主进程管理）；本组件：
 * - tab 激活时通知主进程 setActive（确保宿主满铺内容区、其余宿主隐藏）；
 * - 挂载时打开宿主、卸载（关闭 tab）时通知主进程 flush + 回收；
 * - 自身渲染一个占位（宿主 WebContentsView 悬浮在其上）。
 */
export function BinaryTabView({ tab }: { tab: TabDescriptor }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);

  const kind = isBinaryKind(tab.kind) ? tab.kind : null;
  const path = tab.pagePath ?? '';

  useEffect(() => {
    if (!kind || !path) return;
    void invoke('binary:host:open', { kind, path }).catch(() => undefined);
  }, [kind, path]);

  // 只有 tab 真正关闭（不只是切换到另一个 tab）时才 flush + 回收 WebContentsView。
  useEffect(() => {
    if (!kind || !path) return;
    return () => {
      const stillOpen = useTabStore
        .getState()
        .tabs.some((candidate) => candidate.id === tab.id && candidate.pagePath === path);
      if (stillOpen) return;
      void invoke('binary:host:close', { kind, path }).catch((error: unknown) => {
        const store = useTabStore.getState();
        const restored = store.openBinaryTab(path, tab.title, kind);
        store.setActiveTab(restored.id);
        store.setBinaryTabCloseError(
          `无法保存 ${tab.title}，标签页已保留。请重试关闭。${error instanceof Error ? ` ${error.message}` : ''}`,
        );
      });
    };
  }, [kind, path, tab.id, tab.title]);

  // DEV-074 宿主边界：把本容器在窗口内容区内的矩形上报给主进程，
  // 让 WebContentsView 只覆盖这块占位，不盖住侧栏/标签条/状态栏。
  useEffect(() => {
    if (!kind || !path) return;
    const node = hostRef.current;
    if (!node) return;
    const report = (): void => {
      const rect = node.getBoundingClientRect();
      void invoke('binary:host:setBounds', {
        kind,
        path,
        bounds: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      }).catch(() => undefined);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(node);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
      void invoke('binary:host:setBounds', { kind, path, bounds: null }).catch(() => undefined);
    };
  }, [kind, path]);

  useEffect(() => {
    installThemeBridge();
  }, []);

  if (!kind) return <div className="p-4 text-sm text-muted-foreground">未知二进制类型</div>;

  return (
    <div
      ref={hostRef}
      data-testid={`binary-host-${kind}`}
      className="flex h-full min-h-0 flex-col items-center justify-center bg-background text-sm text-muted-foreground"
    >
      <p className="mt-2">{tab.title}</p>
      <p className="text-xs">编辑器加载中…</p>
    </div>
  );
}
