import { invoke } from '../lib/ipc';
import type { EditorKernelInstance } from '@nexnote/kernel';
import { createEditor } from '@nexnote/kernel';
import {
  buildBuiltinViewExtensions,
  flagsFromActivePlugins,
} from '../features/plugins/builtin/builtin-extensions';
import { usePluginStore } from '../features/plugins/plugin-store';

/**
 * 文档打印收集器：把「渲染后的语义 HTML + 当前应用样式」交给主进程隐藏打印窗口。
 *
 * - 输出是完整 HTML 文档（含 `<style>`），不包含应用 UI；
 * - 调用者传入当前文档标题与样式节点列表；
 * - 真实打印由系统打印对话框确认，本模块只负责封装与结果传播。
 */
const MAX_HTML_BYTES = 8 * 1024 * 1024;

export interface CollectPrintDocumentOptions {
  title: string;
  /** 渲染后的语义 DOM（通常是 `.ProseMirror` 或预览 host 的内容元素）。 */
  content: Element;
  /** 参与渲染的样式节点（全局主题 + 打印覆盖层）。 */
  styles?: ReadonlyArray<HTMLStyleElement | HTMLLinkElement>;
}

export function buildPrintHtml(options: CollectPrintDocumentOptions): string {
  const title = escapeHtml(options.title);
  const styleNodes = options.styles ?? collectActiveStyles();
  const styles = styleNodes.map((node) => node.outerHTML).join('\n');
  const content = options.content.outerHTML;
  return [
    '<!doctype html>',
    '<html><head>',
    `<meta charset="utf-8">`,
    `<title>${title}</title>`,
    '<style data-nexnote-print-override>',
    '@page { margin: 1.6cm; }',
    'html, body { background: #fff !important; color: #000 !important; margin: 0; padding: 0; }',
    'body { font-family: var(--font-sans, system-ui, sans-serif); }',
    '#nexnote-print-root > .ProseMirror { max-width: 100% !important; margin: 0 !important; padding: 0 !important; }',
    '#nexnote-print-root button, #nexnote-print-root [aria-hidden="true"] { display: none !important; }',
    '#nexnote-print-root .nexnote-fold-hidden { display: revert !important; visibility: visible !important; }',
    '#nexnote-print-root .nexnote-fold-ghost, #nexnote-print-root .nexnote-fold-ellipsis { display: none !important; }',
    'a { color: inherit !important; text-decoration: underline; }',
    'img { max-width: 100%; }',
    'pre, table { break-inside: avoid; }',
    'tr { break-inside: avoid; }',
    '</style>',
    styles,
    '</head><body>',
    `<div id="nexnote-print-root">${content}</div>`,
    '</body></html>',
  ].join('');
}

export async function printDocument(options: CollectPrintDocumentOptions): Promise<{
  accepted: boolean;
  failureReason?: string;
}> {
  const html = buildPrintHtml(options);
  if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) {
    throw new Error('Document is too large to print');
  }
  return invoke('print:document', { title: options.title, html });
}

/** 把 Markdown 文本渲染为「打印语义 HTML」：复用 LivePreview 的内核路径。 */
export async function renderMarkdownForPrint(markdown: string): Promise<Element> {
  const host = document.createElement('div');
  host.className = 'nexnote-markdown-preview';
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('data-testid', 'print-render-host');
  host.style.position = 'fixed';
  host.style.left = '-10000px';
  host.style.top = '0';
  host.style.width = 'var(--editor-content-width, 46rem)';
  host.style.opacity = '0';
  host.style.pointerEvents = 'none';
  document.body.appendChild(host);

  let kernel: EditorKernelInstance;
  try {
    kernel = createEditor(host, {
      editable: false,
      initialMarkdown: '',
      extraExtensions: buildBuiltinViewExtensions(
        flagsFromActivePlugins(usePluginStore.getState().plugins),
      ),
    });
  } catch (error) {
    host.remove();
    throw error;
  }
  try {
    kernel.setMarkdown(markdown);
    // NodeView 可能异步渲染（Mermaid/KaTeX），让出下一帧提高保真度。
    await nextFrame();
    const content: Element = host.querySelector('.ProseMirror') ?? host;
    return content;
  } finally {
    kernel.destroy();
    host.remove();
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function collectActiveStyles(): Array<HTMLStyleElement | HTMLLinkElement> {
  return [
    ...document.head.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
      'style, link[rel="stylesheet"]',
    ),
  ];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
