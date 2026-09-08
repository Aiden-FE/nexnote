// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createEditor } from '../src/editor';

/**
 * 原生 Cmd+C 的 text/plain 由 clipboardTextSerializer 生成。
 * 契约：复制结果与磁盘 Markdown 结构一致——列表项之间单换行、
 * 段落之间一个空行；不泄漏 frontmatter 与 ^block-id 锚点。
 */
function copyAllText(markdown: string): string {
  const container = document.createElement('div');
  document.body.append(container);
  const kernel = createEditor(container, {
    initialMarkdown: markdown,
    slashMenu: false,
    dragHandle: false,
  });
  kernel.editor.commands.selectAll();
  const { view } = kernel.editor;
  const slice = view.state.selection.content();
  const text = view.someProp('clipboardTextSerializer', (f) => f(slice)) ?? '';
  kernel.editor.destroy();
  container.remove();
  return text;
}

describe('编辑器原生复制的纯文本序列化', () => {
  it('无序列表各项之间是单换行，不插入空行', () => {
    const text = copyAllText('# 标题\n\n- 甲\n- 乙\n- 丙\n');

    expect(text).toContain('- 甲\n- 乙\n- 丙');
  });

  it('相邻段落之间恰好一个空行', () => {
    const text = copyAllText('第一段。\n\n第二段。\n');

    expect(text).toBe('第一段。\n\n第二段。');
  });

  it('混合结构：标题/段落/列表的间距与 Markdown 源一致', () => {
    const text = copyAllText('# 标题\n\n第一段。\n\n- 甲\n- 乙\n\n第二段。\n');

    expect(text).toBe('# 标题\n\n第一段。\n\n- 甲\n- 乙\n\n第二段。');
  });

  it('复制结果不携带 ^block-id 锚点', () => {
    const text = copyAllText('# 标题 ^abc123\n\n正文 ^def456\n');

    expect(text).not.toContain('^abc123');
    expect(text).not.toContain('^def456');
  });

  it('代码围栏内的连续空行原样保留（空行折叠只在围栏外生效）', () => {
    const text = copyAllText('段落一。\n\n\n\n```js\na\n\n\nb\n```\n\n段落二。\n');

    expect(text).toBe('段落一。\n\n```js\na\n\n\nb\n```\n\n段落二。');
  });

  it('全选复制不包含 frontmatter 元数据', () => {
    const text = copyAllText(
      '---\ncreated: 2026-01-01T00:00:00.000Z\nid: abc\n---\n\n# 标题\n\n正文。\n',
    );

    expect(text).not.toContain('created:');
    expect(text).toContain('# 标题');
  });
});
