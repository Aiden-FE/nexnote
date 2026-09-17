import { expandAllBlockFolds } from '@nexnote/kernel';
import { useTabStore } from '../stores/tab-store';
import { getEditorForTab } from './active-editor';
import { getSourceEditorForTab } from './source/active-source-editor';
import { expandAllSourceHeadingFolds } from './source/heading-fold';

export interface HeadingFoldsExpandedDetail {
  tabId: string;
  count: number;
}

export const HEADING_FOLDS_EXPANDED_EVENT = 'nexnote:heading-folds-expanded';

/**
 * 命令面板入口：只读取当前激活 tab 对应的编辑器实例，不触及后台页面。
 * 折叠是各编辑器实例的临时 plugin/state-field 状态，调用不会写入正文、sidecar 或文件。
 */
export function expandAllCurrentHeadingFolds(): number {
  const tab = useTabStore
    .getState()
    .tabs.find((candidate) => candidate.id === useTabStore.getState().activeTabId);
  if (!tab || tab.kind !== 'page') return 0;

  const count =
    tab.format === 'markdown'
      ? (() => {
          const source = getSourceEditorForTab(tab.id);
          return source ? expandAllSourceHeadingFolds(source.view) : 0;
        })()
      : (() => {
          const block = getEditorForTab(tab.id);
          return block ? expandAllBlockFolds(block.editor.view) : 0;
        })();

  window.dispatchEvent(
    new CustomEvent<HeadingFoldsExpandedDetail>(HEADING_FOLDS_EXPANDED_EVENT, {
      detail: { tabId: tab.id, count },
    }),
  );
  return count;
}
