import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  parseXmindToModel,
  writeModelToXmind,
  XmindError,
} from '../src/binary/xmind-convert';
import { preserveXmindReadonly } from '../src/binary/zip-preserve';

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

  it('DEV-074 保留：模型未涵盖的主题资源/外框关联线字节与 manifest 条目回填到重建包', async () => {
    const original = await buildSampleXmind();
    const zip = await JSZip.loadAsync(original);
    // 模拟只读保留区：主题图片资源、外框/关联线承载的 content.xml 旧节点、manifest 引用。
    const imageBytes = Buffer.from('FAKE_IMAGE_BYTES');
    zip.file('resources/logo.png', imageBytes);
    zip.file('content.xml', '<xmap-content preserved="boundary-relationship"/>');
    zip.file(
      'manifest.json',
      JSON.stringify({
        'file-entries': {
          'content.json': {},
          'resources/logo.png': { mediaType: 'image/png' },
          'content.xml': {},
        },
      }),
    );
    const originalBytes = await zip.generateAsync({ type: 'nodebuffer' });

    // 保存链路：模型重建（不产生 resources/ 与 content.xml）→ preserveXmindReadonly 回填。
    const parsed = await parseXmindToModel(originalBytes);
    const rebuilt = await writeModelToXmind(parsed.model, '样例');
    const preserved = await preserveXmindReadonly(originalBytes, rebuilt);

    const out = await JSZip.loadAsync(preserved);
    expect(out.file('resources/logo.png')).not.toBeNull();
    expect(await out.file('resources/logo.png')!.async('nodebuffer')).toEqual(imageBytes);
    expect(out.file('content.xml')).not.toBeNull();
    expect(await out.file('content.xml')!.async('string')).toContain('preserved="boundary-relationship"');
    const manifest = JSON.parse(await out.file('manifest.json')!.async('string')) as {
      'file-entries': Record<string, unknown>;
    };
    expect(manifest['file-entries']['resources/logo.png']).toEqual({ mediaType: 'image/png' });
    expect(manifest['file-entries']['content.xml']).toEqual({});
    // 新编辑仍然生效。
    const reparsed = await parseXmindToModel(preserved);
    expect(reparsed.model.data.text).toBe('中心主题');
    expect(reparsed.model.children?.length).toBe(2);
  });

  it('DEV-074 保留：content.json sheet 与 rootTopic 上未建模字段（boundaries / relationships / theme）原样保留到重建包', async () => {
    const zip = new JSZip();
    const sheet = {
      id: 'sheet-A',
      class: 'sheet',
      title: '原 sheet',
      boundaries: [{ id: 'b1', title: '外框 A', range: '(0,2)' }],
      relationships: [{ id: 'r1', end1: 'child1', end2: 'child2' }],
      theme: { themeId: 'theme-legacy', colorMapping: {} },
      skeleton: { id: 'sk1' },
      extensions: [{ name: 'ext-A' }],
      rootTopic: {
        id: 'root1',
        structureClass: 'org.xmind.ui.logic.right',
        title: '中心主题',
        boundaries: [{ id: 'rb1' }],
        topicPositioning: 'free',
        children: {
          attached: [
            { id: 'child1', title: '子节点一' },
            { id: 'child2', title: '子节点二' },
          ],
        },
      },
    };
    zip.file('content.json', JSON.stringify([sheet]));
    zip.file('manifest.json', JSON.stringify({ 'file-entries': { 'content.json': {} } }));
    const originalBytes = await zip.generateAsync({ type: 'nodebuffer' });

    const parsed = await parseXmindToModel(originalBytes);
    const rebuilt = await writeModelToXmind(parsed.model, '样例');
    const preserved = await preserveXmindReadonly(originalBytes, rebuilt);

    const out = await JSZip.loadAsync(preserved);
    const outSheet = JSON.parse(
      await out.file('content.json')!.async('string'),
    ) as Array<Record<string, unknown>>;
    const sheet0 = outSheet[0]!;
    const outRoot = (sheet0.rootTopic ?? {}) as Record<string, unknown>;
    expect(sheet0.boundaries).toEqual([{ id: 'b1', title: '外框 A', range: '(0,2)' }]);
    expect(sheet0.relationships).toEqual([{ id: 'r1', end1: 'child1', end2: 'child2' }]);
    expect(sheet0.theme).toEqual({ themeId: 'theme-legacy', colorMapping: {} });
    expect(sheet0.skeleton).toEqual({ id: 'sk1' });
    expect(outRoot.boundaries).toEqual([{ id: 'rb1' }]);
    expect(sheet0.title).toBe('样例');
    expect(String(sheet0.id)).toMatch(/^simpleMindMap_/);
    expect(outRoot.title).toBe('中心主题');
    expect(Array.isArray((outRoot.children as { attached?: unknown[] })?.attached)).toBe(true);
  });
});
