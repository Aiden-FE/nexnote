import { useEffect, useState } from 'react';
import { ChevronRight, FileWarning } from 'lucide-react';
import type { TabDescriptor } from '../stores/tab-store';
import { useTabStore } from '../stores/tab-store';
import { useVault } from '../shell/vault-context';
import { invoke } from '../lib/ipc';
import { KERNEL_VERSION } from '@nexnote/kernel';
import { cn } from '../lib/utils';

/**
 * 页面 Tab 内容（DEV-003 占位版）：
 * - 面包屑：vault 根 > 文件夹 > 页面
 * - Tab 标题 = 页面 H1 或文件名（读取后回写 tab title）
 * - 正文区为 DEV-002 编辑器内核占位（本票不含编辑器）
 */

/** 提取首个 H1（跳过 frontmatter）；无则 null。 */
export function extractH1(text: string): string | null {
  const withoutFm = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  for (const line of withoutFm.split(/\r?\n/)) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function segments(pagePath: string, vaultName: string): string[] {
  const parts = pagePath.split('/').filter((p) => p.length > 0);
  const leaf = (parts.pop() ?? '').replace(/\.md$/i, '');
  return [vaultName, ...parts, leaf];
}

export function PageView({ tab }: { tab: TabDescriptor }) {
  const vault = useVault();
  const pagePath = tab.pagePath ?? null;
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!pagePath) return;
    // 异步读取：成功后回写内容与 H1 标题（同步重置交给组件 key 重挂载）
    void invoke('fs:readTextFile', { path: pagePath })
      .then((text) => {
        if (cancelled) return;
        setContent(text);
        const h1 = extractH1(text);
        if (h1) {
          useTabStore.getState().setTabTitle(tab.id, h1);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [pagePath, tab.id]);

  if (!pagePath) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        无路径页面 · DEV-002 编辑器接入
      </div>
    );
  }

  const crumbs = segments(pagePath, vault?.name ?? '…');

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 面包屑标题栏 */}
      <nav
        data-testid="page-breadcrumb"
        aria-label="面包屑"
        className="flex h-7 shrink-0 items-center gap-0.5 overflow-x-auto border-b px-3 text-[11px] text-muted-foreground"
      >
        {crumbs.map((c, i) => (
          <span key={`${c}-${i}`} className="flex shrink-0 items-center gap-0.5">
            {i > 0 && <ChevronRight className="size-3 opacity-50" />}
            <span
              className={cn(
                'truncate',
                i === crumbs.length - 1 && 'max-w-[220px] font-medium text-foreground',
              )}
              title={c}
            >
              {c}
            </span>
          </span>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <div className="m-6 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <FileWarning className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">无法读取页面</p>
              <p className="mt-1 text-xs opacity-80">
                {pagePath} — {error}（可能已被移动或删除）
              </p>
            </div>
          </div>
        )}
        {!error && content === null && <p className="p-6 text-sm text-muted-foreground">加载中…</p>}
        {!error && content !== null && (
          <div className="nexnote-editor-scope mx-auto flex h-full max-w-3xl flex-col px-8 py-8">
            <h1 className="mb-1 text-xl font-semibold tracking-tight">{tab.title}</h1>
            <p className="mb-6 text-xs text-muted-foreground">
              占位视图 · 编辑器内核 {KERNEL_VERSION}（DEV-002 接入）
            </p>
            <pre className="whitespace-pre-wrap break-words rounded-lg border bg-card p-4 font-mono text-xs leading-relaxed text-muted-foreground">
              {content}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
