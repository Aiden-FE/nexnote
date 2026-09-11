import { useEffect, useState } from 'react';
import { FileWarning } from 'lucide-react';
import type { TabDescriptor } from '../stores/tab-store';
import { invoke } from '../lib/ipc';
import { openDocumentTab } from '../lib/open-document';

/** DOCX 原件只读预览：编辑仅通过 native-block 副本，不修改原件。 */
export function DocxView({ tab }: { tab: TabDescriptor }) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const pagePath = tab.pagePath;

  useEffect(() => {
    let cancelled = false;
    if (!pagePath) return;
    void invoke('docx:readPreview', { path: pagePath })
      .then((preview) => {
        if (!cancelled) setMarkdown(preview.markdown);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [pagePath]);

  const createCopy = async (): Promise<string | null> => {
    if (!pagePath) return null;
    setStatus('正在创建编辑副本…');
    const result = await invoke('docx:createEditCopy', { path: pagePath });
    setStatus(result.created ? '已创建编辑副本' : '已使用现有编辑副本');
    await openDocumentTab(result.path);
    return result.path;
  };

  const exportDocx = async (): Promise<void> => {
    try {
      const copyPath = await createCopy();
      if (!copyPath) return;
      const result = await invoke('docx:export', { path: copyPath });
      setStatus(`已导出 DOCX：${result.path}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div data-testid="docx-view" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2">
        <div>
          <strong className="text-sm">DOCX 原件只读</strong>
          <p className="text-xs text-muted-foreground">
            创建 native-block 副本后编辑，原件不会被覆盖
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs hover:bg-accent"
            onClick={() => void createCopy()}
          >
            创建编辑副本
          </button>
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs hover:bg-accent"
            onClick={() => void exportDocx()}
          >
            导出 DOCX
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <div className="m-6 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <FileWarning className="mt-0.5 size-4 shrink-0" />
            <span>无法读取 DOCX：{error}</span>
          </div>
        )}
        {!error && markdown === null && (
          <p className="p-6 text-sm text-muted-foreground">加载中…</p>
        )}
        {!error && markdown !== null && (
          <pre className="mx-auto max-w-3xl whitespace-pre-wrap break-words px-8 py-8 text-sm leading-7">
            {markdown}
          </pre>
        )}
        {status && <p className="border-t px-4 py-2 text-xs text-muted-foreground">{status}</p>}
      </div>
    </div>
  );
}
