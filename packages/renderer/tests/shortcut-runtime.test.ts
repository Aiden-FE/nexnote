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

describe('ShortcutRuntime Ctrl+Tab 页签循环切换（DEV-022）', () => {
  const tabDefaults: readonly ShortcutOverride[] = [
    { commandId: 'tab.next', key: 'Ctrl+Tab', disabled: false },
    { commandId: 'tab.prev', key: 'Ctrl+Shift+Tab', disabled: false },
  ];

  function makeTabRuntime(platform: 'mac' | 'other'): {
    runtime: ShortcutRuntime;
    target: HTMLElement;
    fired: string[];
  } {
    const runtime = new ShortcutRuntime(platform);
    runtime.setOverrides([], tabDefaults);
    const fired: string[] = [];
    runtime.registerCommand('tab.next', () => fired.push('tab.next'));
    runtime.registerCommand('tab.prev', () => fired.push('tab.prev'));
    const target = document.createElement('div');
    document.body.append(target);
    runtime.attach(target);
    return { runtime, target, fired };
  }

  function pressTab(target: EventTarget, shiftKey = false): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      ctrlKey: true,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('macOS：物理 Ctrl+Tab / Ctrl+Shift+Tab 触发 tab.next / tab.prev', () => {
    const { runtime, target, fired } = makeTabRuntime('mac');
    expect(runtime.getKeyForCommand('tab.next')).toBe('Ctrl+Tab');
    pressTab(target);
    pressTab(target, true);
    expect(fired).toEqual(['tab.next', 'tab.prev']);
  });

  it('Windows/Linux：Ctrl 物理键归一为 Mod，同一默认绑定仍触发', () => {
    const { target, fired } = makeTabRuntime('other');
    pressTab(target);
    pressTab(target, true);
    expect(fired).toEqual(['tab.next', 'tab.prev']);
  });

  it('焦点在输入框内时循环切换仍生效（tab 切换属全局级语义）', () => {
    const { target, fired } = makeTabRuntime('mac');
    const input = document.createElement('input');
    target.append(input);
    pressTab(input);
    expect(fired).toEqual(['tab.next']);
  });

  it('按键触发后阻止默认 Tab 行为（焦点跳移）', () => {
    const { target } = makeTabRuntime('mac');
    const event = pressTab(target);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('内置命令 tab.next / tab.prev（DEV-022）', () => {
  it('命令已注册且驱动 tab-store 循环切换', async () => {
    const { commandRegistry } = await import('../src/registries');
    await import('../src/features/commands/builtin');
    const next = commandRegistry.get('tab.next');
    const prev = commandRegistry.get('tab.prev');
    expect(next?.run).toBeTruthy();
    expect(prev?.run).toBeTruthy();

    const { useTabStore } = await import('../src/stores/tab-store');
    useTabStore.setState({ tabs: [], activeTabId: null });
    const a = useTabStore.getState().openTab({ kind: 'page', title: 'A' });
    const b = useTabStore.getState().openTab({ kind: 'page', title: 'B' }); // active
    next?.run();
    expect(useTabStore.getState().activeTabId).toBe(a.id); // 回绕到首个
    prev?.run();
    expect(useTabStore.getState().activeTabId).toBe(b.id); // 回到末位
    useTabStore.setState({ tabs: [], activeTabId: null });
  });
});
