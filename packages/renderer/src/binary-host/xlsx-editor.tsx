import { useEffect, useRef } from 'react';
import { Workbook } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';

/**
 * xlsx 编辑器（DEV-074，ADR-0015 R3）：@fortune-sheet/react 承担单元格编辑。
 * 数据从主进程 binary:read（fortune 工作簿 JSON）注入；编辑后 onChange 直接给最新 sheet 数组。
 * 宏 / 图表 / 透视表为只读保留区，由宿主顶部标注；保存时这些原字节不丢失（主进程处理）。
 */
export interface XlsxEditorProps {
  path: string;
  /** fortune 工作簿 sheet 数组（binary:read 返回的 data.sheets）。 */
  sheets: unknown[];
  onChange: (sheets: unknown[]) => void;
}

export function XlsxEditor({ path, sheets, onChange }: XlsxEditorProps): React.JSX.Element {
  // onChange 经 useEffect 同步进 ref，避免渲染期写 ref（react-hooks/refs）。
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  return (
    <div data-testid="xlsx-editor" className="h-full min-h-0">
      <Workbook
        key={path}
        data={Array.isArray(sheets) ? (sheets as never[]) : []}
        onChange={(data) => onChangeRef.current(data)}
        toolbarItems={[]}
      />
    </div>
  );
}

