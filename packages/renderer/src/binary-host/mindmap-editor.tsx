import { useEffect, useRef } from 'react';
import MindMap from 'simple-mind-map';

/**
 * xmind 编辑器（DEV-074，ADR-0015 R3）：simple-mind-map 承担思维导图编辑。
 * 数据为 simple-mind-map 节点树（binary:read 返回的 data.model）；onChange 交宿主 debounce 落盘。
 * 外框 / 关联线为只读保留区，由宿主顶部标注；保存时这些原字节不丢失（主进程处理）。
 */
export interface MindmapEditorProps {
  path: string;
  /** simple-mind-map 根节点树。 */
  model: unknown;
  onChange: (model: unknown) => void;
}

export function MindmapEditor({ path, model, onChange }: MindmapEditorProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // onChange 经 useEffect 同步进 ref，避免渲染期写 ref（react-hooks/refs）。
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!hostRef.current) return;
    // simple-mind-map 构造函数选项极多（140+ 默认项），运行时自带默认值合并，这里用窄类型传参。
    type MindMapOptions = ConstructorParameters<typeof MindMap>[0];
    const mindMap = new MindMap({
      el: hostRef.current,
      data: model,
      layout: 'logicalStructure',
      readonly: false,
    } as unknown as MindMapOptions);
    const handler = (data: unknown): void => onChangeRef.current(data);
    (mindMap as unknown as { on: (event: string, cb: (data: unknown) => void) => void }).on(
      'data_change',
      handler,
    );
    return () => {
      mindMap.destroy();
    };
  }, [path, model]);

  return (
    <div data-testid="mindmap-editor" className="h-full min-h-0">
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}

