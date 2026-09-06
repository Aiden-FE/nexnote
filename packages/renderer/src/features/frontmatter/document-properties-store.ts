import { create } from 'zustand';
import type { FrontmatterData } from '@nexnote/kernel';

interface DocumentPropertiesState {
  filePath: string | null;
  markdown: string;
  data: FrontmatterData;
  setDocument: (document: { filePath: string; markdown: string; data: FrontmatterData }) => void;
  clearDocument: (filePath?: string) => void;
}

/** 当前激活编辑页面的属性，供右 Dock 无 props 面板读取。 */
export const useDocumentPropertiesStore = create<DocumentPropertiesState>((set) => ({
  filePath: null,
  markdown: '',
  data: {},
  setDocument: (document) => set(document),
  clearDocument: (filePath) =>
    set((state) => (filePath && state.filePath !== filePath ? state : { filePath: null, markdown: '', data: {} })),
}));
