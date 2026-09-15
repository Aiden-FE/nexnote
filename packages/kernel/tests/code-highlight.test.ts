// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, createFenceHighlighter } from '../src/index';
import { CODE_LANGUAGES, normalizeCodeLanguage } from '@nexnote/shared';

const samples: Record<string, string> = {
  dockerfile: 'FROM node:22',
  powershell: 'Write-Host "hello"',
  latex: '\\section{Title}',
  cmake: 'set(VERSION 1.2.3)',
  dart: 'void main() { print(1); }',
  scala: 'val count = 42',
  haskell: 'main :: IO ()',
  elixir: 'defmodule Demo do\nend',
  toml: 'title = "NexNote"',
  hcl: 'resource "aws_instance" "web" {\n  count = 1\n}',
};

describe('DEV-029 · 覆盖清单与 lowlight 注册', () => {
  it('common 全集在共享清单内', () => {
    for (const language of [
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
      'plaintext',
      'python',
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
    ]) {
      expect(CODE_LANGUAGES).toContain(language);
    }
  });

  it('票据要求的追加语言全部收录且可规范化', () => {
    for (const language of [
      'dockerfile',
      'toml',
      'powershell',
      'latex',
      'cmake',
      'hcl',
      'dart',
      'scala',
      'haskell',
      'elixir',
    ]) {
      expect(CODE_LANGUAGES).toContain(language);
      expect(normalizeCodeLanguage(language)).toBe(language);
    }
    expect(normalizeCodeLanguage('terraform')).toBe('hcl');
    expect(normalizeCodeLanguage('TF')).toBe('hcl');
    expect(normalizeCodeLanguage('ts')).toBe('typescript');
    expect(normalizeCodeLanguage('js')).toBe('javascript');
    expect(normalizeCodeLanguage('yml')).toBe('yaml');
  });

  it.each(Object.keys(samples))('追加语言 %s 经懒加载注册后产出 token', async (language) => {
    const highlighter = createFenceHighlighter();
    await expect(highlighter.ensure(language)).resolves.toBe(true);
    const spans = highlighter.tokenSpans(language, samples[language] ?? '');
    expect(spans?.length).toBeGreaterThan(0);
    expect(spans?.every((span) => span.to > span.from && span.className.includes('hljs-'))).toBe(
      true,
    );
  });

  it('未知 / 未标注语言降级纯文本，不抛错', () => {
    const highlighter = createFenceHighlighter();
    expect(highlighter.tokenSpans('foo', 'const value = true')).toBeNull();
    expect(highlighter.tokenSpans('', 'const value = true')).toBeNull();
    expect(highlighter.tokenSpans(null, 'const value = true')).toBeNull();
    expect(highlighter.tokenSpans('ts title=x', 'const value = true')?.length).toBeGreaterThan(0);
  });

  it('超大围栏超出上限后不再做语法分析（纯文本降级）', () => {
    const highlighter = createFenceHighlighter();
    const huge = Array.from({ length: 5001 }, (_, i) => `const value${i} = ${i};`).join('\n');
    expect(highlighter.tokenSpans('javascript', huge)).toBeNull();
  });

  it('相同内容命中缓存（重复引用）', () => {
    const highlighter = createFenceHighlighter();
    const first = highlighter.tokenSpans('javascript', 'const a = 1;');
    const second = highlighter.tokenSpans('javascript', 'const a = 1;');
    expect(second).toBe(first);
  });
});

describe('DEV-029 · 块渲染高亮（ProseMirror decoration）', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('懒加载语言在块编辑器内渲染 hljs token', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const editor = createEditor(host, {
      initialMarkdown: '```dockerfile\nFROM node:22\nRUN echo hi\n```',
      slashMenu: false,
      dragHandle: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const tokens = host.querySelectorAll('[class*="hljs-"]');
    expect(tokens.length).toBeGreaterThan(0);
    editor.destroy();
  });

  it('未知语言 ```foo 渲染为纯文本且无控制台报错', async () => {
    const errors: string[] = [];
    const errorListener = (event: ErrorEvent) => errors.push(String(event.message));
    window.addEventListener('error', errorListener);
    const host = document.createElement('div');
    document.body.append(host);
    const editor = createEditor(host, {
      initialMarkdown: '```foo\nsome code\n```',
      slashMenu: false,
      dragHandle: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(host.querySelectorAll('[class*="hljs-"]')).toHaveLength(0);
    expect(errors).toHaveLength(0);
    window.removeEventListener('error', errorListener);
    editor.destroy();
  });

  it('common 语言（如 typescript）保持即时高亮', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const editor = createEditor(host, {
      initialMarkdown: '```typescript\nconst value: number = 1;\n```',
      slashMenu: false,
      dragHandle: false,
    });
    expect(host.querySelectorAll('[class*="hljs-"]').length).toBeGreaterThan(0);
    editor.destroy();
  });

  it('千行代码块高亮为后台计算，不阻塞首帧（编辑器可同步构建）', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const code = Array.from({ length: 1200 }, (_, i) => `const value${i} = ${i}; // line`).join(
      '\n',
    );
    const startedAt = performance.now();
    const editor = createEditor(host, {
      initialMarkdown: '```javascript\n' + code + '\n```',
      slashMenu: false,
      dragHandle: false,
    });
    const mountMs = performance.now() - startedAt;
    expect(mountMs).toBeLessThan(2000);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(host.querySelectorAll('[class*="hljs-"]').length).toBeGreaterThan(0);
    editor.destroy();
  });
});
