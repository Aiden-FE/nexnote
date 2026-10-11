import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';
import { MERMAID_BLOCK_NAME, MATH_BLOCK_NAME, MATH_INLINE_NAME } from '@nexnote/kernel';
import { renderKatexInto, renderMermaidSvg } from './render-lib';
import { subscribeLanguage, t } from '../../../lib/i18n';

/**
 * DEV-015 内置块的富预览 NodeView（框架无关 DOM，与内核 nodeview 同风格）。
 * - 预览态：Mermaid SVG / KaTeX 排版；双击进入编辑态。
 * - 编辑态：textarea / input 输入源码；失焦或 ⌘/Ctrl+Enter 提交，Esc 取消。
 * - 提交经 setNodeMarkup 单事务回写（可 undo），Markdown 往返由内核负责。
 * - 节点 contentEditable=false，内部交互经 stopEvent 屏蔽 ProseMirror。
 */

interface NodeViewProps {
  editor: Editor;
  node: ProseMirrorNode;
  getPos: () => number | undefined;
}

interface MinimalNodeView {
  dom: HTMLElement;
  update: (node: ProseMirrorNode) => boolean;
  destroy?: () => void;
  stopEvent: (event: Event) => boolean;
  ignoreMutation: () => boolean;
}

function commitAttrs(
  editor: Editor,
  getPos: () => number | undefined,
  attrs: Record<string, unknown>,
): boolean {
  const pos = getPos();
  if (pos === undefined) return false;
  editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, attrs));
  return true;
}

export function createMermaidView() {
  return ({ node, getPos, editor }: NodeViewProps): MinimalNodeView => {
    const wrapper = document.createElement('div');
    wrapper.className = 'nexnote-mermaid-view';
    wrapper.setAttribute('data-mermaid-view', '');
    wrapper.contentEditable = 'false';

    const preview = document.createElement('div');
    preview.className = 'nexnote-mermaid-preview';

    const editorBox = document.createElement('textarea');
    editorBox.className = 'nexnote-mermaid-editor';
    editorBox.spellcheck = false;
    editorBox.rows = 6;

    const hint = document.createElement('div');
    hint.className = 'nexnote-builtin-hint';
    hint.textContent = t('builtinBlock.mermaid.hint');

    let current = node;
    let editing = false;
    let renderSeq = 0;
    let lastErrorMessage: string | null = null;
    let destroyed = false;

    const refreshMermaidTexts = () => {
      hint.textContent = t('builtinBlock.mermaid.hint');
      if (preview.classList.contains('is-loading')) {
        preview.textContent = t('builtinBlock.mermaid.rendering');
      } else if (preview.classList.contains('is-error') && lastErrorMessage !== null) {
        preview.textContent = t('builtinBlock.mermaid.error', { message: lastErrorMessage });
      }
    };

    const showPreview = () => {
      editing = false;
      editorBox.remove();
      hint.remove();
      wrapper.append(preview);
      const source = String(current.attrs.source ?? '');
      if (!source.trim()) {
        showEdit();
        return;
      }
      const seq = ++renderSeq;
      lastErrorMessage = null;
      preview.classList.add('is-loading');
      preview.textContent = t('builtinBlock.mermaid.rendering');
      renderMermaidSvg(source)
        .then((svg) => {
          if (destroyed || seq !== renderSeq) return;
          lastErrorMessage = null;
          preview.classList.remove('is-loading', 'is-error');
          preview.innerHTML = svg;
        })
        .catch((error: unknown) => {
          if (destroyed || seq !== renderSeq) return;
          lastErrorMessage = error instanceof Error ? error.message : String(error);
          preview.classList.remove('is-loading');
          preview.classList.add('is-error');
          preview.textContent = t('builtinBlock.mermaid.error', {
            message: error instanceof Error ? error.message : String(error),
          });
        });
    };

    const showEdit = () => {
      editing = true;
      preview.remove();
      editorBox.value = String(current.attrs.source ?? '');
      wrapper.append(hint, editorBox);
      editorBox.focus();
    };

    const commit = () => {
      editing = false;
      commitAttrs(editor, getPos, { source: editorBox.value });
    };

    editorBox.addEventListener('blur', () => {
      if (editing) commit();
    });
    editorBox.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        editorBox.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        editorBox.value = String(current.attrs.source ?? '');
        editorBox.blur();
      }
      event.stopPropagation();
    });
    wrapper.addEventListener('dblclick', (event) => {
      event.preventDefault();
      if (!editing) showEdit();
    });

    if (String(node.attrs.source ?? '').trim()) showPreview();
    else showEdit();
    const unsubscribeLanguage = subscribeLanguage(refreshMermaidTexts);

    return {
      dom: wrapper,
      update(next) {
        if (next.type.name !== MERMAID_BLOCK_NAME) return false;
        current = next;
        if (!editing) showPreview();
        return true;
      },
      stopEvent: () => editing,
      ignoreMutation: () => true,
      destroy: () => {
        destroyed = true;
        // 让已发出的异步渲染失效，避免 resolve 后再写 detached DOM。
        renderSeq += 1;
        unsubscribeLanguage();
      },
    };
  };
}

function createMathEdit(displayMode: boolean) {
  return ({ node, getPos, editor }: NodeViewProps, nodeName: string): MinimalNodeView => {
    const wrapper = document.createElement(displayMode ? 'div' : 'span');
    wrapper.className = displayMode ? 'nexnote-math-view' : 'nexnote-math-inline-view';
    wrapper.setAttribute('data-math-view', displayMode ? 'block' : 'inline');
    wrapper.contentEditable = 'false';
    wrapper.title = t('builtinBlock.math.title');

    const preview = document.createElement(displayMode ? 'div' : 'span');
    preview.className = 'nexnote-math-preview';

    const input = document.createElement('textarea');
    input.className = 'nexnote-math-editor';
    input.spellcheck = false;
    input.rows = displayMode ? 3 : 1;

    const hint = document.createElement('div');
    hint.className = 'nexnote-builtin-hint';
    hint.textContent = t(
      displayMode ? 'builtinBlock.math.hintBlock' : 'builtinBlock.math.hintInline',
    );

    let current = node;
    let editing = false;
    let renderSeq = 0;
    let lastErrorMessage: string | null = null;
    let destroyed = false;

    const refreshMathTexts = () => {
      wrapper.title = t('builtinBlock.math.title');
      hint.textContent = t(
        displayMode ? 'builtinBlock.math.hintBlock' : 'builtinBlock.math.hintInline',
      );
      if (preview.classList.contains('is-loading')) {
        preview.textContent = t('builtinBlock.math.rendering');
      } else if (preview.classList.contains('is-error') && lastErrorMessage !== null) {
        preview.textContent = t('builtinBlock.math.error', { message: lastErrorMessage });
      }
    };

    const showPreview = () => {
      editing = false;
      input.remove();
      hint.remove();
      wrapper.append(preview);
      const source = String(current.attrs.source ?? '');
      if (!source.trim()) {
        showEdit();
        return;
      }
      const seq = ++renderSeq;
      lastErrorMessage = null;
      preview.classList.add('is-loading');
      preview.textContent = t('builtinBlock.math.rendering');
      renderKatexInto(preview, source, displayMode)
        .then(() => {
          // katex.render 已同步填充 preview；过期渲染被后续 render 覆盖。
          if (destroyed || seq !== renderSeq) return;
          preview.classList.remove('is-loading', 'is-error');
        })
        .catch((error: unknown) => {
          if (destroyed || seq !== renderSeq) return;
          lastErrorMessage = error instanceof Error ? error.message : String(error);
          preview.classList.remove('is-loading');
          preview.classList.add('is-error');
          preview.textContent = t('builtinBlock.math.error', {
            message: error instanceof Error ? error.message : String(error),
          });
        });
    };

    const showEdit = () => {
      editing = true;
      preview.remove();
      input.value = String(current.attrs.source ?? '');
      if (displayMode) wrapper.append(hint, input);
      else wrapper.append(input);
      input.focus();
    };

    const commit = () => {
      editing = false;
      commitAttrs(editor, getPos, { source: input.value });
    };

    input.addEventListener('blur', () => {
      if (editing) commit();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (displayMode ? event.metaKey || event.ctrlKey : true)) {
        event.preventDefault();
        input.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        input.value = String(current.attrs.source ?? '');
        input.blur();
      }
      event.stopPropagation();
    });
    wrapper.addEventListener('dblclick', (event) => {
      event.preventDefault();
      if (!editing) showEdit();
    });

    if (String(node.attrs.source ?? '').trim()) showPreview();
    else showEdit();
    const unsubscribeLanguage = subscribeLanguage(refreshMathTexts);

    return {
      dom: wrapper,
      update(next) {
        if (next.type.name !== nodeName) return false;
        current = next;
        if (!editing) showPreview();
        return true;
      },
      stopEvent: () => editing,
      ignoreMutation: () => true,
      destroy: () => {
        destroyed = true;
        renderSeq += 1;
        unsubscribeLanguage();
      },
    };
  };
}

export function createKatexBlockView() {
  const factory = createMathEdit(true);
  return ({ node, getPos, editor }: NodeViewProps): MinimalNodeView =>
    factory({ node, getPos, editor }, MATH_BLOCK_NAME);
}

export function createKatexInlineView() {
  const factory = createMathEdit(false);
  return ({ node, getPos, editor }: NodeViewProps): MinimalNodeView =>
    factory({ node, getPos, editor }, MATH_INLINE_NAME);
}
