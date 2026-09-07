// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildMenuDom } from '../src/extensions/context-menu';

/**
 * DEV-017 菜单键盘导航（块菜单与右键菜单共用 buildMenuDom）：
 * ↑↓ 移动焦点 / Enter 执行 / → 进子菜单 / ← 返回 / Esc 逐层退出。
 */
function press(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function makeMenu(onAction: (id: string) => void) {
  return buildMenuDom(
    'nexnote-block-menu',
    [
      { id: 'copy', title: '复制' },
      { id: 'cut', title: '剪切' },
      { id: 'disabled-x', title: '禁用项', disabled: true },
      {
        title: '转换为',
        submenu: [
          { id: 'to-p', title: '段落' },
          { id: 'to-h1', title: '标题 1' },
        ],
      },
      { id: 'delete', title: '删除' },
    ],
    { x: 10, y: 10 },
    onAction,
  );
}

describe('菜单键盘导航（DEV-017）', () => {
  it('打开即聚焦首项（禁用项被跳过），↓ 移动到下一启用项', () => {
    const handle = makeMenu(() => undefined);
    const items = [...document.querySelectorAll<HTMLButtonElement>('.nexnote-block-menu__item')];
    expect(document.activeElement?.textContent).toBe('复制');
    press('ArrowDown');
    expect(document.activeElement?.textContent).toBe('剪切');
    press('ArrowDown'); // 跳过禁用项到「转换为」
    expect(document.activeElement?.textContent).toContain('转换为');
    press('ArrowUp');
    expect(document.activeElement?.textContent).toBe('剪切');
    expect(items.length).toBeGreaterThan(0);
    handle.destroy();
  });

  it('Enter 执行当前项并触发 onAction', () => {
    const fired: string[] = [];
    const handle = makeMenu((id) => fired.push(id));
    press('ArrowDown'); // 剪切
    press('Enter');
    expect(fired).toEqual(['cut']);
    handle.destroy();
  });

  it('→ 进入子菜单并聚焦首项，← 返回父级', () => {
    const fired: string[] = [];
    const handle = makeMenu((id) => fired.push(id));
    press('ArrowDown');
    press('ArrowDown'); // 转换为
    press('ArrowRight');
    expect(document.activeElement?.textContent).toBe('段落');
    press('ArrowDown');
    press('Enter'); // 标题 1
    expect(fired).toEqual(['to-h1']);
    handle.destroy();
  });

  it('子菜单内 ← 返回父级行，Esc 在顶层关闭菜单', () => {
    const handle = makeMenu(() => undefined);
    press('ArrowDown');
    press('ArrowDown'); // 转换为
    press('ArrowRight');
    expect(document.activeElement?.textContent).toBe('段落');
    press('ArrowLeft');
    expect(document.activeElement?.textContent).toContain('转换为');
    press('Escape');
    expect(document.querySelector('.nexnote-block-menu')).toBeNull();
    handle.destroy();
  });
});
