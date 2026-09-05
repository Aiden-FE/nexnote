import { Extension } from '@tiptap/core';
import { UniqueID } from '@tiptap/extension-unique-id';
import type { Extensions } from '@tiptap/core';

import { BLOCK_ID_TYPES } from '../markdown/block-id';

/**
 * 块 ID 系统：
 * - UniqueID 给新块分配稳定 ID（Obsidian 兼容字符集：字母/数字/连字符）
 * - 已有 `^id`（parse 时提取为 blockId 属性）原样保留，不重新生成
 * - 持久化经 markdown/block-id.ts 管道写回 `^id` 锚点
 */

let idCounter = 0;

/** 生成 Obsidian 兼容的短块 ID（`^[A-Za-z0-9-]+`）。 */
export function generateBlockId(): string {
  idCounter = (idCounter + 1) % 0xffff;
  const rand = Math.random().toString(36).slice(2, 8).replace(/[^a-z0-9]/g, '');
  const suffix = rand.padEnd(6, '0').slice(0, 6);
  return `${suffix}${idCounter.toString(36)}`;
}

export function createBlockIdExtensions(): Extensions {
  return [
    UniqueID.configure({
      attributeName: 'blockId',
      types: [...BLOCK_ID_TYPES],
      generateID: () => generateBlockId(),
    }),
  ];
}

/** 便捷取块 ID 的扩展（无副作用，仅类型挂载由 UniqueID 完成）。 */
export const BlockIdHelper = Extension.create({
  name: 'nexnoteBlockIdHelper',
});
