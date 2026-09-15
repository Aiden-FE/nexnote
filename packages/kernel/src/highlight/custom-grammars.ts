import type { HLJSApi, Language } from 'highlight.js';

export function tomlGrammar(hljs: HLJSApi): Language {
  return {
    name: 'TOML',
    aliases: ['toml'],
    contains: [
      hljs.COMMENT('#', '$', { relevance: 0 }),
      { className: 'section', begin: /^\s*\[\[?[^\]]+\]\]?/ },
      { className: 'attr', begin: /^\s*[A-Za-z0-9_.-]+(?=\s*=)/ },
      {
        className: 'string',
        variants: [
          { begin: /"""/, end: /"""/, contains: [hljs.BACKSLASH_ESCAPE] },
          { begin: /'''/, end: /'''/ },
          { begin: /"/, end: /"/, contains: [hljs.BACKSLASH_ESCAPE] },
          { begin: /'/, end: /'/ },
        ],
      },
      { className: 'number', begin: /\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?\b/ },
      { className: 'literal', begin: /\b(?:true|false|inf|nan)\b/ },
    ],
  };
}

export function hclGrammar(hljs: HLJSApi): Language {
  return {
    name: 'HCL',
    aliases: ['terraform', 'tf'],
    contains: [
      hljs.COMMENT('//', '$', { relevance: 0 }),
      hljs.COMMENT('#', '$', { relevance: 0 }),
      hljs.COMMENT('/\\*', '\\*/', { relevance: 0 }),
      {
        className: 'string',
        begin: /"/,
        end: /"/,
        contains: [hljs.BACKSLASH_ESCAPE],
      },
      {
        className: 'keyword',
        begin:
          /\b(?:resource|data|variable|output|module|provider|terraform|locals|dynamic|for|in|if)\b/,
      },
      { className: 'literal', begin: /\b(?:true|false|null)\b/ },
      { className: 'number', begin: /\b\d+(?:\.\d+)?\b/ },
      { className: 'attr', begin: /[A-Za-z_][\w-]*(?=\s*=)/ },
    ],
  };
}
