export {
  EDITOR_ACTION_CATALOG as SHARED_SLASH_ACTIONS,
  editorActionCatalogEntry as sharedSlashAction,
  quickInsertCatalog,
} from './editor-actions';
export type {
  EditorActionCatalogEntry as SharedSlashAction,
  QuickInsertCapability,
  QuickInsertExecution,
  QuickInsertGroup as SlashActionGroup,
  QuickInsertKind as SlashActionKind,
} from './editor-actions';
export const SLASH_ACTION_GROUP_ORDER = ['基础块', '插入', 'AI', '插件'] as const;
