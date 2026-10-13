// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createEditor } from '../src';

/**
 * 块文档字体颜色 / 背景色（验收问题 1：工具栏无入口）。
 *
 * 能力落点：官方 TextStyle/Color/BackgroundColor + 内核补 markdown 序列化
 * （官方扩展无 renderMarkdown 时 @tiptap/markdown 会静默丢 mark）。
 * 落盘形态为 Obsidian 兼容内联 HTML span。
 */

/** 在正文中找到首个 text 为 needle 的文本节点位置区间。 */
function textRange(
  kernel: ReturnType<typeof createEditor>,
  needle: string,
): {
  from: number;
  to: number;
} {
  let start = -1;
  let index = 0;
  kernel.editor.state.doc.descendants((node) => {
    if (start >= 0) return false;
    if (node.isText && node.text) {
      const offset = node.text.indexOf(needle);
      if (offset >= 0) {
        start = index + offset;
        index = offset;
        return false;
      }
      index += node.text.length;
    }
    return true;
  });
  if (start < 0) throw new Error(`未找到文本：${needle}`);
  return { from: start + 1, to: start + 1 + needle.length };
}

describe('块文档字体颜色 / 背景色', () => {
  it('setColor 落盘为内联 span，重新解析后颜色保留', () => {
    const kernel = createEditor(document.createElement('div'), {
      initialMarkdown: '普通与彩色文字。',
    });
    const { from, to } = textRange(kernel, '彩色');
    kernel.editor.chain().focus().setTextSelection({ from, to }).setColor('#ff0000').run();

    const markdown = kernel.getMarkdown();
    expect(markdown).toContain('<span style="color: #ff0000">彩色</span>');

    const reopened = createEditor(document.createElement('div'), { initialMarkdown: markdown });
    const json = JSON.stringify(reopened.editor.getJSON());
    expect(json).toContain('"color":"#ff0000"');
    // 文本本身不丢
    expect(reopened.editor.getText()).toContain('彩色');
    // 二次往返稳定（不重复包裹 span、不漂移）
    expect(reopened.getMarkdown()).toBe(markdown);
  });

  it('setBackgroundColor 同样按 span 往返', () => {
    const kernel = createEditor(document.createElement('div'), {
      initialMarkdown: '普通与高亮文字。',
    });
    const { from, to } = textRange(kernel, '高亮');
    kernel.editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .setBackgroundColor('#fff2cc')
      .run();

    const markdown = kernel.getMarkdown();
    expect(markdown).toContain('<span style="background-color: #fff2cc">高亮</span>');

    const reopened = createEditor(document.createElement('div'), { initialMarkdown: markdown });
    expect(JSON.stringify(reopened.editor.getJSON())).toContain('"backgroundColor":"#fff2cc"');
  });

  it('颜色与背景色写在同一个 span 上', () => {
    const kernel = createEditor(document.createElement('div'), {
      initialMarkdown: '普通与双色文字。',
    });
    const { from, to } = textRange(kernel, '双色');
    kernel.editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .setColor('#ff0000')
      .setBackgroundColor('#fff2cc')
      .run();

    const markdown = kernel.getMarkdown();
    expect(markdown).toContain(
      '<span style="color: #ff0000; background-color: #fff2cc">双色</span>',
    );
  });

  it('unsetColor / unsetBackgroundColor 移除属性且不留空 span', () => {
    const kernel = createEditor(document.createElement('div'), {
      initialMarkdown: '普通与彩色文字。',
    });
    const { from, to } = textRange(kernel, '彩色');
    kernel.editor.chain().focus().setTextSelection({ from, to }).setColor('#ff0000').run();
    expect(kernel.getMarkdown()).toContain('<span');

    kernel.editor.chain().focus().setTextSelection({ from, to }).unsetColor().run();
    const markdown = kernel.getMarkdown();
    expect(markdown).not.toContain('<span');
    expect(markdown).toContain('彩色');
    // 无色文本重解析后不应凭空产生 textStyle mark
    const reopened = createEditor(document.createElement('div'), { initialMarkdown: markdown });
    expect(JSON.stringify(reopened.editor.getJSON())).not.toContain('textStyle');
  });

  it('外部手写的 span（Obsidian 产物）能被解析回颜色', () => {
    const kernel = createEditor(document.createElement('div'), {
      initialMarkdown: '前<span style="color: #E06666">红</span>后',
    });
    const json = JSON.stringify(kernel.editor.getJSON());
    expect(json).toContain('"color":"#E06666"');
    expect(kernel.editor.getText()).toContain('前红后');
  });

  it('颜色与其它 mark（加粗）共存', () => {
    const kernel = createEditor(document.createElement('div'), {
      initialMarkdown: '普通与彩色文字。',
    });
    const { from, to } = textRange(kernel, '彩色');
    kernel.editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .toggleBold()
      .setColor('#ff0000')
      .run();
    const markdown = kernel.getMarkdown();
    // markdown 分隔符整体包住颜色 span 会被折叠为纯 HTML 嵌套（CommonMark 不解析
    // inline HTML 内的 **，而 @tiptap/markdown 重新解析又拿不到外层 strong）
    expect(markdown).toContain('<strong><span style="color: #ff0000">彩色</span></strong>');

    const reopened = createEditor(document.createElement('div'), { initialMarkdown: markdown });
    const json = JSON.stringify(reopened.editor.getJSON());
    expect(json).toContain('"type":"bold"');
    expect(json).toContain('"color":"#ff0000"');
    expect(reopened.editor.getText()).toContain('彩色');
    // 二次往返稳定
    expect(reopened.getMarkdown()).toBe(markdown);
  });
});
