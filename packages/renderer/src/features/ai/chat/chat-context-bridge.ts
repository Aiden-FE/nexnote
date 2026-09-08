import { computeEditorActionContext } from '@nexnote/kernel';
import { invoke } from '../../../lib/ipc';
import { getActiveEditor } from '../../../editor/active-editor';
import { useTabStore } from '../../../stores/tab-store';
import { titleFromPath } from '../../../editor/title-sync';
import { useChatStore, nextChipId, type AskPayload } from './chat-store';

/** 当前激活 tab 中打开的页面（无则 null）。 */
export function activePageRef(): { path: string; title: string } | null {
  const { tabs, activeTabId } = useTabStore.getState();
  const tab = tabs.find((t) => t.id === activeTabId) ?? tabs.at(-1);
  if (!tab || tab.kind !== 'page' || !tab.pagePath) return null;
  return { path: tab.pagePath, title: tab.title || titleFromPath(tab.pagePath) };
}

/** 读取当前活动编辑器的选区文本（折叠选区返回空串）。 */
export function activeSelectionText(): string {
  const kernel = getActiveEditor();
  if (!kernel) return '';
  const ctx = computeEditorActionContext(kernel.editor.view, 'selection');
  return ctx.target === 'selection' ? ctx.text : '';
}

/**
 * 同步「当前文档」自动 chip：随激活 tab 变化重建。
 * 保留用户手动添加的 chip（选区/页面/反链），仅替换 auto 文档 chip。
 */
export function refreshAutoDocumentChip(): void {
  const store = useChatStore.getState();
  const kept = store.chips.filter((c) => !(c.auto && c.kind === 'document'));
  const ref = activePageRef();
  const markdown = getActiveEditor()?.getMarkdown() ?? '';
  if (ref && markdown.trim()) {
    kept.push({
      id: nextChipId('doc'),
      kind: 'document',
      label: ref.title,
      path: ref.path,
      text: markdown,
      auto: true,
    });
  }
  store.setChips(kept);
}

/** 「询问 AI」：把选区作为上下文 chip 加入。 */
export function addSelectionContext(payload: AskPayload): void {
  const store = useChatStore.getState();
  const kept = store.chips.filter((c) => c.kind !== 'selection');
  kept.push({
    id: nextChipId('selection'),
    kind: 'selection',
    label: payload.docTitle ? `选区 · ${payload.docTitle}` : '当前选区',
    path: payload.docPath ?? undefined,
    text: payload.selectionText,
  });
  store.setChips(kept);
}

/** 添加一个页面/反链文档 chip（读取全文作为上下文）。 */
export async function addPageContext(
  path: string,
  title: string,
  kind: 'page' | 'backlink',
): Promise<void> {
  const text = await invoke('fs:readTextFile', { path });
  useChatStore.getState().addChip({ id: nextChipId(kind), kind, label: title, path, text });
}
