import { describe, expect, it } from 'vitest';
import { DEFAULT_SHORTCUTS, defaultGlobalSettings } from './settings';

describe('DEFAULT_SHORTCUTS 页签循环切换（DEV-022）', () => {
  it('登记 tab.next / tab.prev 为 Ctrl+Tab / Ctrl+Shift+Tab', () => {
    expect(DEFAULT_SHORTCUTS.find((s) => s.commandId === 'tab.next')?.key).toBe('Ctrl+Tab');
    expect(DEFAULT_SHORTCUTS.find((s) => s.commandId === 'tab.prev')?.key).toBe('Ctrl+Shift+Tab');
  });

  it('默认全局设置携带 tab 循环切换绑定（进入快捷键设置分区）', () => {
    const shortcuts = defaultGlobalSettings().shortcuts;
    expect(
      shortcuts.some((s) => s.commandId === 'tab.next' && s.key === 'Ctrl+Tab' && !s.disabled),
    ).toBe(true);
    expect(
      shortcuts.some(
        (s) => s.commandId === 'tab.prev' && s.key === 'Ctrl+Shift+Tab' && !s.disabled,
      ),
    ).toBe(true);
  });
});
