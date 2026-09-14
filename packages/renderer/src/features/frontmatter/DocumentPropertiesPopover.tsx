import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import type { FrontmatterData } from '@nexnote/kernel';
import { FrontmatterPanel } from './FrontmatterPanel';

export interface DocumentPropertiesPopoverProps {
  data: FrontmatterData;
  source: string;
  knownTags: string[];
  locked?: boolean;
  parseError?: string | null;
  onChange: (data: FrontmatterData) => void;
  onYamlChange: (source: string, data: FrontmatterData) => void;
}

/**
 * 顶部状态栏的轻量文档属性入口。面板使用 portal 挂到 body，打开/关闭都不参与
 * 编辑器主布局；关闭只隐藏 UI，不触碰调用方的保存缓冲或 debounce 链。
 */
export function DocumentPropertiesPopover({
  data,
  source,
  knownTags,
  locked = false,
  parseError = null,
  onChange,
  onYamlChange,
}: DocumentPropertiesPopoverProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 8 });
  const id = useId().replace(/:/g, '');
  const popoverId = `document-properties-popover-${id}`;

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(560, Math.max(280, window.innerWidth - 16));
      setPosition({
        top: rect.bottom + 4,
        left: Math.min(Math.max(8, rect.right - width), Math.max(8, window.innerWidth - width - 8)),
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      // 不 preventDefault：外部目标仍可正常获得焦点；字段编辑也不会被 mousedown 抢焦。
      setOpen(false);
    };

    updatePosition();
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="document-properties-trigger"
        title="编辑文档属性"
        aria-label="属性"
        aria-expanded={open}
        aria-controls={popoverId}
        className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent"
        onClick={() => setOpen((current) => !current)}
      >
        <ClipboardList className="size-3" aria-hidden="true" />
        属性
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            data-testid="document-properties-popover"
            role="dialog"
            aria-label="文档属性"
            style={{ top: position.top, left: position.left, width: 'min(560px, calc(100vw - 16px))' }}
            className="fixed z-50 max-h-[min(75vh,640px)] overflow-y-auto rounded-lg border bg-background p-2 text-foreground shadow-xl"
          >
            <FrontmatterPanel
              data={data}
              source={source}
              knownTags={knownTags}
              locked={locked}
              parseError={parseError}
              onChange={onChange}
              onYamlChange={onYamlChange}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
