/**
 * @nexnote/kernel — 编辑器内核（框架无关）。
 *
 * TipTap 3 + @tiptap/markdown（Obsidian 方言）：
 * - createEditor：编辑器工厂（DOM 容器 + 配置 → 内核实例）
 * - parseMarkdown / serializeMarkdown：Markdown ↔ TipTap JSON 双向管道
 * - 方言：wikilink [[title|alias]]、^id 块锚点、callout > [!note]、内联 #tag、frontmatter
 * - 块稳定 ID（UniqueID → blockId 属性 → ^id 持久化）
 * - 保存防抖调度器 + revision 计数（协作预留）
 */

export { KERNEL_VERSION } from './version';

export { createEditor } from './editor';
export type { EditorKernelConfig, EditorKernelInstance } from './editor';

export { buildKernelExtensions } from './extensions';
export type { KernelExtensionsOptions } from './extensions';
export { Callout, CALLOUT_TYPES } from './extensions/callout';
export type { CalloutType } from './extensions/callout';
export { Wikilink } from './extensions/wikilink';
export { Hashtag } from './extensions/hashtag';
export { Frontmatter, splitFrontmatter } from './extensions/frontmatter';
export {
  assertSafeFrontmatterKey,
  fieldTypeOf,
  getList,
  getString,
  isStandardField,
  normalizeList,
  parseFrontmatterYaml,
  serializeFrontmatterYaml,
  STANDARD_FIELD_CATALOG,
} from './frontmatter/model';
export type {
  FrontmatterData,
  FrontmatterValue,
  StandardFieldDef,
  StandardFieldType,
} from './frontmatter/model';
export { KernelCodeBlock, KernelTable } from './extensions/code-table';
export { fenceHighlighter, createFenceHighlighter } from './highlight/fence-highlight';
export type { FenceHighlighter, FenceTokenSpan } from './highlight/fence-highlight';
export {
  SlashMenu,
  defaultSlashMenuItems,
  filterSlashItems,
  slashMenuPluginKey,
} from './extensions/slash-menu';
export { insertAtSafeBlockBoundary } from './extensions/slash-contract';
export type {
  SlashMenuContext,
  SlashMenuItem,
  SlashMenuOptions,
  SlashMenuState,
} from './extensions/slash-menu';
export {
  Fold,
  foldPluginKey,
  canFoldBlock,
  clearBlockFolds,
  collectFoldHeadings,
  currentSectionBlockId,
  expandAllBlockFolds,
  expandBlockSection,
  foldBlocksToLevel,
  foldBlockSection,
  isBlockFolded,
  revealBlockFoldAt,
  toggleBlockFold,
  toggleFoldActionLabel,
} from './extensions/fold';
export type { FoldHeadingDescriptor } from './extensions/fold';
export {
  EDITOR_GUTTER_WIDTH_REM,
  EDITOR_GUTTER_HANDLE_COLUMN_REM,
  EDITOR_GUTTER_CHEVRON_COLUMN_REM,
  buildDragHandleMiddleware,
  createKernelDragHandle,
  topLevelBlockIdAt,
} from './extensions/drag-handle';
export { mountUnifiedGutter } from './editor/unified-gutter';
export type { UnifiedGutterController } from './editor/unified-gutter';
export {
  SelectionBubble,
  selectionBubblePluginKey,
  createBubbleAiMenu,
  attachBubbleTooltip,
  decorateBubbleButton,
  refreshBubbleButton,
} from './extensions/selection-bubble';
export { createSelectionToolbarHost } from './extensions/selection-toolbar-host';
export type {
  SelectionToolbarHost,
  SelectionToolbarHostOptions,
} from './extensions/selection-toolbar-host';
export {
  defaultBubbleIconRenderer,
  buildLucideSvg,
  SVG_NS,
  LUCIDE_VIEWBOX,
} from './extensions/selection-bubble-icons';
export type {
  BubbleAction,
  BubbleIconName,
  BubbleIconRenderer,
  BubbleAiMenuOptions,
  BubbleAiMenuView,
  BubbleExtraControl,
  SelectionBubbleOptions,
} from './extensions/selection-bubble';
export {
  bindSelectionBubbleToolbarRoving,
  dispatchBubbleShortcut,
  disableSelectionBubbleToolbarTabStops,
  moveSelectionBubbleToolbarFocus,
  syncSelectionBubbleToolbarTabStop,
} from './extensions/selection-bubble-roving';
export { ContextMenu, contextMenuPluginKey } from './extensions/context-menu';
export type { ContextMenuItem, ContextMenuOptions } from './extensions/context-menu';
export { PluginBlock, PLUGIN_BLOCK_FENCE } from './extensions/plugin-block';
export type { PluginBlockAttributes } from './extensions/plugin-block';
export { SuggestionMenu } from './extensions/suggestion-menu';
export {
  applyMenuViewportPlacement,
  computeMenuViewportPlacement,
  findScrollViewport,
  positionMenuInViewport,
  readMenuHeight,
  readMenuViewport,
  scrollActiveMenuItemIntoView,
  MENU_VIEWPORT_GAP,
  MENU_VIEWPORT_MARGIN,
} from './extensions/menu-viewport';
export type {
  MenuAnchorRect,
  MenuViewportPlacement,
  MenuViewportRect,
} from './extensions/menu-viewport';
export type {
  SuggestionItem,
  SuggestionKind,
  SuggestionTrigger,
} from './extensions/suggestion-menu';
export { BlockMenu } from './extensions/block-menu';
export type { BlockMenuContext, BlockMenuState } from './extensions/block-menu';
export {
  MermaidBlock,
  MERMAID_BLOCK_NAME,
  MERMAID_LANGUAGE,
  MERMAID_DEFAULT_SOURCE,
  MERMAID_FLOWCHART_SOURCE,
  MERMAID_GANTT_SOURCE,
} from './extensions/mermaid';
export { MathBlock, MathInline, MATH_BLOCK_NAME, MATH_INLINE_NAME } from './extensions/math';
export {
  TableOfContents,
  TABLE_OF_CONTENTS_MARKER,
  TABLE_OF_CONTENTS_NAME,
} from './extensions/table-of-contents';
export { computeEditorActionContext } from './extensions/action-context';
export type { EditorActionContext, EditorActionTarget } from './extensions/action-context';
export { generateBlockId } from './extensions/block-id';

export {
  createMarkdownManager,
  createObsidianMarked,
  parseMarkdown,
  serializeMarkdown,
  normalizeForCompare,
} from './markdown/pipeline';
export {
  BLOCK_ID_TYPES,
  replaceAnchorsWithPlaceholders,
  finalizeAnchors,
  liftPlaceholdersToBlockIds,
  injectPlaceholderForBlockIds,
} from './markdown/block-id';

export { createSaveScheduler } from './save';
export type { SaveScheduler, SaveSchedulerOptions } from './save';