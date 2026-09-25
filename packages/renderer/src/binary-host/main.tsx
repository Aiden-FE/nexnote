import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  bootstrapBinaryHost,
  getSession,
  subscribeSession,
  markDirty,
  reloadAfterConflict,
} from './session';
import type { SessionState } from './session';
import { DocxEditor } from './docx-editor';
import { XlsxEditor } from './xlsx-editor';
import { MindmapEditor } from './mindmap-editor';
import './host.css';

/**
 * DEV-074 二进制编辑器宿主入口（独立 WebContentsView 页面 editor-host.html）。
 * 与主窗口共用 window.nexnote preload 桥；主进程经 binary:editorCommand 驱动 load/flush/destroy。
 */
function Host(): React.JSX.Element {
  const [session, setSession] = useState<SessionState | null>(() => getSession());
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);

  useEffect(() => subscribeSession(setSession), []);
  useEffect(() => bootstrapBinaryHost(), []);

  const discardAndReload = async (): Promise<void> => {
    if (!window.confirm('本地编辑尚未保存。重新加载将丢弃本地修改，是否继续？')) return;
    setReloading(true);
    setReloadError(null);
    try {
      await reloadAfterConflict();
    } catch (error) {
      setReloadError(error instanceof Error ? error.message : String(error));
    } finally {
      setReloading(false);
    }
  };

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-500">
        等待加载文档…
      </div>
    );
  }

  const readonlyNote = session.readonly.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {(readonlyNote || session.status) && (
        <div className="shrink-0 border-b border-neutral-200 bg-neutral-50 px-4 py-1.5 text-xs">
          {readonlyNote && (
            <span data-testid="binary-readonly-note" className="mr-3 text-neutral-600">
              只读保留区（原字节不丢失，此处不编辑）：{session.readonly.join('、')}
            </span>
          )}
          {session.status && (
            <span className={session.conflict ? 'text-amber-700' : 'text-neutral-500'}>
              {session.status}
            </span>
          )}
          {session.conflict && (
            <button
              type="button"
              disabled={reloading}
              onClick={() => void discardAndReload()}
              className="ml-3 rounded border border-amber-600 px-2 py-0.5 text-amber-800 disabled:opacity-50"
            >
              {reloading ? '重新加载中…' : '放弃本地修改并重新加载'}
            </button>
          )}
          {reloadError && (
            <span role="alert" className="ml-3 text-red-700">
              {reloadError}
            </span>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {session.kind === 'docx' && session.docx && (
          <DocxEditor
            path={session.path}
            html={session.docx.html}
            sha256={session.sha256}
            meta={session.docx.meta}
            onChange={(html) => markDirty({ html })}
          />
        )}
        {session.kind === 'xlsx' && session.xlsx && (
          <XlsxEditor
            path={session.path}
            sheets={session.xlsx.sheets}
            onChange={(sheets) => markDirty({ sheets })}
          />
        )}
        {session.kind === 'mindmap' && session.mindmap && (
          <MindmapEditor
            path={session.path}
            model={session.mindmap.model}
            onChange={(model) => markDirty({ model })}
          />
        )}
      </div>
    </div>
  );
}

const container = document.getElementById('editor-root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Host />
    </StrictMode>,
  );
}
