import { common, createLowlight } from 'lowlight';
import type { LanguageFn } from 'highlight.js';
import {
  CODE_HIGHLIGHT_MAX_LINES,
  CODE_LANGUAGES,
  normalizeCodeLanguage,
  type CodeLanguage,
} from '@nexnote/shared';
import { hclGrammar, tomlGrammar } from './custom-grammars';

/**
 * 围栏高亮 token：相对围栏内容起点的字符区间 + highlight.js class。
 * 块渲染（ProseMirror decoration）与源码模式（CodeMirror decoration）共用同一批 token，
 * 保证三处渲染路径（块渲染 / 源码围栏 / 实时预览）高亮一致。
 */
export interface FenceTokenSpan {
  from: number;
  to: number;
  className: string;
}

interface HastNode {
  type: string;
  value?: string;
  children?: HastNode[];
  properties?: { className?: unknown };
}

export interface FenceHighlighter {
  /** 覆盖清单（规范名），与 @nexnote/shared CODE_LANGUAGES 一致。 */
  readonly languages: readonly string[];
  /** 已完成语法加载的语言（规范名）。 */
  isLoaded(language: string): boolean;
  /** 按需加载语法（幂等；未知 / 失败语言返回 false，不抛错）。 */
  ensure(language: string): Promise<boolean>;
  /** 语法就绪后的 token；未知 / 未标注 / 未就绪 / 超大围栏返回 null（纯文本降级）。 */
  tokenSpans(language: string | null | undefined, code: string): FenceTokenSpan[] | null;
  /** 语法加载或超大围栏后台计算完成时通知（渲染层据此重算 decoration）。 */
  subscribe(listener: () => void): () => void;
}

/** 追加语言的懒加载表（字面量 import 供打包器切分 chunk，按需加载）。 */
const lazyGrammars: Partial<Record<string, () => Promise<{ default: LanguageFn }>>> = {
  awk: () => import('highlight.js/lib/languages/awk'),
  clojure: () => import('highlight.js/lib/languages/clojure'),
  cmake: () => import('highlight.js/lib/languages/cmake'),
  crystal: () => import('highlight.js/lib/languages/crystal'),
  dart: () => import('highlight.js/lib/languages/dart'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  elixir: () => import('highlight.js/lib/languages/elixir'),
  elm: () => import('highlight.js/lib/languages/elm'),
  erlang: () => import('highlight.js/lib/languages/erlang'),
  fsharp: () => import('highlight.js/lib/languages/fsharp'),
  groovy: () => import('highlight.js/lib/languages/groovy'),
  haskell: () => import('highlight.js/lib/languages/haskell'),
  julia: () => import('highlight.js/lib/languages/julia'),
  latex: () => import('highlight.js/lib/languages/latex'),
  lisp: () => import('highlight.js/lib/languages/lisp'),
  matlab: () => import('highlight.js/lib/languages/matlab'),
  nginx: () => import('highlight.js/lib/languages/nginx'),
  nim: () => import('highlight.js/lib/languages/nim'),
  nix: () => import('highlight.js/lib/languages/nix'),
  ocaml: () => import('highlight.js/lib/languages/ocaml'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  properties: () => import('highlight.js/lib/languages/properties'),
  protobuf: () => import('highlight.js/lib/languages/protobuf'),
  scala: () => import('highlight.js/lib/languages/scala'),
  scheme: () => import('highlight.js/lib/languages/scheme'),
  verilog: () => import('highlight.js/lib/languages/verilog'),
  vhdl: () => import('highlight.js/lib/languages/vhdl'),
};

/** 超过该行数的围栏转为后台计算（先渲染纯文本，完成后通知重算），避免千行块卡顿。 */
const LARGE_FENCE_LINES = 400;
/** token 缓存上限（LRU）：文档反复编辑时未变更围栏不重复分析。 */
const CACHE_LIMIT = 64;

function flatten(
  root: HastNode,
  inherited: string | null,
  offset: number,
  out: FenceTokenSpan[],
): number {
  for (const child of root.children ?? []) {
    const own = Array.isArray(child.properties?.className)
      ? (child.properties?.className as string[]).join(' ')
      : null;
    const classes = [inherited, own].filter(Boolean).join(' ') || null;
    if (child.children?.length) {
      offset = flatten(child, classes, offset, out);
    } else if (child.value) {
      const next = offset + child.value.length;
      if (classes) out.push({ from: offset, to: next, className: classes });
      offset = next;
    }
  }
  return offset;
}

export function createFenceHighlighter(): FenceHighlighter {
  const lowlight = createLowlight(common);
  // highlight.js 没有内置 toml / hcl 语法：内核自带轻量语法补齐清单缺口。
  lowlight.register('toml', tomlGrammar);
  lowlight.register('hcl', hclGrammar);

  const loaded = new Set<string>(lowlight.listLanguages());
  const failed = new Set<string>();
  const inflight = new Map<string, Promise<boolean>>();
  const listeners = new Set<() => void>();
  const cache = new Map<string, FenceTokenSpan[] | null>();
  let notifyScheduled = false;

  const notify = (): void => {
    if (notifyScheduled) return;
    notifyScheduled = true;
    queueMicrotask(() => {
      notifyScheduled = false;
      for (const listener of listeners) listener();
    });
  };

  const spansOf = (canonical: CodeLanguage, code: string): FenceTokenSpan[] | null => {
    const root = lowlight.highlight(canonical, code) as unknown as HastNode;
    const out: FenceTokenSpan[] = [];
    flatten(root, null, 0, out);
    return out;
  };

  const compute = (canonical: CodeLanguage, code: string): FenceTokenSpan[] | null => {
    const key = `${canonical}\u0000${code}`;
    if (cache.has(key)) {
      const hit = cache.get(key) ?? null;
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const spans = spansOf(canonical, code);
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, spans);
    return spans;
  };

  const ensureLanguage = async (language: string): Promise<boolean> => {
    const canonical = normalizeCodeLanguage(language);
    if (canonical === 'plaintext' || loaded.has(canonical)) return loaded.has(canonical);
    if (failed.has(canonical)) return false;
    const pending = inflight.get(canonical);
    if (pending) return pending;
    const load = lazyGrammars[canonical];
    if (!load) {
      failed.add(canonical);
      return false;
    }
    const task = load()
      .then((mod) => {
        lowlight.register(canonical, mod.default);
        loaded.add(canonical);
        notify();
        return true;
      })
      .catch(() => {
        failed.add(canonical);
        console.warn(`[fence-highlight] 语法加载失败，已降级纯文本：${canonical}`);
        return false;
      })
      .finally(() => {
        inflight.delete(canonical);
      });
    inflight.set(canonical, task);
    return task;
  };

  return {
    languages: CODE_LANGUAGES,
    isLoaded(language) {
      return loaded.has(normalizeCodeLanguage(language));
    },
    ensure: ensureLanguage,
    tokenSpans(language, code) {
      const canonical = normalizeCodeLanguage(language);
      if (canonical === 'plaintext') return null;
      if (!loaded.has(canonical)) {
        // 未就绪：先纯文本，语法加载完成后由订阅方重算（ensure 由渲染层触发）。
        void ensureLanguage(canonical);
        return null;
      }
      if (code.split('\n').length > CODE_HIGHLIGHT_MAX_LINES) return null;
      const cached = cache.has(`${canonical}\u0000${code}`);
      if (cached || code.split('\n').length <= LARGE_FENCE_LINES) {
        return compute(canonical, code);
      }
      // 大围栏：后台计算，完成后再通知重算（期间保持纯文本）。
      queueMicrotask(() => {
        compute(canonical, code);
        notify();
      });
      return null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** 进程级单例：块编辑、实时预览、源码模式共享同一注册表与缓存。 */
export const fenceHighlighter: FenceHighlighter = createFenceHighlighter();
