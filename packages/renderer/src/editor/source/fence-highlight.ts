import { fenceHighlighter } from '@nexnote/kernel';
import { normalizeCodeLanguage } from '@nexnote/shared';
import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { staticFenceLanguageNames } from './fence-languages';

const FENCE_NODES = new Set(['FencedCode', 'CodeBlock']);
const CLOSING_FENCE = /^\s*(?:`{3,}|~{3,})\s*$/;

interface FenceBody {
  /** info string（围栏后的语言标记）。 */
  info: string;
  /** 围栏内容（不含首尾围栏行）。 */
  body: string;
  /** 围栏内容在文档中的起始偏移。 */
  bodyFrom: number;
}

function readFence(state: EditorState, from: number, to: number): FenceBody | null {
  const firstLineEnd = state.doc.sliceString(from, to).indexOf('\n');
  const openEnd = firstLineEnd < 0 ? to : from + firstLineEnd;
  const open = state.doc.sliceString(from, openEnd);
  const info = /^\s*(?:`{3,}|~{3,})\s*(\S*)/.exec(open)?.[1] ?? '';
  if (firstLineEnd < 0) return { info, body: '', bodyFrom: to };
  const lastLineEnd = state.doc.sliceString(from, to).lastIndexOf('\n');
  const closeFrom = lastLineEnd <= firstLineEnd ? to : from + lastLineEnd + 1;
  const close = state.doc.sliceString(closeFrom, to);
  const closed = CLOSING_FENCE.test(close);
  const bodyFrom = openEnd + 1;
  const bodyTo = closed ? Math.max(bodyFrom, closeFrom - 1) : to;
  return { info, body: state.doc.sliceString(bodyFrom, bodyTo), bodyFrom };
}

/**
 * 源码模式围栏高亮（DEV-029）：CodeMirror 语言包覆盖的语言由 `codeLanguages`
 * （见 fence-languages.ts）解析；其余覆盖清单语言用与块渲染同一份 lowlight token
 * 结果着色，未知语言不做任何 decoration（纯文本降级）。
 *
 * 只处理可见围栏：千行级代码块滚动时不重复分析视口外内容。
 */
function buildDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const { state } = view;
  const visible = view.visibleRanges;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (!FENCE_NODES.has(node.name)) return;
      if (!visible.some((range) => node.from <= range.to && node.to >= range.from)) return;
      const fence = readFence(state, node.from, node.to);
      if (!fence || !fence.info || !fence.body) return;
      const info = fence.info.toLowerCase();
      if (
        staticFenceLanguageNames.has(info) ||
        staticFenceLanguageNames.has(normalizeCodeLanguage(info))
      ) {
        return;
      }
      const spans = fenceHighlighter.tokenSpans(fence.info, fence.body);
      if (!spans) {
        void fenceHighlighter.ensure(fence.info);
        return;
      }
      for (const span of spans) {
        if (span.to <= span.from) continue;
        ranges.push(
          Decoration.mark({ class: span.className }).range(
            fence.bodyFrom + span.from,
            fence.bodyFrom + span.to,
          ),
        );
      }
    },
  });
  return Decoration.set(ranges, true);
}

export const fenceHighlightExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private unsubscribe: () => void;

    constructor(readonly view: EditorView) {
      this.decorations = buildDecorations(view);
      // 懒加载语法 / 大围栏后台 token 就绪 → 重算 decoration。
      // 空事务只为触发一次 view update 周期（无状态变更、不进 undo 栈）。
      this.unsubscribe = fenceHighlighter.subscribe(() => {
        queueMicrotask(() => {
          if (!this.view.dom.isConnected) return;
          this.decorations = buildDecorations(this.view);
          this.view.dispatch({});
        });
      });
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged)
        this.decorations = buildDecorations(update.view);
    }

    destroy() {
      this.unsubscribe();
    }
  },
  { decorations: (value) => value.decorations },
);
