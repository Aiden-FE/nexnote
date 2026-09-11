import { useEffect, useMemo, useRef, useState } from 'react';
import { FileWarning, Lock } from 'lucide-react';
import type { TabDescriptor } from '../stores/tab-store';
import { openPage } from '../stores/tab-store';
import { invoke } from '../lib/ipc';
import type { DocxEditDocument, DocxEditParagraph } from '@nexnote/shared';

function isParagraph(block: { type?: string }): block is DocxEditParagraph {
  return block.type !== 'table';
}

const paragraphsOf = (document: DocxEditDocument): DocxEditParagraph[] =>
  document.blocks.filter(isParagraph);

interface LoadedState {
  document: DocxEditDocument;
  sha256: string;
}

/** DOCX 原生编辑视图：docx:openEdit 载入段落模型，docx:save 写回（sha256 乐观锁）。 */
export function DocxView({ tab }: { tab: TabDescriptor }) {
  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const pagePath = tab.pagePath;
  const lastSha = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!pagePath) return;
    // pagePath 切换时先复位再异步载入（reset 先于异步结果，避免残留上一个文档）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoaded(null);
    setError(null);
    setDirty(false);
    void invoke('docx:openEdit', { path: pagePath })
      .then((payload) => {
        if (cancelled) return;
        lastSha.current = payload.sha256;
        setLoaded({ document: payload.document, sha256: payload.sha256 });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [pagePath]);

  const updateParagraph = (
    index: number,
    patch: Partial<Pick<DocxEditParagraph, 'text' | 'heading' | 'list'>>,
  ): void => {
    setLoaded((prev) => {
      if (!prev) return prev;
      let paragraphIndex = 0;
      const blocks = prev.document.blocks.map((block) => {
        if (!isParagraph(block)) return block;
        const currentIndex = paragraphIndex++;
        return currentIndex === index && block.editable
          ? {
              ...block,
              ...patch,
              runs: patch.text !== undefined ? [{ text: patch.text }] : block.runs,
              modified: true,
            }
          : block;
      });
      return { ...prev, document: { ...prev.document, blocks } };
    });
    setDirty(true);
  };

  const save = async (): Promise<void> => {
    if (!loaded || !pagePath || saving) return;
    setSaving(true);
    setStatus('正在保存…');
    try {
      const result = await invoke('docx:save', {
        path: pagePath,
        document: loaded.document,
        expectedSha256: loaded.sha256,
      });
      lastSha.current = result.sha256;
      setLoaded({ document: result.document, sha256: result.sha256 });
      setDirty(false);
      setStatus('已保存到 DOCX 原件');
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'DOCX_CONFLICT') {
        setStatus('原件已被外部修改，未覆盖。请重新打开后再编辑。');
      } else {
        setStatus(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSaving(false);
    }
  };

  const createCopy = async (): Promise<string | null> => {
    if (!pagePath) return null;
    const result = await invoke('docx:createEditCopy', { path: pagePath });
    openPage(result.path);
    return result.path;
  };

  const supportedCount = useMemo(
    () =>
      paragraphsOf(loaded?.document ?? { blocks: [], unsupportedCount: 0, originalXml: '' }).filter(
        (p) => p.editable,
      ).length,
    [loaded],
  );

  return (
    <div data-testid="docx-view" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2">
        <div>
          <strong className="text-sm">DOCX 原生编辑</strong>
          <p className="text-xs text-muted-foreground">
            支持段落文本、标题、粗斜体、列表；styles/media/headers 原样保留
            {loaded && loaded.document.unsupportedCount > 0
              ? `；${loaded.document.unsupportedCount} 个未支持块只读`
              : ''}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            保存{dirty ? ' *' : ''}
          </button>
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs hover:bg-accent"
            onClick={() => void createCopy()}
            title="转换为 Markdown 副本编辑（降级入口，不写回 DOCX）"
          >
            编辑副本（转换降级）
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
        {!error && loaded === null && <p className="p-6 text-sm text-muted-foreground">加载中…</p>}
        {loaded && (
          <div className="mx-auto max-w-3xl px-8 py-8 text-sm leading-7">
            {loaded.document.blocks.map((block, i) =>
              isParagraph(block) ? (
                block.editable ? (
                  <ParagraphEditor
                    key={i}
                    index={paragraphsOf(loaded.document).indexOf(block)}
                    paragraph={block}
                    onChange={updateParagraph}
                  />
                ) : (
                  <p
                    key={i}
                    className="my-2 flex items-start gap-2 whitespace-pre-wrap break-words text-muted-foreground"
                  >
                    <Lock className="mt-1.5 inline size-3 shrink-0" />
                    <span>{block.text || '（未支持内容，已原样保留）'}</span>
                  </p>
                )
              ) : (
                <div
                  key={i}
                  data-testid={`docx-table-${i}`}
                  aria-label="只读表格"
                  className="my-4 overflow-x-auto rounded border bg-muted/20 p-3 text-muted-foreground"
                  aria-readonly="true"
                >
                  <div className="mb-1 flex items-center gap-2 text-xs">
                    <Lock className="size-3 shrink-0" />
                    <span>表格（只读）</span>
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-sans">
                    {block.text || '（空表格）'}
                  </pre>
                </div>
              ),
            )}
            <p className="mt-6 text-xs text-muted-foreground">
              可编辑段落 {supportedCount}/{paragraphsOf(loaded.document).length}
              ；保真边界：表格、图片等复杂块不可编辑，保存时原样保留。
            </p>
          </div>
        )}
        {status && <p className="border-t px-4 py-2 text-xs text-muted-foreground">{status}</p>}
      </div>
    </div>
  );
}

function ParagraphEditor({
  index,
  paragraph,
  onChange,
}: {
  index: number;
  paragraph: DocxEditParagraph;
  onChange: (
    index: number,
    patch: Partial<Pick<DocxEditParagraph, 'text' | 'heading' | 'list'>>,
  ) => void;
}): React.JSX.Element {
  const cls = paragraph.heading ? `docx-h${paragraph.heading}` : '';
  return (
    <div className="group my-2 flex items-start gap-2">
      {paragraph.list && <span className="mt-0 select-none text-muted-foreground">•</span>}
      <textarea
        data-testid={`docx-paragraph-${index}`}
        className={`w-full resize-none border-none bg-transparent p-0 leading-7 outline-none focus:bg-accent/30 ${cls}`}
        rows={Math.max(1, Math.ceil((paragraph.text.length || 1) / 64))}
        value={paragraph.text}
        onChange={(e) => onChange(index, { text: e.target.value })}
      />
    </div>
  );
}
