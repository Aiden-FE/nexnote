import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import { validatePayload } from '../src/ipc/validation';
import { registerBinaryHandlers } from '../src/ipc/binary-handlers';
import { MetadataStore } from '../src/document/metadata-store';
import { MINDMAP_STRUCTURE_IDS } from '@nexnote/shared';
import type { IpcServices } from '../src/ipc/services';
import type { IpcRegistrar } from '../src/ipc/registrar';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

/** 收集 register 调用，拿到 binary:mindmapStructure:set 的处理器直接调用。 */
function collectHandlers(): { channel: string; handler: Function }[] {
  const collected: { channel: string; handler: Function }[] = [];
  const registrar = {
    register: (channel: string, handler: Function) => collected.push({ channel, handler }),
  } as unknown as IpcRegistrar;
  registerBinaryHandlers(registrar);
  return collected;
}

async function vault(): Promise<string> {
  const value = await mkdtemp(path.join(tmpdir(), 'nexnote-structure-'));
  roots.push(value);
  return value;
}

function servicesFor(root: string): IpcServices {
  return { vaultSession: { getCurrent: () => ({ root }) } } as unknown as IpcServices;
}

/** DEV-102 / ADR-0020：布局结构选择经 binary:mindmapStructure:set 落 sidecar，
 *  channel 只接受已登记的结构 id（枚举白名单，不接受任意字符串）。 */

describe('binary:mindmapStructure:set payload（DEV-102）', () => {
  it('接受全部已登记结构 id', () => {
    for (const structure of MINDMAP_STRUCTURE_IDS) {
      expect(
        validatePayload('binary:mindmapStructure:set', { path: 'a.xmind', structure }),
      ).toBeNull();
    }
  });

  it('结构 id 必须是枚举值（自由字符串 fail-closed）', () => {
    expect(
      validatePayload('binary:mindmapStructure:set', { path: 'a.xmind', structure: '../../etc' }),
    ).toMatchObject({ code: 'IPC_PAYLOAD_INVALID' });
  });

  it('缺 path / 多余字段均拒绝', () => {
    expect(validatePayload('binary:mindmapStructure:set', { structure: 'right' })).toMatchObject({
      code: 'IPC_PAYLOAD_INVALID',
    });
    expect(
      validatePayload('binary:mindmapStructure:set', {
        path: 'a.xmind',
        structure: 'right',
        extra: 1,
      }),
    ).toMatchObject({ code: 'IPC_PAYLOAD_INVALID' });
  });
});

describe('binary:mindmapStructure:set 处理器（DEV-102 / ADR-0020）', () => {
  it('结构选择写进 sidecar，且不改动 .xmind 字节（决策 5）', async () => {
    const root = await vault();
    const docPath = 'Notes/plan.xmind';
    const bytes = Buffer.from('PK\u0003\u0004fake-xmind-bytes');
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(path.join(root, 'Notes'), { recursive: true });
    await writeFile(path.join(root, docPath), bytes);

    const handler = collectHandlers().find((it) => it.channel === 'binary:mindmapStructure:set');
    expect(handler).toBeDefined();

    const store = new MetadataStore(root);
    // 先写一条既有元数据，验证 read-merge-write 不覆盖别的字段
    await store.write(docPath, { mindmapTheme: 'classic' });
    await (handler as { handler: Function }).handler(
      { path: docPath, structure: 'x' },
      servicesFor(root),
    );

    const metadata = await store.read(docPath);
    expect(metadata).toMatchObject({ mindmapTheme: 'classic', mindmapStructure: 'x' });
    // xmind 字节零改动：布局结构不进入 .xmind（ADR-0020 决策 1/5）
    expect(await readFile(path.join(root, docPath))).toEqual(bytes);
  });

  it('未打开知识库时不写 sidecar', async () => {
    const handler = collectHandlers().find((it) => it.channel === 'binary:mindmapStructure:set');
    const result = await (handler as { handler: Function }).handler(
      { path: 'a.xmind', structure: 'right' },
      servicesFor(''),
    );
    expect(result).toMatchObject({ ok: false });
  });
});
