import { create } from 'zustand';
import type { FrontmatterData } from '@nexnote/kernel';

interface DocumentPropertiesState {
  filePath: string | null;
  markdown: string;
  data: FrontmatterData;
  /**
   * DEV-080：当前文档的派生 format（来自 tab.format 或扩展名派生）。用于右侧
   * PropertiesPanel 的「类型」行展示，不再读取 frontmatter.type（已被移除）。
   */
  format: string | null;
  setDocument: (document: {
    filePath: string;
    markdown: string;
    data: FrontmatterData;
    format?: string | null;
  }) => void;
  clearDocument: (filePath?: string) => void;
}

/** 当前激活编辑页面的属性，供右 Dock 无 props 面板读取。 */
export const useDocumentPropertiesStore = create<DocumentPropertiesState>((set) => ({
  filePath: null,
  markdown: '',
  data: {},
  format: null,
  setDocument: (document) =>
    set({
      filePath: document.filePath,
      markdown: document.markdown,
      data: document.data,
      format: document.format ?? null,
    }),
  clearDocument: (filePath) =>
    set((state) =>
      filePath && state.filePath !== filePath
        ? state
        : { filePath: null, markdown: '', data: {}, format: null }
    ),
}));