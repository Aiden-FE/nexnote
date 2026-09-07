import type { RetrievalResponse, RetrievalStageName } from '@nexnote/shared';
import { cn } from '../../../lib/utils';
import { useTabStore } from '../../../stores/tab-store';

const STAGE_LABEL: Record<RetrievalStageName, string> = {
  fts: '全文粗筛',
  links: '双链扩展',
  vector: '向量重排',
};

/** 召回参考来源 + 分阶段统计（召回透明 UI，DEV-012 对话面板复用）。 */
export function RetrievalSources({ response, testId = 'retrieval-sources' }: { response: RetrievalResponse; testId?: string }) {
  const openPage = (path: string, title: string) => {
    const { activePaneId, openPageTab } = useTabStore.getState();
    openPageTab(activePaneId, path, title);
  };

  return (
    <div data-testid={testId} className="space-y-1.5 text-[11px]">
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-muted-foreground">参考来源 {response.sources.length}</span>
        {response.degraded ? (
          <span data-testid="retrieval-degraded" className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
            两阶段（向量不可用）
          </span>
        ) : (
          <span data-testid="retrieval-model" className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
            向量重排 · {response.model ?? ''}
          </span>
        )}
      </div>

      <div data-testid="retrieval-stages" className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
        {response.stages.map((s) => (
          <span
            key={s.stage}
            data-stage={s.stage}
            data-enabled={s.enabled ? '1' : '0'}
            className={cn('rounded px-1.5 py-0.5', s.enabled ? 'bg-muted' : 'bg-muted/50 line-through')}
            title={s.note}
          >
            {STAGE_LABEL[s.stage]} {s.enabled ? `${s.candidates}·${s.elapsedMs}ms` : '跳过'}
          </span>
        ))}
      </div>

      <ul data-testid="retrieval-source-list" className="space-y-1">
        {response.sources.map((src, i) => (
          <li
            key={`${src.path}-${src.blockId ?? i}`}
            data-testid="retrieval-source"
            data-via={src.via}
            className="rounded-md border bg-background/60 p-1.5"
          >
            <button
              type="button"
              className="block max-w-full truncate text-left font-medium text-foreground hover:underline"
              onClick={() => openPage(src.path, src.title)}
              title={`打开 ${src.path}`}
            >
              《{src.title}》
            </button>
            <p className="mt-0.5 line-clamp-2 text-muted-foreground">{src.snippet}</p>
            <div className="mt-0.5 flex gap-1.5 text-[10px] text-muted-foreground">
              {src.vectorSim !== null && <span data-testid="source-sim">相似度 {(src.vectorSim).toFixed(2)}</span>}
              {src.confidenceScore !== null && <span>置信度 {src.confidenceScore}</span>}
              <span className="ml-auto">{STAGE_LABEL[src.via]}</span>
            </div>
          </li>
        ))}
        {response.sources.length === 0 && (
          <li className="text-muted-foreground">未召回到相关块。</li>
        )}
      </ul>
    </div>
  );
}
