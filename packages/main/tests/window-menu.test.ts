import { describe, expect, it } from 'vitest';
import type { MenuAction } from '@nexnote/shared';
import { buildApplicationMenuTemplate } from '../src/window-menu';

describe('native application menu localization (ADR-0023 stage 3)', () => {
  it('materializes custom labels and actions in English', () => {
    const actions: MenuAction[] = [];
    const send = (action: MenuAction): void => {
      actions.push(action);
    };
    const [file] = buildApplicationMenuTemplate('en-US', send);
    const items = (file?.submenu ?? []) as Electron.MenuItemConstructorOptions[];
    expect(file?.label).toBe('File');
    expect(items.map((item) => item.label)).toEqual([
      'New document (block editing)',
      'New Markdown (source mode)',
      undefined,
      'New blank XLSX',
      'New blank XMind',
      undefined,
      'Import Word document (convert to block document)…',
      'Import XLSX…',
      'Import XMind…',
    ]);
    (items[0]?.click as () => void)();
    (items[4]?.click as (() => void) | undefined)?.();
    expect(actions).toEqual([
      { type: 'createNote', format: 'native-block' },
      { type: 'createBlankBinary', kind: 'xmind' },
    ]);
  });

  it('materializes custom labels in Chinese and preserves accelerators', () => {
    const [file] = buildApplicationMenuTemplate('zh-CN', () => undefined);
    const items = (file?.submenu ?? []) as Electron.MenuItemConstructorOptions[];
    expect(file?.label).toBe('文件');
    expect(items[0]?.label).toBe('新建文档（块编辑）');
    expect(items[0]?.accelerator).toBe('CmdOrCtrl+N');
    expect(items[1]?.accelerator).toBe('CmdOrCtrl+Shift+N');
  });
});
