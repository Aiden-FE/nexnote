import { describe, expect, it } from 'vitest';
import { codeLanguages, staticFenceLanguageNames } from '../src/editor/source/fence-languages';
import { sourceCodeLanguages } from '../src/editor/source/codemirror-host';

describe('DEV-029 source-mode fence languages', () => {
  it('uses the shared coverage list', () => {
    expect(sourceCodeLanguages).toContain('dockerfile');
    expect(sourceCodeLanguages).toContain('toml');
    expect(sourceCodeLanguages).toContain('hcl');
  });

  it.each(['js', 'jsx', 'ts', 'tsx', 'html', 'vue', 'svelte', 'css'])(
    'resolves %s through CodeMirror codeLanguages',
    (language) => {
      expect(codeLanguages(language)).toBeTruthy();
    },
  );

  it('leaves unknown languages unconfigured so CodeMirror renders plain text', () => {
    expect(codeLanguages('not-a-real-language')).toBeNull();
    expect(staticFenceLanguageNames.has('dockerfile')).toBe(false);
  });
});
