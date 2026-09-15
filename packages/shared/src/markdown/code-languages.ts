/**
 * 围栏代码块语言覆盖清单（DEV-029）。
 *
 * 块渲染 / 实时预览（lowlight）与源码模式围栏（CodeMirror）共用这一份清单与别名表：
 * 新增语言只改这里，三处渲染路径自动跟随。
 *
 * - `CODE_LANGUAGES` 为规范名（canonical）；除 `plaintext` 外都对应 highlight.js 语法
 *   （highlight.js 未内置的 toml / hcl 由内核自定义语法补齐），或 CodeMirror 语言包。
 * - 未标注 / 未收录的语言一律规范化为 `plaintext`：降级为纯文本，不抛错。
 */

/** common 集（静态注册，随内核一起打包）。 */
const COMMON_LANGUAGES = [
  'arduino',
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'diff',
  'go',
  'graphql',
  'ini',
  'java',
  'javascript',
  'json',
  'kotlin',
  'less',
  'lua',
  'makefile',
  'markdown',
  'objectivec',
  'perl',
  'php',
  'php-template',
  'plaintext',
  'python',
  'python-repl',
  'r',
  'ruby',
  'rust',
  'scss',
  'shell',
  'sql',
  'swift',
  'typescript',
  'vbnet',
  'wasm',
  'xml',
  'yaml',
] as const;

/** 追加语言（lowlight 按需懒加载语法；CodeMirror 有语言包的按需懒加载）。 */
const EXTRA_LANGUAGES = [
  'awk',
  'clojure',
  'cmake',
  'crystal',
  'dart',
  'dockerfile',
  'elixir',
  'elm',
  'erlang',
  'fsharp',
  'groovy',
  'haskell',
  'hcl',
  'julia',
  'latex',
  'lisp',
  'matlab',
  'nginx',
  'nim',
  'nix',
  'ocaml',
  'powershell',
  'properties',
  'protobuf',
  'scala',
  'scheme',
  'toml',
  'verilog',
  'vhdl',
] as const;

/** 规范语言名（三处渲染路径共用的唯一清单）。 */
export const CODE_LANGUAGES = [...COMMON_LANGUAGES, ...EXTRA_LANGUAGES] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

/** 别名 → 规范名（围栏里写作 ```js 时也走 `javascript` 语法）。 */
export const CODE_LANGUAGE_ALIASES: Readonly<Record<string, CodeLanguage>> = {
  'c++': 'cpp',
  'c#': 'csharp',
  bash: 'bash',
  cs: 'csharp',
  docker: 'dockerfile',
  html: 'xml',
  js: 'javascript',
  jsonc: 'json',
  jsx: 'javascript',
  kt: 'kotlin',
  make: 'makefile',
  md: 'markdown',
  'objective-c': 'objectivec',
  ps: 'powershell',
  ps1: 'powershell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'shell',
  svelte: 'xml',
  terraform: 'hcl',
  tex: 'latex',
  tf: 'hcl',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'xml',
  yml: 'yaml',
  zsh: 'shell',
};

/** 语言覆盖上限：超过则视为纯文本（超大围栏不做语法分析，避免编辑卡顿）。 */
export const CODE_HIGHLIGHT_MAX_LINES = 5000;

/**
 * 规范化围栏 info string（`"ts title=x"` → `typescript`）。
 * 未标注、未知或超出覆盖上限的语言一律降级 `plaintext`。
 */
export function normalizeCodeLanguage(info: string | null | undefined): CodeLanguage {
  const first = (info ?? '').trim().split(/\s+/)[0] ?? '';
  const value = first.toLowerCase();
  const canonical = CODE_LANGUAGE_ALIASES[value] ?? value;
  return (CODE_LANGUAGES as readonly string[]).includes(canonical)
    ? (canonical as CodeLanguage)
    : 'plaintext';
}

/** 该 info string 是否对应一个真实语法（未标注 / 未知为 false）。 */
export function isHighlightableLanguage(info: string | null | undefined): boolean {
  return normalizeCodeLanguage(info) !== 'plaintext';
}
