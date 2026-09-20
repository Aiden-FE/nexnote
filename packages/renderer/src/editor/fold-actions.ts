/**
 * DEV-064：命令面板与快捷键共享的折叠动作入口。
 *
 * - 仅读取当前激活 tab 的编辑器实例（块/源码模式分别桥接到 kernel 与 source-fold API），
 *   不触及后台页面、不写入正文/sidecar；
 * - 折叠是各编辑器实例的临时 plugin/state-field 状态，重开页面自动恢复全部展开。
 * - 与既有 expand-all 模式保持单一权威（不重复分发）。
 */
import {
  currentSectionBlockId,
  expandBlockSection,
  foldBlockSection,
  foldBlocksToLevel,
  toggleBlockFold,
} from '@nexnote/kernel';

import { getEditorForTab } from './active-editor';
import {
  currentSourceHeadingId,
  foldSourceHeadingsToLevel,
  sourceFoldState,
  toggleSourceHeadingFoldById,
} from './source/heading-fold';
import { getSourceEditorForTab } from './source/active-source-editor';
import { useTabStore } from '../stores/tab-store';

interface ActiveEditorKind {
  kind: 'page';
  format: 'markdown' | 'native-block';
  tabId: string;
}

function resolveActive(): ActiveEditorKind | null {
  const store = useTabStore.getState();
  const activeId = store.activeTabId;
  if (!activeId) return null;
  const tab = store.tabs.find((candidate) => candidate.id === activeId);
  if (!tab || tab.kind !== 'page') return null;
  if (tab.format !== 'markdown' && tab.format !== 'native-block') return null;
  return { kind: 'page', format: tab.format, tabId: tab.id };
}

/** 切换当前章节：postMessage 有内容时折叠，无内容时展开（toggle 语义）。 */
export function toggleCurrentSectionFold(): boolean {
  const active = resolveActive();
  if (!active) return false;
  if (active.format === 'markdown') {
    const source = getSourceEditorForTab(active.tabId);
    if (!source) return false;
    const id = currentSourceHeadingId(source.view.state);
    if (id == null) return false;
    return toggleSourceHeadingFoldById(source.view, id);
  }
  const block = getEditorForTab(active.tabId);
  if (!block) return false;
  const blockId = currentSectionBlockId(block.editor.view.state);
  if (!blockId) return false;
  return toggleBlockFold(block.editor.view, blockId);
}

/** 折叠当前章节（postMessage）。 */
export function foldCurrentSection(): boolean {
  const active = resolveActive();
  if (!active) return false;
  if (active.format === 'markdown') {
    const source = getSourceEditorForTab(active.tabId);
    if (!source) return false;
    const id = currentSourceHeadingId(source.view.state);
    if (id == null) return false;
    const view = source.view;
    const current = sourceFoldState(view.state)?.folded.has(id) ?? false;
    if (!current) toggleSourceHeadingFoldById(view, id);
    return true;
  }
  const block = getEditorForTab(active.tabId);
  if (!block) return false;
  const blockId = currentSectionBlockId(block.editor.view.state);
  if (!blockId) return false;
  return foldBlockSection(block.editor.view, blockId);
}

/** 展开当前章节。 */
export function expandCurrentSection(): boolean {
  const active = resolveActive();
  if (!active) return false;
  if (active.format === 'markdown') {
    const source = getSourceEditorForTab(active.tabId);
    if (!source) return false;
    const id = currentSourceHeadingId(source.view.state);
    if (id == null) return false;
    return expandSourceHeadingSection(id);
  }
  const block = getEditorForTab(active.tabId);
  if (!block) return false;
  const blockId = currentSectionBlockId(block.editor.view.state);
  if (!blockId) return false;
  return expandBlockSection(block.editor.view, blockId);
}

/** 折叠到指定层级（1=H1, 2=H2, 3=H3 …）。返回实际折叠数量。 */
export function foldToLevel(level: number): number {
  const active = resolveActive();
  if (!active) return 0;
  if (active.format === 'markdown') {
    const source = getSourceEditorForTab(active.tabId);
    if (!source) return 0;
    return foldSourceHeadingsToLevel(source.view, level);
  }
  const block = getEditorForTab(active.tabId);
  if (!block) return 0;
  return foldBlocksToLevel(block.editor.view, level);
}

// ---- source-mode helpers (kept local to avoid widening kernel public API) ----

function expandSourceHeadingSection(id: number): boolean {
  // 复用 toggle 切换到展开态；调用方负责保证 id 仍对应可折叠的标题。
  const active = resolveActive();
  if (!active || active.format !== 'markdown') return false;
  const source = getSourceEditorForTab(active.tabId);
  if (!source) return false;
  const folded = sourceFoldState(source.view.state)?.folded;
  if (!folded?.has(id)) return true;
  toggleSourceHeadingFoldById(source.view, id);
  return true;
}
