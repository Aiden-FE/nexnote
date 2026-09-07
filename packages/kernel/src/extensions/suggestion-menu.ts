import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/**
 * 通用补全菜单（框架无关 DOM，DEV-017）。
 *
 * wikilink（`[[`）与标签（`#`）补全共用：检测光标前触发串 + 查询词，弹出
 * 可键盘导航（↑↓ / Enter / Tab / Esc）浮层；候选由渲染层注入（内核不感知
 * vault 页面/标签数据），应用时删除「触发串+查询词」并插入对应内联原子节点。
 *
 * 状态模型：菜单状态（active）是内核插件的闭包状态（同 slash-menu）；
 * 每次文档变更（update）都重算触发串与候选，不依赖微任务时序。
 */

export interface SuggestionItem {
  id: string;
  title: string;
  hint?: string;
  meta?: 'uncreated';
  /**
   * wikilink 插入载荷（DEV-017）：用户已输入 `|别名` / `#锚点` 时由渲染层给出，
   * 内核原样写入节点 attrs；缺省回退为 id/target 与「title≠id 则 title 作别名」。
   */
  insert?: { target: string; alias?: string | null };
}

export type SuggestionKind = 'wikilink' | 'hashtag';

export interface SuggestionTrigger {
  /** 唯一名 */
  name: string;
  /** 触发种类：决定插入哪种内联原子节点 */
  kind: SuggestionKind;
  /** 触发串，如 '[[' 或 '#' */
  trigger: string;
  /** 触发串前是否必须是行首/空白（标签需要，wikilink 不需要） */
  requireWhitespaceBefore?: boolean;
  /** 取候选（query = 已输入查询词，同步返回；内核截断前 8 项） */
  suggestions: (query: string) => SuggestionItem[];
  /** 选中项插入后的回调（渲染层借此创建红链页面等副作用） */
  onPick?: (item: SuggestionItem) => void;
  className: string;
  /** modifier class 加在 root 上（如 `nexnote-suggestion--wikilink`），不污染 __item 等子类 */
  modifierClassName?: string;
}

interface ActiveMenu {
  trigger: SuggestionTrigger;
  /** 触发串起点（文档坐标，待删除范围起点） */
  from: number;
  query: string;
  items: SuggestionItem[];
  activeIndex: number;
}

function caretCoords(view: EditorView, pos: number): { bottom: number; left: number } | null {
  const domAt = view.domAtPos(pos);
  const el =
    domAt.node.nodeType === 1
      ? (domAt.node as HTMLElement)
      : domAt.node.parentElement;
  if (!el) return null;
  const range = document.createRange();
  range.setStart(domAt.node, domAt.offset);
  const rect = range.getBoundingClientRect();
  return { bottom: rect.bottom, left: rect.left };
}

function createMenu(
  trigger: SuggestionTrigger,
  onPick: (item: SuggestionItem) => void,
): {
  dom: HTMLDivElement;
  render: (menu: ActiveMenu, coords: { bottom: number; left: number }) => void;
  hide: () => void;
  destroy: () => void;
} {
const dom = document.createElement('div');
    dom.className = [trigger.className, trigger.modifierClassName ?? '']
      .filter(Boolean)
      .join(' ');
  dom.style.display = 'none';
  dom.style.position = 'absolute';
  dom.style.zIndex = '46';
  dom.setAttribute('role', 'listbox');

  const render = (menu: ActiveMenu, coords: { bottom: number; left: number }) => {
    dom.innerHTML = '';
    if (menu.items.length === 0) {
      dom.style.display = 'none';
      return;
    }
    menu.items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = `${trigger.className}__item`;
      row.dataset.suggestionItem = item.id;
      row.dataset.active = i === menu.activeIndex ? 'true' : 'false';
      if (item.meta === 'uncreated') row.dataset.uncreated = 'true';
      const title = document.createElement('span');
      title.className = `${trigger.className}__title`;
      title.textContent = item.title;
      row.append(title);
      if (item.hint) {
        const hint = document.createElement('code');
        hint.className = `${trigger.className}__hint`;
        hint.textContent = item.hint;
        row.append(hint);
      }
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        onPick(item);
      });
      dom.append(row);
    });
    const host = dom.parentElement?.getBoundingClientRect();
    dom.style.display = 'block';
    dom.style.top = `${coords.bottom - (host?.top ?? 0) + 6}px`;
    dom.style.left = `${coords.left - (host?.left ?? 0)}px`;
  };
  const hide = () => {
    dom.style.display = 'none';
  };
  const destroy = () => dom.remove();
  return { dom, render, hide, destroy };
}

function createSuggestionPlugin(trigger: SuggestionTrigger): Plugin {
  const key = new PluginKey(`nexnoteSuggestion-${trigger.name}`);
  let menu: ReturnType<typeof createMenu> | null = null;
  let active: ActiveMenu | null = null;

  /** 在「当前段落中光标前文本」里定位触发串；返回相对段落起点偏移与查询词。 */
  function findTrigger(textBefore: string): { offset: number; query: string } | null {
    const idx = textBefore.lastIndexOf(trigger.trigger);
    if (idx < 0) return null;
    const after = textBefore.slice(idx + trigger.trigger.length);
    if (after.includes('\n')) return null;
    // 已输入关闭符（wikilink 的 `]]` 首个字符 / hashtag 的空白等）则关闭
    if (trigger.kind === 'wikilink' && after.includes(']')) return null;
    if (trigger.kind === 'hashtag' && /[\s#]/.test(after)) return null;
    if (trigger.requireWhitespaceBefore) {
      const before = textBefore[idx - 1];
      if (before !== undefined && !/\s/.test(before)) return null;
    }
    return { offset: idx, query: after };
  }

  /** 把菜单渲染到 active.from 对应的光标位置（recompute 与键盘导航共用）。 */
  function syncMenu(view: EditorView): void {
    if (!menu || !active) return;
    const host = view.dom.parentElement;
    if (host && !menu.dom.isConnected) host.append(menu.dom);
    const coords = caretCoords(view, active.from);
    if (coords) menu.render(active, coords);
    else menu.hide();
  }

  /**
   * 文档驱动重算：从当前光标所在段落解析触发串，重建候选与菜单位置。
   * 每个 update 都执行（菜单开启时随输入实时过滤；关闭时开销可忽略）。
   */
  function recompute(view: EditorView): boolean {
    const { from: selFrom } = view.state.selection;
    const $from = view.state.doc.resolve(selFrom);
    const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
    const found = findTrigger(textBefore);
    if (!found || found.query.includes(trigger.trigger)) {
      active = null;
      menu?.hide();
      return false;
    }
    const nodeStart = selFrom - $from.parentOffset;
    const items = trigger.suggestions(found.query).slice(0, 8);
    const docFrom = nodeStart + found.offset;
    if (items.length === 0) {
      active = null;
      menu?.hide();
      return false;
    }
    if (active && active.trigger === trigger) {
      // query 不变（光标移动等）保留高亮项；变化时回到第一项
      const sameQuery = active.query === found.query;
      active = {
        ...active,
        from: docFrom,
        query: found.query,
        items,
        activeIndex: sameQuery ? Math.min(active.activeIndex, items.length - 1) : 0,
      };
    } else {
      active = { trigger, from: docFrom, query: found.query, items, activeIndex: 0 };
    }
    syncMenu(view);
    return true;
  }

  function close() {
    active = null;
    menu?.hide();
  }

  function applyItem(view: EditorView, item: SuggestionItem) {
    if (!active) return;
    const from = active.from;
    const to = view.state.selection.from;
    const { schema } = view.state;
    // 单事务删除「触发串+查询词」并插入内联原子节点（一次 undo 即还原）。
    const node =
      trigger.kind === 'wikilink'
        ? schema.nodes.wikilink?.create({
            target: item.insert?.target ?? item.id,
            alias: item.insert
              ? (item.insert.alias ?? null)
              : item.title !== item.id
                ? item.title
                : null,
          })
        : schema.nodes.hashtag?.create({ tag: item.id });
    if (node) view.dispatch(view.state.tr.replaceWith(from, to, node));
    active = null;
    menu?.hide();
    trigger.onPick?.(item);
    view.focus();
  }

  return new Plugin({
    key,
    view(editorView) {
      menu = createMenu(trigger, (item) => {
        if (active?.trigger === trigger) applyItem(editorView, item);
      });
      const host = editorView.dom.parentElement;
      if (host) host.append(menu.dom);
      return {
        update(view) {
          recompute(view);
        },
        destroy() {
          menu?.destroy();
          menu = null;
          active = null;
        },
      };
    },
    props: {
      handleKeyDown(view, event) {
        if (!active || active.trigger !== trigger) return false;
        if (event.key === 'Escape') {
          close();
          return true;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const count = active.items.length;
          if (count === 0) return true;
          const dir = event.key === 'ArrowDown' ? 1 : -1;
          active.activeIndex = (active.activeIndex + dir + count) % count;
          syncMenu(view);
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          const item = active.items[active.activeIndex];
          if (item) applyItem(view, item);
          return true;
        }
        return false;
      },
    },
  });
}

export interface SuggestionMenuOptions {
  triggers: SuggestionTrigger[];
}

/** 通用补全菜单扩展：一次配置多个触发（wikilink / hashtag）。 */
export const SuggestionMenu = Extension.create<SuggestionMenuOptions>({
  name: 'nexnoteSuggestionMenu',

  addOptions() {
    return { triggers: [] };
  },

  addProseMirrorPlugins() {
    return this.options.triggers.map((trigger) => createSuggestionPlugin(trigger));
  },
});
