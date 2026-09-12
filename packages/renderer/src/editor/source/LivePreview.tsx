import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { EditorKernelInstance } from '@nexnote/kernel';
import { createEditor } from '@nexnote/kernel';
import { classifyNormalDestination, resolveNoteLinkTarget } from '@nexnote/shared';
import {
  buildBuiltinViewExtensions,
  flagsFromActivePlugins,
} from '../../features/plugins/builtin/builtin-extensions';
import { usePluginStore } from '../../features/plugins/plugin-store';
import { createPreviewScheduler, type PreviewScheduler } from './preview-scheduler';

export interface InternalLinkNavigation {
  /** 普通链接：vault 相对目标 stem（无 .md）；Wikilink：原始目标名 */
  target: string;
  title: string;
  wikilink: boolean;
}

interface LivePreviewProps {
  markdown: string;
  /** 链接解析基准：当前源码页面的 vault 相对路径。 */
  sourcePath: string;
  /** 内部链接 / Wikilink 点击（父层负责先保存再导航）；外链不经过这里。 */
  onNavigate: (target: InternalLinkNavigation) => void;
  /** 预览滚动容器；父层据此做源码 → 预览单向滚动同步。 */
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * 只读 Live Preview（DEV-020）：
 * - 复用块编辑内核（含 Mermaid / KaTeX / 插件块 / Wikilink）以只读方式渲染
 * - 输入防抖 ~200ms 后 setMarkdown 更新同一实例，过期异步结果一律丢弃
 * - 内部链接 / Wikilink 普通点击即导航；外链沿用应用安全打开策略
 */
export function LivePreview({ markdown, sourcePath, onNavigate, scrollRef }: LivePreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const kernelRef = useRef<EditorKernelInstance | null>(null);
  const schedulerRef = useRef<PreviewScheduler | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  // 首帧必须同步渲染：进入源码模式时右侧不得先空白再等防抖。
  const initialMarkdownRef = useRef(markdown);

  // 内核只建一次（复用实例）；插件启停影响的是后续重挂（与块编辑模式同语义）。
  useEffect(() => {
    if (!hostRef.current) return;
    const flags = flagsFromActivePlugins(usePluginStore.getState().plugins);
    const kernel = createEditor(hostRef.current, {
      editable: false,
      initialMarkdown: '',
      extraExtensions: buildBuiltinViewExtensions(flags),
    });
    kernelRef.current = kernel;
    try {
      kernel.setMarkdown(initialMarkdownRef.current);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      queueMicrotask(() => {
        if (kernelRef.current === kernel) setRenderError(message);
      });
    }
    return () => {
      kernelRef.current = null;
      kernel.destroy();
    };
  }, []);

  // 调度器只建一次；markdown 变化 → schedule（销毁后 isCurrent 恒 false，过期渲染被丢弃）。
  useEffect(() => {
    schedulerRef.current = createPreviewScheduler({
      delayMs: 200,
      render: (text, isCurrent) => {
        const kernel = kernelRef.current;
        if (!kernel || !isCurrent()) return;
        try {
          kernel.setMarkdown(text);
          if (isCurrent()) setRenderError(null);
        } catch (error) {
          // 整页解析失败：保留上一次预览内容并显示错误（不得崩溃、不得阻断源码编辑）。
          if (isCurrent()) setRenderError(error instanceof Error ? error.message : String(error));
        }
      },
    });
    return () => {
      schedulerRef.current?.destroy();
      schedulerRef.current = null;
    };
  }, []);

  useEffect(() => {
    schedulerRef.current?.schedule(markdown);
  }, [markdown]);

  // 容器级点击委托：Wikilink span（无 href）+ 普通链接 <a>。
  // 外链不 preventDefault：Electron setWindowOpenHandler 统一按 http(s) → shell.openExternal 处理。
  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const wiki = target.closest<HTMLElement>('[data-wikilink-target]');
    if (wiki) {
      event.preventDefault();
      event.stopPropagation();
      const raw = wiki.dataset.wikilinkTarget ?? '';
      onNavigate({ target: raw, title: raw, wikilink: true });
      return;
    }
    const anchor = target.closest<HTMLAnchorElement>('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href') ?? '';
    const kind = classifyNormalDestination(href);
    if (kind !== 'note') {
      if (kind !== 'external') event.preventDefault();
      return;
    }
    event.preventDefault();
    const stem = resolveNoteLinkTarget(sourcePath, href);
    if (!stem) return;
    onNavigate({ target: stem, title: stem.split('/').at(-1) ?? stem, wikilink: false });
  };

  return (
    <div
      data-testid="live-preview"
      className="nexnote-editor-scope relative min-h-0 min-w-0 flex-1 overflow-auto bg-background"
      ref={scrollRef}
      onClick={handleClick}
    >
      {renderError && (
        <div
          data-testid="preview-error"
          className="sticky top-0 z-10 flex items-start gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span data-testid="preview-stale">
            预览更新失败（整页解析失败）：{renderError} · 下方内容已过期
          </span>
        </div>
      )}
      <div className="mx-auto max-w-[var(--editor-content-width)] px-10 py-10">
        <div ref={hostRef} data-testid="live-preview-host" className="nexnote-markdown-preview" />
      </div>
    </div>
  );
}
