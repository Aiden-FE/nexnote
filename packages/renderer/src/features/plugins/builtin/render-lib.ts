/**
 * DEV-015 内置插件渲染库懒加载：Mermaid / KaTeX 体积较大，仅在内置插件
 * 激活且实际渲染时才下载解析；纯内核与禁用场景零加载成本。
 */

type MermaidModule = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, source: string) => Promise<{ svg: string; bindFunctions?: (el: Element) => void }>;
};

let mermaidPromise: Promise<MermaidModule> | null = null;

async function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const mermaid = (mod as { default: MermaidModule }).default;
      // securityLevel strict：图表内容不触达 DOM 脚本；neutral 主题适配明暗背景。
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
      return mermaid;
    });
  }
  return mermaidPromise;
}

let mermaidSeq = 0;

/** 渲染 Mermaid 源码为 SVG 字符串；语法错误时抛出，调用方展示错误态。 */
export async function renderMermaidSvg(source: string): Promise<string> {
  const mermaid = await loadMermaid();
  const id = `nexnote-mermaid-${++mermaidSeq}`;
  const { svg } = await mermaid.render(id, source);
  return svg;
}

type KatexModule = {
  render: (source: string, el: HTMLElement, options?: Record<string, unknown>) => void;
};

let katexPromise: Promise<KatexModule> | null = null;

async function loadKatex(): Promise<KatexModule> {
  if (!katexPromise) {
    // KaTeX 样式随懒加载一并注入（CSS 由 Vite 打包）。
    katexPromise = import('katex').then((mod) => mod as unknown as KatexModule);
    void import('katex/dist/katex.min.css');
  }
  return katexPromise;
}

/** 渲染 LaTeX 源码到目标元素；throwOnError:false 时语法错误以红色文本呈现。 */
export async function renderKatexInto(
  el: HTMLElement,
  source: string,
  displayMode: boolean,
): Promise<void> {
  const katex = await loadKatex();
  el.textContent = '';
  katex.render(source, el, {
    displayMode,
    throwOnError: false,
    errorColor: '#dc2626',
    output: 'html',
  });
}
