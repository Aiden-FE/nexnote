// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { blockAnchorRange, createSourceEditor } from '../src/editor/source/codemirror-host';

describe('源码块锚点视觉弱化（DEV-020 GUI 反馈）', () => {
  it('识别行尾块锚点且不把分隔空格算入 decoration', () => {
    expect(blockAnchorRange('# 标题 ^20urxq4')).toEqual({ from: 5, to: 13 });
    expect(blockAnchorRange('^isf2gy8')).toEqual({ from: 0, to: 8 });
    expect(blockAnchorRange('正文 ^abc  ')).toEqual({ from: 3, to: 7 });
  });

  it('不误伤正文内的 ^ 或非法锚点', () => {
    expect(blockAnchorRange('a^b')).toBeNull();
    expect(blockAnchorRange('正文 ^含中文')).toBeNull();
    expect(blockAnchorRange('正文 ^abc 后续')).toBeNull();
  });

  it('CodeMirror 只做视觉标记，不改源码字节', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const original = '# 标题 ^20urxq4\n\n正文 a^b\n\n^isf2gy8\n\n```js\n^codeanchor\n```\n';
    const editor = createSourceEditor(parent, { initialText: original, onChange: () => undefined });

    expect(editor.getText()).toBe(original);
    expect(parent.querySelectorAll('.cm-block-anchor')).toHaveLength(2);
    editor.destroy();
    parent.remove();
  });
});
