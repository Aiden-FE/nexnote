import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MINDMAP_STRUCTURE,
  MINDMAP_STRUCTURE_OPTIONS,
  countRootChildren,
  isStructureSelectable,
  structureById,
} from '../src/binary-host/mindmap-structures';

/** DEV-102：布局结构选项定义 + X 结构的可用性门控（ADR-0020 决策 4）。
 * 纯函数，不依赖 simple-mind-map 实例。 */

describe('布局结构选项（DEV-102）', () => {
  it('六个选项按 右/左/上/下/鱼骨/X 排列，默认向右', () => {
    expect(MINDMAP_STRUCTURE_OPTIONS.map((o) => o.id)).toEqual([
      'right',
      'left',
      'up',
      'down',
      'fishbone',
      'x',
    ]);
    expect(DEFAULT_MINDMAP_STRUCTURE).toBe('right');
  });

  it('每个选项都有中文标签与渲染用布局名', () => {
    for (const option of MINDMAP_STRUCTURE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.layout.length).toBeGreaterThan(0);
    }
  });

  it('未知 id 回退到默认结构，不抛错', () => {
    expect(structureById('nope' as never).id).toBe('right');
  });
});

describe('X 结构门控（DEV-102 决策 4）', () => {
  const others = MINDMAP_STRUCTURE_OPTIONS.filter((o) => o.id !== 'x');

  it('根节点子节点 < 2 时 X 不可选，其余结构始终可选', () => {
    for (const count of [0, 1]) {
      expect(isStructureSelectable('x', count)).toBe(false);
      for (const option of others) {
        expect(isStructureSelectable(option.id, count)).toBe(true);
      }
    }
  });

  it('根节点子节点 ≥ 2 时 X 可选', () => {
    for (const count of [2, 3, 4, 9]) {
      expect(isStructureSelectable('x', count)).toBe(true);
    }
  });
});

describe('根节点子节点计数（DEV-102）', () => {
  it('从 simple-mind-map 的 model 读一级子节点数', () => {
    const model = {
      data: { text: 'root' },
      children: [
        { data: { text: 'a' } },
        { data: { text: 'b' }, children: [{ data: { text: 'b1' } }] },
      ],
    };
    expect(countRootChildren(model)).toBe(2);
  });

  it('缺 children / 非法输入按 0 处理（不抛错）', () => {
    expect(countRootChildren({ data: { text: 'root' } })).toBe(0);
    expect(countRootChildren(null)).toBe(0);
    expect(countRootChildren('x' as never)).toBe(0);
    expect(countRootChildren({ children: 'no' } as never)).toBe(0);
  });
});
