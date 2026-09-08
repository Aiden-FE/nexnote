// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { ShortcutRuntime } from '../src/shortcuts/shortcut-runtime';
import type { ShortcutOverride } from '@nexnote/shared';

const defaults: readonly ShortcutOverride[] = [
  { commandId: 'app.palette', key: 'Mod+K', disabled: false },
  { commandId: 'editor.toggleSourceMode', key: 'Mod+E', disabled: false },
];

function makeRuntime(): { runtime: ShortcutRuntime; target: HTMLElement; fired: string[] } {
  const runtime = new ShortcutRuntime();
  runtime.setOverrides([], defaults);
  const fired: string[] = [];
  runtime.registerCommand('app.palette', () => fired.push('app.palette'));
  runtime.registerCommand('editor.toggleSourceMode', () => fired.push('editor.toggleSourceMode'));
  const target = document.createElement('div');
  target.setAttribute('data-testid', 'host');
  document.body.append(target);
  runtime.attach(target);
  return { runtime, target, fired };
}

function modE(target: EventTarget, preventDefault = false): KeyboardEvent {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const event = new KeyboardEvent('keydown', {
    key: 'e',
    metaKey: isMac,
    ctrlKey: !isMac,
    bubbles: true,
    cancelable: true,
  });
  if (preventDefault) event.preventDefault();
  target.dispatchEvent(event);
  return event;
}

describe('ShortcutRuntime（DEV-020 源码模式 ⌘/Ctrl+E）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('Mod+E 绑定 editor.toggleSourceMode 命令（默认快捷键入口 2）', () => {
    const { runtime, target, fired } = makeRuntime();
    expect(runtime.getKeyForCommand('editor.toggleSourceMode')).toBe('Mod+E');
    modE(target);
    expect(fired).toEqual(['editor.toggleSourceMode']);
  });

  it('事件已 preventDefault（深层 handler 已处理）时全局命令不重复触发', () => {
    const { target, fired } = makeRuntime();
    // 块编辑器选中态 ⌘E 行内代码已 preventDefault：不得再切换源码模式
    modE(target, true);
    expect(fired).toEqual([]);
  });
});
