
import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { PageJumpResult, SearchHit } from '@nexnote/shared';
import { useIndexStore } from '../../stores/index-store';
import { useTabStore } from '../../stores/tab-store';
import { useUiStore } from '../../stores/ui-store';
import { cn } from '../../lib/utils';
import { invoke } from '../../lib/ipc';

/**
 * ⌘⇧F 全文搜索面板（DEV-004）：FTS5 实时结果 + 高亮片段。
 * 全局开关状态放 ui-store（searchOpen），热键在 App 层注册一次。
 */
export function useSearchHotkey(): void {
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        useUiStore.getState().setSearchOpen(!useUiStore.getState().searchOpen);
      }
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, []);
}

const TIER_LABEL: Record<SearchHit['tier'], string> = {
  title: '标题',
  tag: '标签',
  alias: '别名',
  content: '正文',
};

export function SearchPanel() {
  const open = useUiStore((s) => s.searchOpen);
  if (!open) return null;
  return <SearchPanelInner />;
}

function highlight(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const q = query.trim();
  if (!q) return [{ text, hit: false }];
  const parts: Array<{ text: string; hit: boolean }> = [];
  const lower = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(lowerQ, i);
    if (idx === -1) {
      parts.push({ text: text.slice(i), hit: false });
      break;
    }
    if (idx > i) parts.push({ text: text.slice(i, idx), hit: false });
    parts.push({ text: text.slice(idx, idx + q.length), hit: true });
    i = idx + q.length;
  }
  return parts;
}

function SearchPanelInner() {
  const setOpen = useUiStore((s) => s.setSearchOpen);
  const search = useIndexStore((s) => s.search);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  // 防抖实时搜索（FTS5 千页级 <100ms，客户端再留 120ms 合并输入）
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!query.trim()) {
        setHits([]);
        setStatus('idle');
        return;
      }
      setStatus('loading');
      void search(query)
        .then((results) => {
          setHits(results);
          setStatus('done');
        })
        .catch(() => setStatus('done'));
    }, query.trim() ? 120 : 0);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, search]);

  const activePaneId = useTabStore((s) => s.activePaneId);
  const go = (path: string): void => {
    setOpen(false);
    useTabStore.getState().openPageTab(activePaneId, path);
  };

  return (
    <div
      data-testid="search-panel"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[14vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-[620px] max-w-[90vw] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl">
        <div className="flex items-center gap-2 border-b px-3.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            data-testid="search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (hits[0]) go(hits[0].path);
              }
            }}
            placeholder="全文搜索（标题 / 标签 / 别名 / 正文）…"
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          />
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            ⌘⇧F
          </kbd>
        </div>
        <div className="max-h-96 overflow-auto p-1.5" data-testid="search-results">
          {status === 'done' && hits.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">未找到匹配内容</p>
          )}
          {hits.map((hit, i) => (
            <button
              key={`${hit.path}-${i}`}
              type="button"
              data-testid="search-hit"
              onClick={() => go(hit.path)}
              className={cn(
                'flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left text-sm',
                i === 0 ? 'bg-accent/80 text-accent-foreground' : 'hover:bg-accent/60',
              )}
            >
              <span className="flex items-center gap-2">
                <span className="flex-1 truncate font-medium">{hit.title || hit.path}</span>
                <span className="rounded border bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                  {TIER_LABEL[hit.tier]}
                </span>
              </span>
              {hit.snippet && (
                <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {highlight(hit.snippet, query).map((p, j) =>
                    p.hit ? (
                      <mark key={j} className="rounded bg-yellow-300/40 px-0.5 text-foreground">
                        {p.text}
                      </mark>
                    ) : (
                      <span key={j}>{p.text}</span>
                    ),
                  )}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="border-t px-3.5 py-1.5 text-[11px] text-muted-foreground">
          ↑↵ 打开第一条 · esc 关闭 · 标题 &gt; 标签 &gt; 别名 &gt; 正文排序
        </div>
      </div>
    </div>
  );
}

/**
 * ⌘K 页面跳转注入：把 index:jumpTo 结果并入命令面板 items。
 * 命令面板 store 侧（palette-store）提供 injectItems；此处按 query 拉取。
 */
export function useJumpToInjection(): void {
  const [query, setQuery] = useState('');
  useEffect(() => {
    // palette 输入事件桥（palette-store 提供 subscribeQuery）
    const unsub = subscribePaletteQuery(setQuery);
    return unsub;
  }, []);
  useEffect(() => {
    if (!query.trim()) {
      useUiStore.getState().setJumpResults([]);
      return;
    }
    let cancelled = false;
    void invoke('index:jumpTo', { query, limit: 8 })
      .then((results: PageJumpResult[]) => {
        if (!cancelled) useUiStore.getState().setJumpResults(results);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [query]);
}

type QueryListener = (q: string) => void;
const queryListeners = new Set<QueryListener>();

/** palette-store 桥：palette 输入变化时通知 jump 注入器。 */
export function subscribePaletteQuery(listener: QueryListener): () => void {
  queryListeners.add(listener);
  return () => queryListeners.delete(listener);
}

export function notifyPaletteQuery(query: string): void {
  for (const l of queryListeners) l(query);
}
