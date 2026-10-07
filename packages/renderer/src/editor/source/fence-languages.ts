import { LanguageDescription } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';

/** CM grammar descriptors; packages are already in the static HTML/Markdown graph. */
export const staticFenceLanguages: readonly LanguageDescription[] = [
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['javascript', 'js', 'jsx'],
    load: async () => javascript({ jsx: true }),
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['typescript', 'ts', 'tsx'],
    load: async () => javascript({ typescript: true, jsx: true }),
  }),
  LanguageDescription.of({
    name: 'HTML',
    alias: ['html', 'vue', 'svelte'],
    load: async () => html({ matchClosingTags: false }),
  }),
  LanguageDescription.of({
    name: 'CSS',
    alias: ['css', 'scss', 'less'],
    load: async () => css(),
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
