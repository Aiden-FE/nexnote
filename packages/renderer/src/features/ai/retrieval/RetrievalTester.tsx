import { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import type { RetrievalResponse } from '@nexnote/shared';
import { Button } from '../../../components/ui/button';
import { retrieve } from './retrieval-client';
import { RetrievalSources } from './RetrievalSources';

/**
 * 召回测试面（DEV-011 验收面）：跑一次三阶段召回并展示参考来源。
 * DEV-012 对话 dock 会在每次回答内联同一 <RetrievalSources/>。
 */
export function RetrievalTester() {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<RetrievalResponse | null>(null);

  const run = async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResponse(await retrieve({ query: q }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="retrieval-tester" className="flex flex-col gap-1.5">
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input
          data-testid="retrieval-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="检索知识库…"
          className="h-7 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-[12px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <Button data-testid="retrieval-run" size="sm" className="h-7 w-7 p-0" disabled={!query.trim() || busy} aria-label="检索">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
        </Button>
      </form>
      {error && <p data-testid="retrieval-error" className="text-[11px] text-destructive">{error}</p>}
      {response && <RetrievalSources response={response} />}
    </div>
  );
}
