import { useMemo, useRef, useState } from 'react';
import { DockPopover } from './DockPopover';
import { FileText, Link2, Plus, SquareMousePointer, X } from 'lucide-react';
import { useChatStore } from './chat-store';
import { assembleChatContext, estimateTokens, type ChatContextChip } from './context';
import {
  activePageRef,
  activeSelectionText,
  addPageContext,
  addSelectionContext,
} from './chat-context-bridge';
import { useIndexStore } from '../../../stores/index-store';
import { usePageTreeStore } from '../../../stores/page-tree-store';
import { titleFromPath } from '../../../editor/title-sync';
import { cn } from '../../../lib/utils';

const KIND_ICON = {
  document: FileText,
  selection: SquareMousePointer,
  page: FileText,
  backlink: Link2,
} as const;

function Chip({ chip, onRemove }: { chip: ChatContextChip; onRemove: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const Icon = KIND_ICON[chip.kind];
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="context-chip"
        data-kind={chip.kind}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[180px] items-center gap-1 rounded-full border bg-muted/60 py-0.5 pl-1.5 pr-1 text-[11px] text-foreground hover:bg-muted"
        title={chip.label}
      >
        <Icon className="size-3 shrink-0 text-primary" />
        <span className="truncate">{chip.label}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          ~{estimateTokens(chip.text)}
        </span>
        <span
          role="button"
          tabIndex={0}
          aria-label="移除上下文"
          data-testid="context-chip-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(chip.id);
          }}
          className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-2.5" />
        </span>
      </button>
      <DockPopover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        testId="context-chip-detail"
        className="max-h-40 w-64 overflow-auto rounded-md border bg-popover p-2 text-[11px] leading-relaxed text-popover-foreground shadow-md"
      >
        <span className="mb-1 block font-medium">{chip.label}</span>
        <span className="block whitespace-pre-wrap text-muted-foreground">
          {chip.text.slice(0, 600)}
          {chip.text.length > 600 ? ' …' : ''}
        </span>
      </DockPopover>
    </>
  );
}

function AddMenu() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const backlinks = useIndexStore((s) => s.backlinks);
  const backlinksFor = useIndexStore((s) => s.backlinksFor);
  const entries = usePageTreeStore((s) => s.entries);
  const ref = activePageRef();
  const sel = activeSelectionText();

  const pages = useMemo(
    () =>
      entries
        .filter((e) => e.kind === 'file' && e.name.toLowerCase().endsWith('.md'))
        .filter((e) => !ref || e.path !== ref.path)
        .filter((e) =>
          filter ? titleFromPath(e.name).toLowerCase().includes(filter.toLowerCase()) : true,
        )
        .slice(0, 30),
    [entries, filter, ref],
  );
  const linkDocs = backlinksFor && ref ? backlinks : [];

  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="context-add"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-0.5 rounded-full border border-dashed px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="size-3" /> 添加
      </button>
      <DockPopover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        testId="context-add-menu"
        className="w-64 rounded-md border bg-popover p-1.5 text-[11px] text-popover-foreground shadow-md"
      >
        <button
          type="button"
          disabled={!sel}
          data-testid="context-add-selection"
          onClick={() => {
            const page = activePageRef();
            addSelectionContext({
              selectionText: sel,
              docTitle: page?.title ?? null,
              docPath: page?.path ?? null,
            });
            setOpen(false);
          }}
          className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-accent disabled:opacity-40"
        >
          <SquareMousePointer className="size-3.5" /> 当前选区
          {!sel && <span className="ml-auto text-[10px] text-muted-foreground">无选区</span>}
        </button>

        {linkDocs.length > 0 && (
          <div className="mt-1 border-t pt-1">
            <p className="px-1.5 py-0.5 text-[10px] text-muted-foreground">反向链接文档</p>
            <div className="max-h-28 overflow-auto">
              {linkDocs.map((b) => (
                <button
                  key={b.fromPath}
                  type="button"
                  onClick={() => {
                    void addPageContext(b.fromPath, b.fromTitle, 'backlink');
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-1.5 truncate rounded px-1.5 py-1 text-left hover:bg-accent"
                >
                  <Link2 className="size-3.5 shrink-0" /> {b.fromTitle}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-1 border-t pt-1">
          <p className="px-1.5 py-0.5 text-[10px] text-muted-foreground">特定页面</p>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="过滤页面…"
            className="mb-1 w-full rounded border bg-background px-1.5 py-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
          />
          <div className="max-h-32 overflow-auto">
            {pages.map((e) => (
              <button
                key={e.path}
                type="button"
                data-testid="context-add-page"
                onClick={() => {
                  void addPageContext(e.path, titleFromPath(e.name), 'page');
                  setOpen(false);
                  setFilter('');
                }}
                className="flex w-full items-center gap-1.5 truncate rounded px-1.5 py-1 text-left hover:bg-accent"
              >
                <FileText className="size-3.5 shrink-0" /> {titleFromPath(e.name)}
              </button>
            ))}
            {pages.length === 0 && <p className="px-1.5 py-1 text-muted-foreground">无匹配页面</p>}
          </div>
        </div>
      </DockPopover>
    </>
  );
}

export function ContextChips() {
  const chips = useChatStore((s) => s.chips);
  const removeChip = useChatStore((s) => s.removeChip);
  const assembly = useMemo(() => assembleChatContext(chips), [chips]);

  return (
    <div data-testid="context-chips" className="shrink-0">
      <div className="flex flex-wrap items-center gap-1">
        {chips.map((chip) => (
          <Chip key={chip.id} chip={chip} onRemove={removeChip} />
        ))}
        <AddMenu />
        <span
          data-testid="context-token-budget"
          className={cn(
            'ml-auto text-[10px] text-muted-foreground',
            assembly.truncated && 'text-amber-600 dark:text-amber-400',
          )}
        >
          ~{assembly.totalTokens} tokens{assembly.truncated ? ' · 已截断' : ''}
        </span>
      </div>
    </div>
  );
}
