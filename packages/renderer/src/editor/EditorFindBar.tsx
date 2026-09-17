import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useTabStore } from '../stores/tab-store';

import type { EditorFindResult } from './find';

interface EditorFindBarProps {
  onFind: (query: string, direction: 1 | -1, restart: boolean) => EditorFindResult;
  tabId: string;
  onClose?: () => void;
}

/** 当前编辑视图的轻量查找栏。命中定位由宿主编辑器完成，并同步显现折叠正文。 */
export function EditorFindBar({ onFind, onClose, tabId }: EditorFindBarProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<EditorFindResult>({ current: 0, total: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        event.key.toLowerCase() !== 'f' ||
        useTabStore.getState().activeTabId !== tabId
      )
        return;
      event.preventDefault();
      if (open) {
        inputRef.current?.focus();
        inputRef.current?.select();
      } else {
        setOpen(true);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [open, tabId]);

  useLayoutEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  const close = (): void => {
    setOpen(false);
    onClose?.();
  };
  const find = (direction: 1 | -1, restart = false): void => {
    if (!query) {
      setResult({ current: 0, total: 0 });
      return;
    }
    setResult(onFind(query, direction, restart));
  };

  if (!open) return null;
  return (
    <div
      data-testid="editor-find-bar"
      role="search"
      aria-label="在当前页面中查找"
      className="absolute right-4 top-11 z-30 flex items-center gap-1 rounded-md border bg-popover p-1 shadow-lg"
    >
      <Search className="ml-1 size-3.5 text-muted-foreground" aria-hidden="true" />
      <input
        ref={inputRef}
        data-testid="editor-find-input"
        value={query}
        aria-label="查找文本"
        placeholder="在当前页面中查找"
        className="h-7 w-48 bg-transparent px-1 text-xs outline-none"
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setResult(next ? onFind(next, 1, true) : { current: 0, total: 0 });
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            find(event.shiftKey ? -1 : 1);
          }
        }}
      />
      <span
        data-testid="editor-find-status"
        aria-live="polite"
        className="min-w-12 text-center text-[11px] text-muted-foreground"
      >
        {query ? (result.total ? `${result.current}/${result.total}` : '无结果') : ''}
      </span>
      <button
        type="button"
        aria-label="上一个匹配"
        title="上一个匹配"
        onClick={() => find(-1)}
        className="rounded p-1 hover:bg-accent"
      >
        <ChevronUp className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="下一个匹配"
        title="下一个匹配"
        onClick={() => find(1)}
        className="rounded p-1 hover:bg-accent"
      >
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="关闭查找"
        title="关闭查找"
        onClick={close}
        className="rounded p-1 hover:bg-accent"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
