import { openDocumentTab } from '../lib/open-document';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { commandRegistry, useRegistryItems, type CommandDef } from '../registries';
import { usePaletteStore } from '../stores/palette-store';
import { useUiStore } from '../stores/ui-store';
import { notifyPaletteQuery } from '../features/search';
import { cn } from '../lib/utils';

/** ⌘K 全局监听（App 挂载时注册一次）。 */
export function useCommandPaletteHotkey(): void {
  const setOpen = usePaletteStore((s) => s.setOpen);
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!usePaletteStore.getState().open);
      }
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, [setOpen]);
}

function score(cmd: CommandDef, query: string): number {
  if (!query) return 1;
  const haystack = `${cmd.title} ${cmd.category} ${(cmd.keywords ?? []).join(' ')}`.toLowerCase();
  const idx = haystack.indexOf(query);
  if (idx === -1) return 0;
  return 100 - Math.min(idx, 50);
}

/**
 * 命令面板骨架：注册表驱动，后续票据的命令经 commandRegistry.register 出现在这里。
 * 外层控制开关；打开时挂载 PaletteInner（状态天然重置）。
 */
export function CommandPalette() {
  const open = usePaletteStore((s) => s.open);
  if (!open) return null;
  return <PaletteInner />;
}

function PaletteInner() {
  const setOpen = usePaletteStore((s) => s.setOpen);
  const commands = useRegistryItems(commandRegistry);
  const jumpResults = useUiStore((s) => s.jumpResults);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 输入变化 → 通知页面跳转注入器（index:jumpTo）
  const onQueryChange = (value: string): void => {
    setQuery(value);
    setActiveIndex(0);
    notifyPaletteQuery(value);
  };

  const jumpItems = useMemo(
    () =>
      jumpResults.map((r) => ({
        id: `jump:${r.path}`,
        title: r.title,
        category: '页面',
        run: () => {
          void openDocumentTab(r.path);
        },
      })) as CommandDef[],
    [jumpResults],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const fromCommands = commands
      .map((cmd) => ({ cmd, s: score(cmd, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.cmd);
    // 有查询词时：页面跳转优先展示，命令随后（Obsidian ⌘K 行为）
    if (q) return [...jumpItems, ...fromCommands];
    return fromCommands;
  }, [commands, query, jumpItems]);

  // 派生安全索引（过滤结果变短时自动钳制，无需 effect）
  const safeIndex = Math.min(activeIndex, Math.max(filtered.length - 1, 0));

  useEffect(() => {
    // 打开后聚焦输入框（仅 DOM 操作，无 setState）
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${safeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [safeIndex]);

  const runCommand = (cmd: CommandDef) => {
    setOpen(false);
    void Promise.resolve(cmd.run()).catch((e) => console.error('[command]', cmd.id, e));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(filtered.length === 0 ? 0 : (safeIndex + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(
        filtered.length === 0 ? 0 : (safeIndex - 1 + filtered.length) % filtered.length,
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[safeIndex];
      if (cmd) runCommand(cmd);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[14vh]"
      data-testid="command-palette"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-[560px] max-w-[90vw] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl">
        <div className="flex items-center gap-2 border-b px-3.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            data-testid="palette-input"
            value={query}
            onChange={(e) => {
              onQueryChange(e.target.value);
            }}
            onKeyDown={onKeyDown}
            placeholder="搜索命令…"
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          />
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-80 overflow-auto p-1.5">
          {filtered.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">未找到匹配的命令</p>
          )}
          {filtered.map((cmd, index) => (
            <button
              key={cmd.id}
              type="button"
              data-index={index}
              data-testid="palette-item"
              onClick={() => runCommand(cmd)}
              onMouseEnter={() => setActiveIndex(index)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm',
                index === safeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
              )}
            >
              <span className="flex-1 truncate">{cmd.title}</span>
              <span className="text-[11px] text-muted-foreground">{cmd.category}</span>
              {cmd.shortcut && (
                <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {cmd.shortcut}
                </kbd>
              )}
              {index === safeIndex && <CornerDownLeft className="size-3.5 text-muted-foreground" />}
            </button>
          ))}
        </div>

        <div className="border-t px-3.5 py-1.5 text-[11px] text-muted-foreground">
          ↑↓ 选择 · ↵ 运行 · esc 关闭
        </div>
      </div>
    </div>
  );
}
