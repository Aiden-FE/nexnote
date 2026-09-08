import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Settings as SettingsIcon, Loader2 } from 'lucide-react';
import { settingsSectionRegistry, useRegistryItems } from '../registries';
import { useSettingsNav } from '../lib/open-settings';
import { useSettingsStore } from '../stores/settings-store';
import { cn } from '../lib/utils';
import type { SettingSearchEntry } from '@nexnote/shared';

/** 设置页：分区导航、分区内容与可跳转的设置搜索。 */
export function SettingsPage() {
  const sections = [...useRegistryItems(settingsSectionRegistry)].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  const activeId = useSettingsNav((s) => s.activeId);
  const active = sections.find((s) => s.id === activeId) ?? sections[0];
  const ActiveContent = active?.render;
  const searchSettings = useSettingsStore((s) => s.search);
  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [results, setResults] = useState<SettingSearchEntry[]>([]);
  const queryRef = useRef('');

  const runSearch = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setResults([]);
      setSearchState('idle');
      return;
    }
    setSearchState('loading');
    try {
      const entries = await searchSettings(trimmed);
      if (queryRef.current.trim() !== trimmed) return;
      setResults(entries);
      setSearchState('done');
    } catch {
      if (queryRef.current.trim() !== trimmed) return;
      setResults([]);
      setSearchState('error');
    }
  }, [searchSettings]);

  useEffect(() => {
    queryRef.current = query;
    const timer = setTimeout(() => void runSearch(query), 120);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const groupedResults = useMemo(() => {
    const map = new Map<string, SettingSearchEntry[]>();
    for (const entry of results) map.set(entry.sectionId, [...(map.get(entry.sectionId) ?? []), entry]);
    return map;
  }, [results]);

  const showResults = searchState !== 'idle' && searchState !== 'error' && query.trim().length > 0;

  return (
    <div data-testid="settings-page" className="mx-auto flex h-full max-w-4xl min-w-0 flex-col px-6 py-8">
      <h1 className="mb-4 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <SettingsIcon className="size-4.5" />
        设置
      </h1>
      <div className="relative mb-4">
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          data-testid="settings-search-input"
          aria-label="搜索设置"
          placeholder="搜索设置项…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
        />
      </div>

      {showResults && (
        <div data-testid="settings-search-results" role="region" aria-label="设置搜索结果" className="mb-4 max-h-64 overflow-auto rounded-md border bg-card">
          {searchState === 'loading' && results.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />搜索中…
            </div>
          )}
          {searchState === 'done' && results.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground">没有找到与 “{query.trim()}” 相关的设置</div>
          )}
          {searchState === 'done' && results.length > 0 && (
            <div className="divide-y">
              {[...groupedResults.entries()].map(([sectionId, entries]) => {
                const section = sections.find((candidate) => candidate.id === sectionId);
                return (
                  <div key={sectionId}>
                    <div className="bg-muted/30 px-3 py-1 text-[11px] font-medium text-muted-foreground">{section?.title ?? sectionId}</div>
                    {entries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        data-testid={`settings-search-result-${entry.id}`}
                        onClick={() => useSettingsNav.getState().setSection(entry.sectionId)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50"
                      >
                        <span>{entry.title}</span>
                        <span className="text-[11px] text-muted-foreground">{entry.id}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {searchState === 'error' && (
        <div role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">搜索失败，请稍后再试</div>
      )}

      <div className="flex min-h-0 flex-1 gap-6">
        <nav data-testid="settings-nav" className="flex w-40 shrink-0 flex-col gap-0.5">
          {sections.map((section) => {
            const Icon = section.icon;
            const isActive = active?.id === section.id;
            return (
              <button
                key={section.id}
                type="button"
                data-testid={`settings-nav-${section.id}`}
                onClick={() => useSettingsNav.getState().setSection(section.id)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm',
                  isActive ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{section.title}</span>
              </button>
            );
          })}
        </nav>
        <div data-testid={`settings-section-${active?.id ?? 'none'}`} className="min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border bg-card p-5 text-card-foreground">
          {ActiveContent ? <ActiveContent /> : null}
        </div>
      </div>
    </div>
  );
}
