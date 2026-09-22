import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  parseXmindToModel,
  writeModelToXmind,
  XmindError,
} from '../src/binary/xmind-convert';

/** 构造一个合法 xmind（content.json v2）字节。 */
async function buildSampleXmind(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'content.json',
    JSON.stringify([
      {
        rootTopic: {
          id: 'root1',
          title: '中心主题',
          notes: { realHTML: { content: '根备注' } },
          href: 'https://example.com',
          labels: ['标签A'],
          children: {
            attached: [
              {
                id: 'child1',
                title: '子节点一',
                notes: { plain: { content: '子备注' } },
                children: { attached: [{ id: 'grand1', title: '孙节点' }] },
              },
              { id: 'child2', title: '子节点二' },
            ],
          },
        },
      },
    ]),
  );
  zip.file('metadata.json', '{"dataStructureVersion":"2"}');
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('xmind-convert（DEV-074，ADR-0015 R3）', () => {
  it('文本 / 树结构 / 备注 / 超链接 / 标签往返保留', async () => {
    const bytes = await buildSampleXmind();
    const parsed = await parseXmindToModel(bytes);
    expect(parsed.model.data.text).toBe('中心主题');
    expect(parsed.model.data.note).toBe('根备注');
    expect(parsed.model.data.hyperlink).toBe('https://example.com');
    expect(parsed.model.data.tag).toEqual(['标签A']);
    expect(parsed.model.children?.length).toBe(2);
    expect(parsed.model.children?.[0]?.data.text).toBe('子节点一');
    expect(parsed.model.children?.[0]?.data.note).toBe('子备注');
    expect(parsed.model.children?.[0]?.children?.[0]?.data.text).toBe('孙节点');

    // 写回 → 再解析：结构稳定。
    const rebuilt = await writeModelToXmind(parsed.model, '样例');
    const reparsed = await parseXmindToModel(rebuilt);
    expect(reparsed.model.data.text).toBe('中心主题');
    expect(reparsed.model.children?.length).toBe(2);
    expect(reparsed.model.children?.[1]?.data.text).toBe('子节点二');
  });

  it('损坏 / 非 zip 字节 fail-closed 拒绝', async () => {
    await expect(parseXmindToModel(Buffer.from('garbage'))).rejects.toThrow(XmindError);
    const empty = await new JSZip().generateAsync({ type: 'nodebuffer' });
    await expect(parseXmindToModel(empty)).rejects.toThrow(XmindError);
  });
});
