import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, it, expect } from 'vitest';
import { validatePayload } from '../src/ipc/validation';
import { registerBinaryHandlers } from '../src/ipc/binary-handlers';
import { MetadataStore } from '../src/document/metadata-store';
import { MINDMAP_STRUCTURE_IDS } from '@nexnote/shared';
import type { IpcServices } from '../src/ipc/services';
import type { IpcRegistrar } from '../src/ipc/registrar';

const roots: string[] = [];
const run = promisify(execFile);
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

/** 注册进来的 IPC 处理器签名（payload → Result）。 */
type CollectedHandler = (payload: unknown, services: IpcServices) => Promise<unknown>;

/** 收集 register 调用，拿到 binary:mindmapStructure:set 的处理器直接调用。 */
function collectHandlers(): { channel: string; handler: CollectedHandler }[] {
  const collected: { channel: string; handler: CollectedHandler }[] = [];
  const registrar = {
    register: (channel: string, handler: CollectedHandler) => collected.push({ channel, handler }),
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
    await (handler as { handler: CollectedHandler }).handler(
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
    const result = await (handler as { handler: CollectedHandler }).handler(
      { path: 'a.xmind', structure: 'right' },
      servicesFor(''),
    );
    expect(result).toMatchObject({ ok: false });
  });

  it('sidecar 可随 Git 到达第二份工作副本并保持结构（跨设备验收）', async () => {
    const source = await vault();
    const docPath = 'Notes/plan.xmind';
    await (
      await import('node:fs/promises')
    ).mkdir(path.join(source, 'Notes'), {
      recursive: true,
    });
    await (
      await import('node:fs/promises')
    ).writeFile(path.join(source, docPath), Buffer.from('PK\u0003\u0004fake-xmind-bytes'));
    await new MetadataStore(source).write(docPath, {
      mindmapTheme: 'classic',
      mindmapStructure: 'x',
    });
    await run('git', ['init', '--initial-branch=main', source]);
    await run('git', ['-C', source, 'config', 'user.name', 'NexNote Test']);
    await run('git', ['-C', source, 'config', 'user.email', 'test@nexnote.invalid']);
    await run('git', ['-C', source, 'add', '.']);
    await run('git', ['-C', source, 'commit', '-m', 'mindmap structure sidecar']);

    const clone = await mkdtemp(path.join(tmpdir(), 'nexnote-structure-clone-'));
    roots.push(clone);
    await run('git', ['clone', source, clone]);
    expect(await new MetadataStore(clone).read(docPath)).toMatchObject({
      mindmapTheme: 'classic',
      mindmapStructure: 'x',
    });
  });
});
