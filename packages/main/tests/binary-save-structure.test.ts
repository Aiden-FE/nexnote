import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { BinaryService } from '../src/binary/binary-service';
import { MetadataStore } from '../src/document/metadata-store';
import type { VaultFsService } from '../src/fs/fs-service';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function vaultWithXmind(rootTopic: Record<string, unknown>): Promise<{
  root: string;
  service: BinaryService;
  relPath: string;
  sha256: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'nexnote-save-structure-'));
  roots.push(root);
  const relPath = 'Notes/plan.xmind';
  await mkdir(path.join(root, 'Notes'), { recursive: true });
  const zip = new JSZip();
  zip.file('content.json', JSON.stringify([{ id: 'sheet1', rootTopic }]));
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  await writeFile(path.join(root, relPath), bytes);
  const service = new BinaryService(
    {
      resolve: async (value: string) => ({ abs: path.join(root, value) }),
    } as unknown as VaultFsService,
    () => root,
  );
  const sha256 = (await service.read('mindmap', relPath)).sha256;
  return { root, service, relPath, sha256 };
}

async function rootTopicOf(root: string, relPath: string): Promise<Record<string, unknown>> {
  const bytes = await readFile(path.join(root, relPath));
  const json = JSON.parse(
    await JSZip.loadAsync(bytes).then((z) => z.file('content.json')!.async('string')),
  ) as [{ rootTopic: Record<string, unknown> }];
  return json[0].rootTopic;
}

const model = { data: { text: '中心主题' }, children: [{ data: { text: '子节点' } }] };

describe('DEV-114 xmind 结构文件权威保存', () => {
  it('legacy sidecar 受支持结构在首次保存时迁移为 root structureClass', async () => {
    const { root, service, relPath, sha256 } = await vaultWithXmind({
      id: 'root1',
      title: '中心主题',
    });
    await new MetadataStore(root).write(relPath, { mindmapStructure: 'fishbone' });
    await service.save('mindmap', relPath, { model }, sha256);
    expect(await rootTopicOf(root, relPath)).toMatchObject({
      structureClass: 'org.xmind.ui.fishbone.rightHeaded',
    });
  });

  it('legacy sidecar up/x 不迁移，未知官方 structureClass 保存后保留', async () => {
    const unknownClass = 'org.xmind.ui.map.clockwise';
    const { root, service, relPath, sha256 } = await vaultWithXmind({
      id: 'root1',
      title: '中心主题',
      structureClass: unknownClass,
    });
    await new MetadataStore(root).write(relPath, { mindmapStructure: 'up' });
    await service.save('mindmap', relPath, { model }, sha256);
    expect(await rootTopicOf(root, relPath)).toMatchObject({ structureClass: unknownClass });
  });

  it('外部已改为非 right 官方结构时，legacy sidecar 不覆写文件', async () => {
    const { root, service, relPath, sha256 } = await vaultWithXmind({
      id: 'root1',
      title: '中心主题',
      structureClass: 'org.xmind.ui.logic.left',
    });
    await new MetadataStore(root).write(relPath, { mindmapStructure: 'fishbone' });
    await service.save('mindmap', relPath, { model }, sha256);
    expect(await rootTopicOf(root, relPath)).toMatchObject({
      structureClass: 'org.xmind.ui.logic.left',
    });
  });

  it('旧 NexNote right 文件上，外部改为 left 时读取和保存都以文件为准', async () => {
    const { root, service, relPath, sha256 } = await vaultWithXmind({
      id: 'root1',
      title: '中心主题',
      structureClass: 'org.xmind.ui.logic.left',
    });
    await new MetadataStore(root).write(relPath, { mindmapStructure: 'right' });
    expect((await service.read('mindmap', relPath)).structureId).toBe('left');
    await service.save('mindmap', relPath, { model }, sha256);
    expect(await rootTopicOf(root, relPath)).toMatchObject({
      structureClass: 'org.xmind.ui.logic.left',
    });
  });

  it('显式结构请求随模型保存覆写 root structureClass', async () => {
    const { root, service, relPath, sha256 } = await vaultWithXmind({
      id: 'root1',
      title: '中心主题',
      structureClass: 'org.xmind.ui.logic.right',
    });
    await service.save('mindmap', relPath, { model, explicitStructure: 'left' }, sha256);
    expect(await rootTopicOf(root, relPath)).toMatchObject({
      structureClass: 'org.xmind.ui.logic.left',
    });
  });
});
