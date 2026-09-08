import type { ShortcutOverride } from '@nexnote/shared';

/**
 * 快捷键运行时：维护 commandId → canonical key 映射，
 * 监听全局 keydown，匹配时触发对应 command。
 *
 * 修饰符规范（与 Electron accelerator 对齐）：
 * - Mod = Cmd（macOS）/ Ctrl（Windows/Linux）
 * - 修饰顺序：Mod + Ctrl + Alt + Shift + Key
 * - 大小写：Key 部分首字母大写（如 K、F、S）
 */
export class ShortcutRuntime {
  private bindings = new Map<string, string>();
  private commandHandlers = new Map<string, () => void>();
  private listener: ((e: KeyboardEvent) => void) | null = null;
  private isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  /** 从设置（覆盖 + 内置默认）更新全部绑定。 */
  setOverrides(overrides: ShortcutOverride[], defaults: readonly ShortcutOverride[]): void {
    this.bindings.clear();
    const overrideMap = new Map(overrides.map((o) => [o.commandId, o]));
    for (const def of defaults) {
      const ov = overrideMap.get(def.commandId);
      if (ov?.disabled) continue;
      const key = ov?.key || def.key;
      if (key) this.bindings.set(def.commandId, key);
    }
    // 只在 override 中出现的（新增命令）
    for (const ov of overrides) {
      if (!this.bindings.has(ov.commandId) && !ov.disabled && ov.key) {
        this.bindings.set(ov.commandId, ov.key);
      }
    }
  }

  /** 注册一个 command 的执行函数。 */
  registerCommand(commandId: string, handler: () => void): void {
    this.commandHandlers.set(commandId, handler);
  }

  unregisterCommand(commandId: string): void {
    this.commandHandlers.delete(commandId);
  }

  /** 绑定到 DOM（通常是 window）。 */
  attach(target: Window | HTMLElement): void {
    this.detach();
    this.listener = (e: KeyboardEvent) => this.handleKey(e);
    target.addEventListener('keydown', this.listener as EventListener);
  }

  detach(): void {
    if (this.listener) {
      window.removeEventListener('keydown', this.listener as EventListener);
      this.listener = null;
    }
  }

  /** 当前某 key 绑定了哪些命令（碰撞检测用）。 */
  findCommandsForKey(key: string): string[] {
    const result: string[] = [];
    for (const [cmd, k] of this.bindings) {
      if (k === key) result.push(cmd);
    }
    return result;
  }

  /** 获取所有碰撞：绑定到同一 key 的命令组。 */
  findAllCollisions(): Map<string, string[]> {
    const byKey = new Map<string, string[]>();
    for (const [cmd, key] of this.bindings) {
      const list = byKey.get(key) ?? [];
      list.push(cmd);
      byKey.set(key, list);
    }
    const collisions = new Map<string, string[]>();
    for (const [key, cmds] of byKey) {
      if (cmds.length > 1) collisions.set(key, cmds);
    }
    return collisions;
  }

  getKeyForCommand(commandId: string): string | null {
    return this.bindings.get(commandId) ?? null;
  }

  getAllBindings(): Array<{ commandId: string; key: string }> {
    return [...this.bindings.entries()].map(([commandId, key]) => ({ commandId, key }));
  }

  private handleKey(e: KeyboardEvent): void {
    // 输入框内不触发（除了 Cmd/K 这类全局导航键）
    if (isEditableTarget(e.target as HTMLElement)) {
      // 仅全局命令（如保存、命令面板）在编辑框中也生效
    }
    // 更深层 handler 已处理并 preventDefault（如块编辑器选中态 ⌘E 行内代码）：
    // 全局命令不得重复触发，否则会同时格式化并切走源码模式。
    if (e.defaultPrevented) return;
    const key = this.eventToCanonical(e);
    if (!key) return;
    for (const [cmd, bound] of this.bindings) {
      if (bound === key) {
        const handler = this.commandHandlers.get(cmd);
        if (handler) {
          e.preventDefault();
          e.stopPropagation();
          handler();
          return;
        }
      }
    }
  }

  private eventToCanonical(e: KeyboardEvent): string | null {
    const parts: string[] = [];
    const hasMod = this.isMac ? e.metaKey : e.ctrlKey;
    const hasCtrl = this.isMac ? e.ctrlKey : false;
    const hasAlt = e.altKey;
    const hasShift = e.shiftKey;

    if (hasMod) parts.push('Mod');
    if (hasCtrl) parts.push('Ctrl');
    if (hasAlt) parts.push('Alt');
    if (hasShift) parts.push('Shift');

    const key = e.key;
    // 忽略纯修饰键
    if (key === 'Meta' || key === 'Control' || key === 'Alt' || key === 'Shift') return null;
    // 功能键
    if (/^F\d+$/.test(key)) {
      parts.push(key);
    } else if (key === ' ') {
      parts.push('Space');
    } else if (key === 'ArrowUp') {
      parts.push('Up');
    } else if (key === 'ArrowDown') {
      parts.push('Down');
    } else if (key === 'ArrowLeft') {
      parts.push('Left');
    } else if (key === 'ArrowRight') {
      parts.push('Right');
    } else if (key === 'Escape') {
      parts.push('Esc');
    } else if (key.length === 1) {
      parts.push(key.toUpperCase());
    } else {
      parts.push(key);
    }

    return parts.join('+');
  }
}

function isEditableTarget(el: HTMLElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

export const shortcutRuntime = new ShortcutRuntime();
