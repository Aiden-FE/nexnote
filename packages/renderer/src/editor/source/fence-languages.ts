import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript, typescriptLanguage } from '@codemirror/lang-javascript';
import { LanguageDescription, LanguageSupport } from '@codemirror/language';

export const staticFenceLanguages: readonly LanguageDescription[] = [
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['javascript', 'js', 'jsx'],
    support: javascript({ jsx: true }),
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['typescript', 'ts', 'tsx'],
    support: new LanguageSupport(typescriptLanguage),
  }),
  LanguageDescription.of({
    name: 'HTML',
    alias: ['html', 'vue', 'svelte'],
    support: html({ matchClosingTags: false }),
  }),
  LanguageDescription.of({ name: 'CSS', alias: ['css', 'scss', 'less'], support: css() }),
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
