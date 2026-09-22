import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { ok, err, type Result } from '@nexnote/shared';
import type { BinaryKind } from '@nexnote/shared';
import type { IpcRegistrar } from './registrar';
import type { IpcServices } from './services';
import { BinaryService, MAX_BINARY_BYTES } from '../binary/binary-service';

/**
 * binary:* — 应用内二进制编辑器（DEV-074，ADR-0015）。
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

  registrar.register(
    'binary:import',
    async ({ kind, data, name, targetDir }, services) => {
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
        const result = await service(services).importBinary(kind, { base64: data, name }, targetDir ?? '');
        await recordWrite(services, `导入 ${kind.toUpperCase()} ${result.path}`);
        return ok(result);
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  registrar.register('binary:read', async ({ kind, path }, services) => {
    try {
      return ok(await service(services).read(kind, path));
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

  registrar.register('binary:docx:read', async ({ path }, services) => {
    try {
      return ok(await service(services).readDocxHtml(path));
    } catch (e) {
      return toErrorResult(e);
    }
  });

  registrar.register('binary:docx:save', async ({ path, html, expectedSha256 }, services) => {
    try {
      const result = await service(services).saveDocxHtml(path, html, expectedSha256);
      await recordWrite(services, `保存 DOCX ${path}`);
      return ok(result);
    } catch (e) {
      return toErrorResult(e);
    }
  });

  const GITIGNORE_MARKER = '# NexNote binary documents (DEV-074)';

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

  registrar.register('binary:editorTheme', async ({ theme }, services) => {
    services.binaryEditors.applyTheme(theme);
    return ok({ applied: true as const });
  });

  registrar.register('binary:host:flush', async ({ kind, path }, services) => {
    await services.binaryEditors.flush(`${kind}:${path}`);
    return ok({ flushed: true as const });
  });

  registrar.register('binary:gitignore:set', async ({ untrack }, services) => {
    const root = services.vaultSession.getCurrent()?.root;
    if (!root) return err('当前未打开知识库', 'NO_VAULT');
    const gitignorePath = path.join(root, '.gitignore');
    try {
      const current = (await fsp.readFile(gitignorePath, 'utf8').catch(() => '')) as string;
      // ADR-0003 护栏条目（.nexnote/ 等）不在本通道管辖范围，只处理 binary 段。
      const lines = current.split('\n').filter(
        (line) => line !== GITIGNORE_MARKER && line !== '*.docx' && line !== '*.xlsx' && line !== '*.xmind',
      );
      if (untrack) {
        lines.push(GITIGNORE_MARKER, '*.docx', '*.xlsx', '*.xmind', '');
      }
      const content = lines.join('\n').replace(/^\n+/, '');
      await fsp.writeFile(gitignorePath, content || '');
      return ok({ untracked: untrack });
    } catch (e) {
      return toErrorResult(e);
    }
  });

  registrar.register('binary:gitignore:get', async (_payload, services) => {
    const root = services.vaultSession.getCurrent()?.root;
    if (!root) return err('当前未打开知识库', 'NO_VAULT');
    const current = await fsp.readFile(path.join(root, '.gitignore'), 'utf8').catch(() => '');
    return ok({ untracked: current.includes(GITIGNORE_MARKER) });
  });
}
