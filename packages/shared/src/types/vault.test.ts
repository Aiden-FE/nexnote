import { describe, expect, it } from 'vitest';
import { defaultVaultLayout } from './vault';

describe('defaultVaultLayout', () => {
  it('首次打开为单 tab 栈且默认关闭 Dock（DEV-020 移除 split 字段）', () => {
    const layout = defaultVaultLayout() as unknown as Record<string, unknown>;

    expect(layout.dockVisible).toBe(false);
    expect(layout.splitEnabled).toBeUndefined();
    expect(layout.splitRatio).toBeUndefined();
  });

  it('每次返回独立的目录折叠数组', () => {
    expect(defaultVaultLayout().treeCollapsedDirs).not.toBe(defaultVaultLayout().treeCollapsedDirs);
  });
});
