// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { computeMenuViewportPlacement } from '../src/extensions/menu-viewport';

describe('编辑器菜单视口定位（DEV-062）', () => {
  it('下方容不下时翻到光标上方，并用实际可用空间限制高度', () => {
    expect(
      computeMenuViewportPlacement({
        anchor: { top: 170, bottom: 190 },
        viewport: { top: 20, bottom: 200 },
        desiredHeight: 240,
        gap: 6,
        margin: 8,
      }),
    ).toEqual({
      placement: 'above',
      maxHeight: 136,
      top: 28,
    });
  });

  it('下方空间足够时保持向下，并保留 viewport margin', () => {
    expect(
      computeMenuViewportPlacement({
        anchor: { top: 40, bottom: 60 },
        viewport: { top: 0, bottom: 300 },
        desiredHeight: 120,
        gap: 6,
        margin: 8,
      }),
    ).toEqual({
      placement: 'below',
      maxHeight: 226,
      top: 66,
    });
  });
});
