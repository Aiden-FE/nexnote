import { useEffect, useState } from 'react';
import { FileText, Folder, RefreshCw } from 'lucide-react';
import { invoke } from '../lib/ipc';
import type { DirEntry } from '@nexnote/shared';

/**
 * Vault 文件浏览占位页：真实调用主进程 fs:listDir（演示渲染层只能经 IPC 访问文件系统）。
 * 完整的页面树/文件操作由 DEV-003 提供。
 */
export function FilesPage() {
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    invoke('fs:listDir', { path: '' })
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <div className="mx-auto h-full max-w-2xl px-6 py-8">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Vault 文件</h1>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          title="刷新"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <RefreshCw className="size-3.5" />
        </button>
        <span className="ml-auto text-[11px] text-muted-foreground">数据来自主进程 fs:listDir（IPC）</span>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {!error && entries === null && <p className="text-sm text-muted-foreground">加载中…</p>}
      {entries && entries.length === 0 && (
        <p className="text-sm text-muted-foreground">vault 根目录为空</p>
      )}
      {entries && entries.length > 0 && (
        <ul className="overflow-hidden rounded-lg border">
          {entries.map((entry) => {
            const Icon = entry.kind === 'directory' ? Folder : FileText;
            return (
              <li
                key={entry.path}
                data-testid="files-entry"
                className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent/40"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{entry.name}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">{entry.kind}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground/80">
        页面树、右键菜单、新建/重命名/删除/移动等完整文件操作在 DEV-003 实现；本页仅验证 IPC
        文件链路与沙箱。
      </p>
    </div>
  );
}
