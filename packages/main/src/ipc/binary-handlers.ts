import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { ok, err, type Result } from '@nexnote/shared';
import type { BinaryKind } from '@nexnote/shared';
import type { IpcRegistrar } from './registrar';
import type { IpcServices } from './services';
import { BinaryService, MAX_BINARY_BYTES } from '../binary/binary-service';
import { BINARY_IGNORE_MARKER, updateBinaryIgnoreBlock } from '../binary/binary-gitignore';
import { MetadataStore } from '../document/metadata-store';

/**
 * binary:* — 应用内二进制编辑器（DEV-074，ADR-0015；DEV-098 撤销 docx 后仅 xlsx / xmind）。
 * 导入 fail-closed；副本可原地覆写（仓库内副本语义）；Git 跟踪可配置。
 */

const KIND_FILTERS: Record<BinaryKind, { name: string; extensions: string[] }> = {
  xlsx: { name: 'Excel 工作簿', extensions: ['xlsx'] },
  mindmap: { name: 'XMind 思维导图', extensions: ['xmind'] },
};

function toErrorResult(e: unknown): Result<never> {
  const message = e instanceof Error ? e.message : String(e);
  const code =
    e && typeof e === 'object' && 'code' in e && typeof e.code === 'string' ? e.code : 'INTERNAL';
  return err(message, code);
}

async function readPickedFile(picked: string): Promise<Buffer> {
  const handle = await fsp.open(picked, 'r');
  try {
    const stat = await handle.stat();
    if (stat.size > MAX_BINARY_BYTES) {
      throw new Error('文件过大（上限 200MB）');
    }
    const bytes = Buffer.alloc(stat.size);
    await handle.read(bytes, 0, stat.size, 0);
    return bytes;
  } finally {
    await handle.close();
  }
}

/** 写盘成功后调度 Git 自动提交并刷新状态（与 docx-handlers 同模式）。 */
async function recordWrite(services: IpcServices, summary: string): Promise<void> {
  services.git.scheduleAutoCommit(summary);
  try {
    services.windows.sendToMainWindow('git:statusChanged', await services.git.status());
  } catch {
    // 写盘已成功；状态栏由下一次常规刷新恢复。
  }
}

export function registerBinaryHandlers(registrar: IpcRegistrar): void {
  const service = (services: IpcServices): BinaryService =>
    new BinaryService(services.fs, () => services.vaultSession.getCurrent()?.root ?? null);

  registrar.register('binary:import', async ({ kind, data, name, targetDir }, services) => {
    try {
      if (!data) {
        const picked = await services.dialogs.pickFile([KIND_FILTERS[kind]]);
        if (!picked) return ok(null);
        const bytes = await readPickedFile(picked);
        const result = await service(services).importBinary(
          kind,
          { base64: bytes.toString('base64'), name: path.basename(picked) },
          targetDir ?? '',
        );
        await recordWrite(services, `导入 ${kind.toUpperCase()} ${result.path}`);
        return ok(result);
      }
      const result = await service(services).importBinary(
        kind,
        { base64: data, name },
        targetDir ?? '',
      );
      await recordWrite(services, `导入 ${kind.toUpperCase()} ${result.path}`);
      return ok(result);
    } catch (e) {
      return toErrorResult(e);
    }
  });

  registrar.register('binary:read', async ({ kind, path }, services) => {
    try {
      return ok(await service(services).read(kind, path));
    } catch (e) {
      return toErrorResult(e);
    }
  });

  // DEV-084：在 vault 内创建空白二进制文档（xlsx/xmind），与导入分离。
  registrar.register('binary:create', async ({ kind, title, targetDir }, services) => {
    try {
      const result = await service(services).createBinary(kind, { title, targetDir });
      await recordWrite(services, `新建空白 ${kind.toUpperCase()} ${result.path}`);
      return ok(result);
    } catch (e) {
      return toErrorResult(e);
    }
  });

  registrar.register('binary:save', async ({ kind, path, data, expectedSha256 }, services) => {
    try {
      const result = await service(services).save(kind, path, data, expectedSha256);
      await recordWrite(services, `保存 ${kind.toUpperCase()} ${path}`);
      return ok(result);
    } catch (e) {
      return toErrorResult(e);
    }
  });

  registrar.register('binary:host:open', async ({ kind, path }, services) => {
    await services.binaryEditors.open(kind, path);
    return ok({ opened: true as const });
  });

  registrar.register('binary:host:close', async ({ kind, path }, services) => {
    await services.binaryEditors.close(kind, path);
    return ok({ closed: true as const });
  });

  registrar.register('binary:host:setActive', async (payload, services) => {
    if (payload === null) {
      services.binaryEditors.clearActive();
    } else {
      services.binaryEditors.setActive(payload.kind, payload.path);
    }
    return ok({ active: true as const });
  });

  registrar.register('binary:host:setBounds', async ({ kind, path, bounds }, services) => {
    services.binaryEditors.setBounds(kind, path, bounds);
    return ok({ applied: true as const });
  });

  registrar.register('binary:editorTheme', async ({ theme }, services) => {
    services.binaryEditors.applyTheme(theme);
    return ok({ applied: true as const });
  });

  // DEV-099：xmind 主题预设持久化到 sidecar（read-merge-write，不碰 xmind 字节）。
  registrar.register('binary:mindmapTheme:set', async ({ path, theme }, services) => {
    const root = services.vaultSession.getCurrent()?.root;
    if (!root) return err('当前未打开知识库', 'NO_VAULT');
    const store = new MetadataStore(root);
    const current = (await store.read(path)) ?? {};
    await store.write(path, { ...current, mindmapTheme: theme });
    return ok({ saved: true as const });
  });

  // DEV-102：xmind 布局结构持久化到 sidecar（read-merge-write，不碰 xmind 字节；ADR-0020）。
  registrar.register('binary:mindmapStructure:set', async ({ path, structure }, services) => {
    const root = services.vaultSession.getCurrent()?.root;
    if (!root) return err('当前未打开知识库', 'NO_VAULT');
    const store = new MetadataStore(root);
    const current = (await store.read(path)) ?? {};
    await store.write(path, { ...current, mindmapStructure: structure });
    return ok({ saved: true as const });
  });

  registrar.register('binary:host:flush', async ({ kind, path }, services) => {
    await services.binaryEditors.flush(`${kind}:${path}`);
    return ok({ flushed: true as const });
  });

  registrar.register('binary:host:ready', async (_payload, _services, context) => {
    // 主进程用 senderId（= webContents.id）识别哪个 entry 在 ack。
    // 渲染层在 onEvent('binary:editorCommand') 安装完成后立刻发。
    // Pull 模型：排队的初始命令随响应返回给页面（订阅之后应用），主进程不主动 push——
    // push 早于订阅会永久丢消息，宿主将卡在「等待加载文档…」。
    const commands = _services.binaryEditors.acknowledgeReady(context.senderId);
    return ok({ commands });
  });

  registrar.register('binary:gitignore:set', async ({ untrack }, services) => {
    const root = services.vaultSession.getCurrent()?.root;
    if (!root) return err('当前未打开知识库', 'NO_VAULT');
    const gitignorePath = path.join(root, '.gitignore');
    try {
      const current = await fsp.readFile(gitignorePath, 'utf8').catch(() => '');
      const content = updateBinaryIgnoreBlock(current, untrack);
      if (content !== current) await fsp.writeFile(gitignorePath, content);
      const removedFromIndex = untrack ? await services.git.untrackBinaryDocuments(root) : 0;
      if (removedFromIndex > 0) services.git.scheduleAutoCommit('停止跟踪二进制文档');
      return ok({ untracked: untrack, removedFromIndex });
    } catch (e) {
      return toErrorResult(e);
    }
  });

  registrar.register('binary:gitignore:get', async (_payload, services) => {
    const root = services.vaultSession.getCurrent()?.root;
    if (!root) return err('当前未打开知识库', 'NO_VAULT');
    const current = await fsp.readFile(path.join(root, '.gitignore'), 'utf8').catch(() => '');
    return ok({ untracked: current.split(/\r?\n/).includes(BINARY_IGNORE_MARKER) });
  });
}
