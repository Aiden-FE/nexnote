import { Extension } from '@tiptap/core';
import { UniqueID } from '@tiptap/extension-unique-id';
import type { Editor, Extensions } from '@tiptap/core';

import { BLOCK_ID_TYPES } from '../markdown/block-id';

/**
 * 块 ID 系统：
 * - UniqueID 给新块分配稳定 ID（Obsidian 兼容字符集：字母/数字/连字符）
 * - 已有 `^id`（parse 时提取为 blockId 属性）原样保留，不重新生成
 * - 持久化经 markdown/block-id.ts 管道写回 `^id` 锚点
 *
 * UniqueID 在 onCreate 里给所有缺 ID 的块补 ID 并 dispatch，一次真实的 doc 变更。
 * 外部写入、没有 `^id` 锚点的文件因此在「只是打开」时就会产生 update 事件；若把它
 * 当作用户编辑调度保存，文件会被静默重写（补锚点 + 序列化归一化）。下面两个零成本
 * 扩展夹住 UniqueID（priority 1e4）的 onCreate，标记出这段初始化窗口。
 */

const initWindows = new WeakMap<Editor, { active: boolean }>();

/** 当前 update 是否来自 UniqueID 的初始化补 ID 事务（而非用户编辑）。 */
export function isBlockIdInitTransaction(editor: Editor): boolean {
  return initWindows.get(editor)?.active === true;
}

let idCounter = 0;

/** 生成 Obsidian 兼容的短块 ID（`^[A-Za-z0-9-]+`）。 */
export function generateBlockId(): string {
  idCounter = (idCounter + 1) % 0xffff;
  const rand = Math.random()
    .toString(36)
    .slice(2, 8)
    .replace(/[^a-z0-9]/g, '');
  const suffix = rand.padEnd(6, '0').slice(0, 6);
  return `${suffix}${idCounter.toString(36)}`;
}

export function createBlockIdExtensions(): Extensions {
  return [
    Extension.create({
      name: 'nexnoteBlockIdInitWindowOpen',
      priority: 10_001,
      onCreate() {
        initWindows.set(this.editor, { active: true });
      },
    }),
    UniqueID.configure({
      attributeName: 'blockId',
      types: [...BLOCK_ID_TYPES],
      generateID: () => generateBlockId(),
    }),
    Extension.create({
      name: 'nexnoteBlockIdInitWindowClose',
      priority: 9_999,
      onCreate() {
        initWindows.delete(this.editor);
      },
    }),
  ];
}

/** 便捷取块 ID 的扩展（无副作用，仅类型挂载由 UniqueID 完成）。 */
export const BlockIdHelper = Extension.create({
  name: 'nexnoteBlockIdHelper',
});
