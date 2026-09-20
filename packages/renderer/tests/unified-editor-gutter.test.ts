// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DEV-061 统一块编辑器左侧 gutter CSS 合同', () => {
  const css = readFileSync(
    resolve(import.meta.dirname, '../src/globals.css'),
    'utf8',
  );

  it('编辑器挂载点改为双列网格（gutter + 内容），双列均不依赖 padding-left hack', () => {
    expect(css).toMatch(
      /\.nexnote-editor-host\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*3\.75rem\s+minmax\(0,\s*1fr\)/s,
    );
    // 标题不再为 chevron 预留 padding-left。
    expect(css).toMatch(
      /\.nexnote-editor-host \.ProseMirror h1,\s*\n\.nexnote-editor-host \.ProseMirror h2,\s*\n\.nexnote-editor-host \.ProseMirror h3,\s*\n\.nexnote-editor-host \.ProseMirror h4,\s*\n\.nexnote-editor-host \.ProseMirror h5,\s*\n\.nexnote-editor-host \.ProseMirror h6\s*\{\s*\n\s*padding-left:\s*0;/s,
    );
    // 拖拽手柄不再使用会让命中出现空白的 translateX hack。
    expect(css).not.toMatch(/\.nexnote-drag-handle\s*\{[^}]*transform:\s*translateX\(-1\.9rem\)/s);
  });

  it('chevron overlay 命中宿主列，与拖拽手柄共享 3.75rem gutter', () => {
    expect(css).toMatch(/\.nexnote-fold-overlay\s*\{[^}]*position:\s*absolute/s);
    expect(css).toMatch(
      /\.nexnote-fold-overlay__toggle\s*\{[^}]*left:\s*calc\(3\.75rem - 1\.6rem\);[^}]*width:\s*1\.6rem/s,
    );
    expect(css).toMatch(/\.nexnote-fold-overlay__toggle:focus-visible\s*\{[^}]*outline:/s);
  });

  it('拖拽手柄提供热区：bridge 元素铺到 chevron 侧以避免 mouseleave 隐藏', () => {
    expect(css).toMatch(/\.nexnote-drag-handle__bridge\s*\{[^}]*pointer-events:\s*auto/s);
  });
});