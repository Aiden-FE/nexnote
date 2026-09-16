import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor, MarkdownToken, NodeViewRendererProps } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

/**
 * 正文目录块：在文档正文中插入一份「目录」占位（Obsidian 兼容：正文可携带
 * HTML 注释，不破坏第三方 Markdown 工具）。
 *
 * 协议（磁盘上唯一事实）：独立一行 `<!-- nexnote:toc -->`。
 * - 解析：仅当标记精确独占一行（允许 CRLF）才识别为 tableOfContents
 *   原子块；段落中 / HTML 代码块 / 行内出现时按普通文本处理。
 * - 序列化：从节点本身回写完全相同的标记行，不附加任何内容。
 * - 节点只保存「此处要目录」的意图，不固化标题条目：条目由内核
 *   NodeView 按当前文档实时推导，磁盘永不落条目（避免文档改动后过期）。
 */

export const TABLE_OF_CONTENTS_NAME = 'tableOfContents';

/** 独立一行 `<!-- nexnote:toc -->`（允许 CRLF），不多不少。 */
export const TABLE_OF_CONTENTS_MARKER = '<!-- nexnote:toc -->';

const MARKER_LINE_RE = /^<!-- nexnote:toc -->(?:\r?\n|$)/;

interface TableOfContentsEntry {
  level: number;
  text: string;
  /** heading 节点在当前 ProseMirror doc 中的起始位置。 */
  pos: number;
}

function collectEntries(doc: ProseMirrorNode): TableOfContentsEntry[] {
  const entries: TableOfContentsEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return;
    entries.push({
      level: Number(node.attrs.level ?? 1),
      text: node.textContent,
      pos,
    });
  });
  return entries;
}

function activateEntry(editor: Editor, entry: TableOfContentsEntry): void {
  const { doc } = editor.state;
  const heading = doc.nodeAt(entry.pos);
  if (!heading || heading.type.name !== 'heading') return;

  const headingDom = editor.view.nodeDOM(entry.pos);
  if (headingDom instanceof HTMLElement) headingDom.scrollIntoView({ block: 'start' });

  if (!editor.isEditable) return;
  const $inside = doc.resolve(entry.pos + 1);
  editor.view.dispatch(
    editor.state.tr
      .setSelection(TextSelection.create(doc, $inside.start(), $inside.end()))
      .scrollIntoView(),
  );
  editor.view.focus();
}

class TableOfContentsNodeView {
  readonly dom: HTMLElement;
  private node: ProseMirrorNode;
  private readonly editor: Editor;
  private readonly handleEditorUpdate: () => void;

  constructor({ node, editor }: NodeViewRendererProps) {
    this.node = node;
    this.editor = editor;
    this.dom = document.createElement('div');
    this.dom.className = 'nexnote-table-of-contents';
    this.dom.setAttribute('data-table-of-contents', '');

    this.handleEditorUpdate = () => this.render();
    this.editor.on('transaction', this.handleEditorUpdate);
    this.render();
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
  }

  stopEvent(event: Event): boolean {
    return (
      event.target instanceof HTMLElement &&
      event.target.closest('[data-table-of-contents-item]') !== null
    );
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.editor.off('transaction', this.handleEditorUpdate);
  }

  private render(): void {
    this.dom.replaceChildren();

    const title = document.createElement('div');
    title.className = 'nexnote-table-of-contents-title';
    title.textContent = '目录';
    this.dom.append(title);

    const entries = collectEntries(this.editor.state.doc);
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'nexnote-table-of-contents-empty';
      empty.setAttribute('data-table-of-contents-empty', '');
      empty.textContent = '暂无标题';
      this.dom.append(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'nexnote-table-of-contents-list';
    for (const entry of entries) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'nexnote-table-of-contents-item';
      item.setAttribute('data-table-of-contents-item', '');
      item.dataset.level = String(entry.level);
      item.dataset.pos = String(entry.pos);
      item.style.setProperty('--toc-level', String(entry.level));
      item.textContent = entry.text;
      item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        activateEntry(this.editor, entry);
      });
      list.append(item);
    }
    this.dom.append(list);
  }
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: {
      /** 在光标处插入正文目录块（不固化条目，渲染层实时生成）。 */
      insertTableOfContents: () => ReturnType;
    };
  }
}

export const TableOfContents = Node.create({
  name: TABLE_OF_CONTENTS_NAME,

  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [{ tag: 'div[data-table-of-contents]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-table-of-contents': '',
        class: 'nexnote-table-of-contents',
      }),
      // 无 NodeView 的静态 HTML/SSR 场景仍保留可读 fallback。
      ['div', { class: 'nexnote-table-of-contents-placeholder' }, '目录'],
    ];
  },

  addNodeView() {
    return (props) => new TableOfContentsNodeView(props);
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: {},
            })
            .run(),
    };
  },

  markdownTokenizer: {
    name: TABLE_OF_CONTENTS_NAME,
    level: 'block',

    start(src: string) {
      if (MARKER_LINE_RE.test(src)) return 0;
      const m = /(?:\r\n|\n)<!-- nexnote:toc -->(?=\r?\n|$)/.exec(src);
      // 返回标记行首（跳过 \r\n 或 \n 分隔符本身）。
      return m ? m.index + m[0].length - TABLE_OF_CONTENTS_MARKER.length : -1;
    },

    tokenize(src: string) {
      const m = MARKER_LINE_RE.exec(src);
      if (!m) return undefined;
      return {
        type: TABLE_OF_CONTENTS_NAME,
        raw: m[0],
        marker: TABLE_OF_CONTENTS_MARKER,
      } as MarkdownToken;
    },
  },

  parseMarkdown(token: MarkdownToken) {
    void token;
    return { type: TABLE_OF_CONTENTS_NAME, attrs: {} };
  },

  renderMarkdown() {
    // 序列化器会在块后自行拼接换行，这里只回写标记本身。
    return TABLE_OF_CONTENTS_MARKER;
  },
});
