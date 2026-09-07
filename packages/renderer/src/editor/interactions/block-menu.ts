import type { ContextMenuItem } from '@nexnote/kernel';
import type { BlockMenuContext } from '@nexnote/kernel';
import type { EditorKernelInstance } from '@nexnote/kernel';

/**
 * DEV-017 块菜单（渲染层构建）：
 * - 基础：复制 / 剪切 / 删除 / 复制块 ID / 转换为子菜单 / 上移 / 下移 / 折叠 / 上下插入
 * - AI 子菜单（DEV-010 六动作，经 writingController）
 * - 插件菜单项（DEV-014 注册表）
 *
 * 动作经 onAction 分发给 kernel 命令（事务式、可撤销）。
 */

export const BLOCK_MENU_PREFIX = 'block-menu:';

/** 块菜单执行时所需的块序上下文（相邻块 id 供上移/下移）。 */
export interface BlockNeighbors {
  prevBlockId: string | null;
  nextBlockId: string | null;
}
export const BLOCK_MENU_AI_PREFIX = 'block-menu-ai:';
export const BLOCK_MENU_PLUGIN_PREFIX = 'block-menu-plugin:';
export const BLOCK_MENU_CONVERT_PREFIX = 'block-menu-convert:';

export function blockMenuActionId(id: string): string {
  return `${BLOCK_MENU_PREFIX}${id}`;
}

export interface BlockMenuDeps {
  getKernel: () => EditorKernelInstance | null;
  /** AI 写作条目构建（可注入 writingContextMenu 的扩展版） */
  buildAiSubmenu?: (ctx: BlockMenuContext) => ContextMenuItem[];
  /** 插件菜单条目（可注入 buildPluginMenuItems 结果） */
  pluginItems?: ContextMenuItem[];
  /** 上移/下移/折叠/插入是否可用（由渲染层按编辑器状态提供） */
  canFold?: (ctx: BlockMenuContext) => boolean;
  /** 当前块是否已折叠（决定菜单项标题为「折叠」还是「展开」） */
  isFolded?: (ctx: BlockMenuContext) => boolean;
}

/** 块菜单条目：分隔线用空 title 标记（ContextMenuItem 语义兼容）。 */
export type BlockMenuEntry = ContextMenuItem;

export function buildBlockMenuItems(ctx: BlockMenuContext, deps: BlockMenuDeps): BlockMenuEntry[] {
  const ai = deps.buildAiSubmenu?.(ctx) ?? [];
  const items: BlockMenuEntry[] = [
    { id: blockMenuActionId('copy'), title: '复制' },
    { id: blockMenuActionId('cut'), title: '剪切' },
    { id: blockMenuActionId('delete'), title: '删除' },
    { id: blockMenuActionId('copy-id'), title: '复制块 ID' },
    {
      title: '转换为',
      submenu: [
        { id: `${BLOCK_MENU_CONVERT_PREFIX}paragraph`, title: '段落' },
        { id: `${BLOCK_MENU_CONVERT_PREFIX}h1`, title: '标题 1' },
        { id: `${BLOCK_MENU_CONVERT_PREFIX}h2`, title: '标题 2' },
        { id: `${BLOCK_MENU_CONVERT_PREFIX}h3`, title: '标题 3' },
        { id: `${BLOCK_MENU_CONVERT_PREFIX}taskList`, title: '任务列表' },
        { id: `${BLOCK_MENU_CONVERT_PREFIX}blockquote`, title: '引用' },
        { id: `${BLOCK_MENU_CONVERT_PREFIX}callout`, title: '标注块' },
        { id: `${BLOCK_MENU_CONVERT_PREFIX}codeBlock`, title: '代码块' },
      ],
    },
    { separator: true, title: '' },
    { id: blockMenuActionId('move-up'), title: '上移', hint: '⌥↑' },
    { id: blockMenuActionId('move-down'), title: '下移', hint: '⌥↓' },
    {
      id: blockMenuActionId('fold'),
      title: deps.isFolded?.(ctx) ? '展开' : '折叠',
      disabled: !deps.canFold?.(ctx),
    },
    { separator: true, title: '' },
    { id: blockMenuActionId('insert-before'), title: '在上方插入' },
    { id: blockMenuActionId('insert-after'), title: '在下方插入' },
    ...(ai.length > 0 ? [{ separator: true as const, title: '' }, ...ai] : []),
    ...(deps.pluginItems?.length ? [{ separator: true as const, title: '' }, ...deps.pluginItems] : []),
  ];
  return items;
}

/** 块菜单动作执行（内核事务）。返回是否已处理。 */
export function runBlockMenuAction(
  id: string,
  ctx: BlockMenuContext,
  kernel: EditorKernelInstance | null,
  neighbors: BlockNeighbors,
): boolean {
  if (!kernel) return false;
  switch (id) {
    case blockMenuActionId('copy'): {
      const md = kernel.getBlockMarkdown(ctx.from, ctx.to);
      void navigator.clipboard?.writeText(md);
      return true;
    }
    case blockMenuActionId('cut'): {
      const md = kernel.getBlockMarkdown(ctx.from, ctx.to);
      const write = navigator.clipboard?.writeText(md);
      if (!write) return false; // 剪贴板不可用：不删除，避免「剪切变删除」
      // 写成功后才删除；按 blockId 重解析位置，防止异步窗口内文档变化误删
      void write.then(
        () => kernel.deleteBlockById(ctx.blockId),
        () => undefined,
      );
      return true;
    }
    case blockMenuActionId('delete'): {
      return kernel.deleteBlockById(ctx.blockId);
    }
    case blockMenuActionId('copy-id'): {
      void navigator.clipboard?.writeText(ctx.blockId);
      return true;
    }
    case blockMenuActionId('move-up'):
      return neighbors.prevBlockId
        ? kernel.moveBlock(ctx.blockId, neighbors.prevBlockId, 'before')
        : false;
    case blockMenuActionId('move-down'):
      return neighbors.nextBlockId
        ? kernel.moveBlock(ctx.blockId, neighbors.nextBlockId, 'after')
        : false;
    case blockMenuActionId('fold'): {
      // 标题折叠：视图层装饰状态（内核 Fold 扩展），不写 Markdown
      return kernel.toggleBlockFold(ctx.blockId);
    }
    case blockMenuActionId('insert-before'):
      return kernel.insertEmptyBlock(ctx.from, 'before');
    case blockMenuActionId('insert-after'):
      return kernel.insertEmptyBlock(ctx.to, 'after');
    default:
      if (id.startsWith(BLOCK_MENU_CONVERT_PREFIX)) {
        return kernel.convertBlock(id.slice(BLOCK_MENU_CONVERT_PREFIX.length), ctx.from, ctx.to);
      }
      return false;
  }
}
