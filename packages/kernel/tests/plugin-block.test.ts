// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createEditor } from '../src/editor';
import { PLUGIN_BLOCK_FENCE } from '../src/extensions/plugin-block';

function make(markdown: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const kernel = createEditor(container, {
    initialMarkdown: markdown,
    slashMenu: false,
    dragHandle: false,
  });
  return { container, kernel };
}

describe('pluginBlock 扩展点（DEV-014）', () => {
  it('插入插件块并序列化为围栏代码块', () => {
    const { kernel, container } = make('普通段落\n\n');
    kernel.editor.commands.insertPluginBlock({
      pluginId: 'com.demo.widget',
      blockType: 'counter',
      data: JSON.stringify({ count: 3 }),
    });
    const md = kernel.getMarkdown();
    expect(md).toContain(PLUGIN_BLOCK_FENCE);
    expect(md).toContain('com.demo.widget:counter');
    expect(md).toContain('{"count":3}');
    kernel.destroy();
    container.remove();
  });

  it('围栏 Markdown 往返恢复插件块属性', () => {
    const fence =
      '```' + PLUGIN_BLOCK_FENCE + ':com.demo.widget:counter\n{"count":7}\n```';
    const { kernel, container } = make(`${fence}\n\n后续段落\n`);
    const blocks = kernel.getJSON().content ?? [];
    const pluginBlock = blocks.find((b) => b.type === 'pluginBlock');
    expect(pluginBlock).toBeTruthy();
    expect(pluginBlock?.attrs?.pluginId).toBe('com.demo.widget');
    expect(pluginBlock?.attrs?.blockType).toBe('counter');
    expect(pluginBlock?.attrs?.data).toBe('{"count":7}');

    // 再序列化保持一致（往返幂等）。
    const again = kernel.getMarkdown();
    expect(again).toContain('com.demo.widget:counter');
    expect(again).toContain('{"count":7}');
    kernel.destroy();
    container.remove();
  });

  it('更新插件块私有数据（编辑入口）', () => {
    const { kernel, container } = make(
      '```' + PLUGIN_BLOCK_FENCE + ':com.demo.widget:counter\n{"count":1}\n```',
    );
    const first = kernel.getJSON().content?.find((b) => b.type === 'pluginBlock');
    const pos = first ? kernel.editor.getPositionOfNode?.(first) : null;
    void pos;
    // 选中该节点后更新 data。
    kernel.editor.commands.selectNodeBackward?.();
    kernel.editor.commands.setPluginBlockData({ data: JSON.stringify({ count: 2 }) });
    const updated = kernel
      .getJSON()
      .content?.find((b) => b.type === 'pluginBlock');
    expect(updated?.attrs?.data).toBe('{"count":2}');
    kernel.destroy();
    container.remove();
  });
});
