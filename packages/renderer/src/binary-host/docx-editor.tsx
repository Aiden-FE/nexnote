import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';

/**
 * docx 语义级往返编辑器（DEV-074，ADR-0015 Decision 4）。
 * 读：binary:docx:read 返回 mammoth HTML；写：binary:docx:save 收 TipTap HTML。
 * 保留：段落/标题/加粗斜体/表格/字体色/对齐；不支持项由宿主顶部标注告知。
 */
export interface DocxEditorProps {
  path: string;
  /** 初始 HTML（mammoth 输出）。 */
  html: string;
  sha256: string;
  /** 编辑即写（debounce）后回调，宿主据此落盘。 */
  onChange: (html: string) => void;
  /** 不保留结构计数（页眉页脚/编号样式/上下标），用于只读标注。 */
  meta: { headersFooters: number; numberingStyles: number; superSubscripts: number };
}

export function DocxEditor({ path, html, onChange, meta }: DocxEditorProps): React.JSX.Element {
  // onChange 经 useEffect 同步进 ref，避免渲染期写 ref（react-hooks/refs）。
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        Table.configure({ resizable: false }),
        TableRow,
        TableCell,
        TableHeader,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        TextStyle,
        Color,
      ],
      content: html,
      onUpdate: ({ editor: instance }) => onChangeRef.current(instance.getHTML()),
    },
    [path],
  );

  // 外部内容变更（例如重新加载）时刷新编辑器内容，避免陈旧快照。
  useEffect(() => {
    if (editor && html && editor.getHTML() !== html && !editor.isFocused) {
      editor.commands.setContent(html, { emitUpdate: false });
    }
    // 仅在 html 变化时同步；编辑中的 onUpdate 由 TipTap 自己维护。
  }, [editor, html]);

  const unsupported: string[] = [];
  if (meta.headersFooters > 0) unsupported.push(`页眉页脚 ${meta.headersFooters} 处`);
  if (meta.numberingStyles > 0) unsupported.push('编号列表样式');
  if (meta.superSubscripts > 0) unsupported.push(`上下标 ${meta.superSubscripts} 处`);

  return (
    <div data-testid="docx-editor" className="flex h-full min-h-0 flex-col">
      {unsupported.length > 0 && (
        <div
          data-testid="docx-unsupported"
          className="shrink-0 border-b bg-amber-50 px-4 py-2 text-xs text-amber-900"
        >
          本文件含语义级往返不保留的内容（{unsupported.join('、')}）。编辑并保存后这些内容不可逆丢失；
          如需保留完整排版，请在 vault 外保留原件。
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-white px-8 py-6">
        <EditorContent editor={editor} className="docx-editor-prose mx-auto max-w-3xl" />
      </div>
    </div>
  );
}
