import { useTabStore, type MarkdownView } from '../../stores/tab-store';

export type ModeSwitchHandler = () => boolean | Promise<boolean>;

const handlers = new Map<string, ModeSwitchHandler>();
const previewEnterHandlers = new Map<string, ModeSwitchHandler>();
const switching = new Set<string>();

/** 当前挂载模式登记「离开前 flush/校验」逻辑。 */
export function registerModeSwitchHandler(tabId: string, handler: ModeSwitchHandler): () => void {
  handlers.set(tabId, handler);
  return () => {
    if (handlers.get(tabId) === handler) handlers.delete(tabId);
  };
}

/** 进入预览视图前的 flush 校验（编辑界面即将隐藏，保存失败必须停留）。 */
export function registerPreviewEnterHandler(tabId: string, handler: ModeSwitchHandler): () => void {
  previewEnterHandlers.set(tabId, handler);
  return () => {
    if (previewEnterHandlers.get(tabId) === handler) previewEnterHandlers.delete(tabId);
  };
}

/** 三个入口共用的唯一切换路径；失败时保持当前模式。 */
export async function requestSourceModeToggle(tabId: string): Promise<boolean> {
  if (switching.has(tabId)) return false;
  const tab = useTabStore.getState().tabs.find((candidate) => candidate.id === tabId);
  if (!tab || tab.kind !== 'page') return false;
  // Markdown 的“模式切换”只在源码与分栏之间切换，不进入 TipTap 块编辑。
  if (tab.format === 'markdown') {
    useTabStore.getState().toggleMarkdownEditView(tabId);
    return true;
  }
  // Native-block 文档不允许进入源码模式；legacy tab 保持原有兼容行为。
  if (tab.format === 'native-block') {
    useTabStore.getState().toggleSourceMode(tabId, false);
    return false;
  }
  switching.add(tabId);
  try {
    const prepare = handlers.get(tabId);
    if (prepare && !(await prepare())) return false;
    useTabStore.getState().toggleSourceMode(tabId);
    return true;
  } catch {
    // 保存/解析准备失败时保持当前模式；各视图负责呈现其具体错误状态。
    return false;
  } finally {
    switching.delete(tabId);
  }
}

export function requestActiveSourceModeToggle(): void {
  const { tabs, activeTabId } = useTabStore.getState();
  const tab = tabs.find((candidate) => candidate.id === activeTabId);
  if (tab?.kind === 'page') void requestSourceModeToggle(tab.id);
}

/**
 * Markdown 三视图切换的统一入口：进入 preview 前先 flush（失败停留当前视图并返回
 * false），source/split 之间切换编辑器保持挂载，无需 flush。
 */
export async function requestMarkdownViewChange(
  tabId: string,
  view: MarkdownView,
): Promise<boolean> {
  if (switching.has(tabId)) return false;
  const tab = useTabStore.getState().tabs.find((candidate) => candidate.id === tabId);
  if (!tab || tab.kind !== 'page' || tab.format !== 'markdown') return false;
  const current = tab.markdownView ?? 'split';
  if (current === view) return true;
  if (view !== 'preview') {
    useTabStore.getState().setMarkdownView(tabId, view);
    return true;
  }
  switching.add(tabId);
  try {
    const prepare = previewEnterHandlers.get(tabId);
    if (prepare && !(await prepare())) return false;
    useTabStore.getState().setMarkdownView(tabId, 'preview');
    return true;
  } catch {
    // flush/保存失败时停留当前视图；视图负责呈现具体错误状态。
    return false;
  } finally {
    switching.delete(tabId);
  }
}

/** 命令面板/快捷键入口：对激活 tab 应用目标 Markdown 视图。 */
export function requestActiveMarkdownView(view: MarkdownView): void {
  const { tabs, activeTabId } = useTabStore.getState();
  const tab = tabs.find((candidate) => candidate.id === activeTabId);
  if (tab?.kind === 'page') void requestMarkdownViewChange(tab.id, view);
}

/** Mod+Shift+E：预览 ↔ 最近一次编辑视图。 */
export function requestActiveMarkdownPreviewToggle(): void {
  const state = useTabStore.getState();
  const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
  if (!tab || tab.format !== 'markdown') return;
  const current = tab.markdownView ?? 'split';
  void requestMarkdownViewChange(tab.id, current === 'preview' ? (tab.lastMarkdownEditView ?? 'split') : 'preview');
}
