import { LanguageDescription } from '@codemirror/language';

/** CM grammars are loaded only when a matching fence is parsed. */
export const staticFenceLanguages: readonly LanguageDescription[] = [
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['javascript', 'js', 'jsx'],
    async load() {
      const { javascript } = await import('@codemirror/lang-javascript');
      return javascript({ jsx: true });
    },
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['typescript', 'ts', 'tsx'],
    async load() {
      const { javascript } = await import('@codemirror/lang-javascript');
      return javascript({ typescript: true, jsx: true });
    },
  }),
  LanguageDescription.of({
    name: 'HTML',
    alias: ['html', 'vue', 'svelte'],
    async load() {
      const { html } = await import('@codemirror/lang-html');
      return html({ matchClosingTags: false });
    },
  }),
  LanguageDescription.of({
    name: 'CSS',
    alias: ['css', 'scss', 'less'],
    async load() {
      const { css } = await import('@codemirror/lang-css');
      return css();
    },
  }),
];

export const staticFenceLanguageNames = new Set(
  staticFenceLanguages.flatMap((language) => [
    language.name.toLowerCase(),
    ...language.alias.map((alias) => alias.toLowerCase()),
  ]),
);

export function codeLanguages(info: string): LanguageDescription | null {
  return LanguageDescription.matchLanguageName(staticFenceLanguages, info.trim(), true);
}
