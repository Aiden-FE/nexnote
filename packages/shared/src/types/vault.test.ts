import { describe, expect, it } from 'vitest';
import { defaultVaultLayout } from './vault';

describe('defaultVaultLayout', () => {
  it('首次打开使用单 pane 且默认关闭 Dock', () => {
    const layout = defaultVaultLayout();

    expect(layout.dockVisible).toBe(false);
    expect(layout.splitEnabled).toBe(false);
  });

  it('每次返回独立的目录折叠数组', () => {
    expect(defaultVaultLayout().treeCollapsedDirs).not.toBe(defaultVaultLayout().treeCollapsedDirs);
  });
});
