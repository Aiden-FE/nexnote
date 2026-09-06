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
} from './frontmatter/model';
export type { FrontmatterData, FrontmatterValue } from './frontmatter/model';
export { KernelCodeBlock, KernelTable } from './extensions/code-table';
export { SlashMenu, defaultSlashMenuItems, slashMenuPluginKey } from './extensions/slash-menu';
export type { SlashMenuItem, SlashMenuOptions, SlashMenuState } from './extensions/slash-menu';
export { createKernelDragHandle } from './extensions/drag-handle';
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
