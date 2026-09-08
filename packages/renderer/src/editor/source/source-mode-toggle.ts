import { useTabStore } from '../../stores/tab-store';

export type ModeSwitchHandler = () => boolean | Promise<boolean>;

const handlers = new Map<string, ModeSwitchHandler>();
const switching = new Set<string>();

/** 当前挂载模式登记「离开前 flush/校验」逻辑。 */
export function registerModeSwitchHandler(tabId: string, handler: ModeSwitchHandler): () => void {
  handlers.set(tabId, handler);
  return () => {
    if (handlers.get(tabId) === handler) handlers.delete(tabId);
  };
}

/** 三个入口共用的唯一切换路径；失败时保持当前模式。 */
export async function requestSourceModeToggle(tabId: string): Promise<boolean> {
  if (switching.has(tabId)) return false;
  const tab = useTabStore.getState().tabs.find((candidate) => candidate.id === tabId);
  if (!tab || tab.kind !== 'page') return false;
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
