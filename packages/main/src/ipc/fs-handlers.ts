import { err, ok, type Result } from '@nexnote/shared';
import type { DirEntry, FileInfo, RenameLinkedResult, TagStat } from '@nexnote/shared';
import * as pathLib from 'node:path';
import type { IpcRegistrar } from './registrar';
import { createNote, renameWithLinks, scanTags } from '../fs/page-ops';
import { MetadataStore } from '../document/metadata-store';
import type { IpcServices } from './services';

/** fs:* — vault 沙箱文件能力。 */
export function registerFsHandlers(registrar: IpcRegistrar): void {
  const recordWrite = async (services: IpcServices, summary: string): Promise<void> => {
    services.git.scheduleAutoCommit(summary);
    // Git status is advisory; a slow/broken status query must not fail the FS mutation.
    try {
      services.windows.sendToMainWindow('git:statusChanged', await services.git.status());
    } catch {
      // The write already succeeded and the debounce remains scheduled.
    }
  };

  registrar.register('fs:readTextFile', async ({ path }, services): Promise<Result<string>> =>
    ok(await services.fs.readTextFile(path)),
  );
  registrar.register(
    'fs:writeTextFile',
    async ({ path, content, createParentDirs }, services): Promise<Result<FileInfo>> => {
      const result = await services.fs.writeTextFile(path, content, createParentDirs ?? true);
      await recordWrite(services, `保存 ${path}`);
      return ok(result);
    },
  );
  registrar.register(
    'fs:createTextFile',
    async ({ path, content, createParentDirs }, services): Promise<Result<{ file: FileInfo | null; created: boolean }>> => {
      const result = await services.fs.createTextFile(path, content, createParentDirs ?? true);
      if (result.created) await recordWrite(services, `创建 ${path}`);
      return ok(result);
    },
  );
  registrar.register(
    'fs:importBinaryFile',
    async ({ path, data, suggestionName, mime, createParentDirs, overwrite }, services): Promise<Result<{ path: string }>> => {
      // renderer 传 base64，这里解码成 Buffer 再交给 fs 服务；不接受 node Buffer 类型，
      // 避免类型穿越 IPC 边界。mime 仅校验语义，不用于写入。
      if (typeof data !== 'string' || data.length === 0) {
        return { ok: false, error: 'data 不能为空', code: 'IPC_PAYLOAD_INVALID' };
      }
      let buffer;
      try {
        buffer = Buffer.from(data, 'base64');
      } catch (e) {
        return { ok: false, error: `data 不是合法 base64（${(e as Error).message}）`, code: 'IPC_PAYLOAD_INVALID' };
      }
      const target = suggestionName ?? path;
      const result = await services.fs.importBinaryFile(target, buffer, {
        createParentDirs: createParentDirs ?? true,
        overwrite: overwrite ?? false,
      });
      await recordWrite(services, `导入附件 ${result}`);
      void mime;
      return ok({ path: result });
    },
  );
  registrar.register('fs:exists', async ({ path }, services): Promise<Result<boolean>> =>
    ok(await services.fs.exists(path)),
  );
  registrar.register('fs:stat', async ({ path }, services): Promise<Result<FileInfo | null>> =>
    ok(await services.fs.stat(path)),
  );
  registrar.register('fs:listDir', async ({ path }, services): Promise<Result<DirEntry[]>> =>
    ok(await services.fs.listDir(path)),
  );
  registrar.register(
    'fs:mkdir',
    async ({ path, recursive }, services): Promise<Result<FileInfo>> => {
      const result = await services.fs.mkdir(path, recursive ?? false);
      await recordWrite(services, `创建目录 ${path}`);
      return ok(result);
    },
  );
  registrar.register('fs:rename', async ({ from, to }, services): Promise<Result<FileInfo>> => {
    const result = await services.fs.rename(from, to);
    await recordWrite(services, `重命名 ${from} → ${to}`);
    return ok(result);
  });
  registrar.register('fs:delete', async ({ path, toTrash }, services): Promise<Result<void>> => {
    if (path.trim().length === 0 || path.trim() === '.')
      return err('不允许删除 vault 根目录', 'VAULT_ROOT_OPERATION');
    if (toTrash) {
      const { abs } = await services.fs.resolve(path);
      try {
        await services.trash(abs);
      } catch {
        const name = pathLib.basename(abs);
        const ext = pathLib.extname(name);
        const stem = ext.length > 0 ? name.slice(0, -ext.length) : name;
        let target = `.trash/${name}`;
        if (await services.fs.exists(target)) target = `.trash/${stem}-${Date.now()}${ext}`;
        await services.fs.mkdir('.trash', true);
        await services.fs.rename(path, target);
      }
    } else {
      await services.fs.delete(path);
    }
    await recordWrite(services, `删除 ${path}`);
    return ok(undefined);
  });
  registrar.register(
    'fs:createNote',
    async ({ parentDir, name, content }, services): Promise<Result<FileInfo>> => {
      const root = services.vaultSession.getCurrent()?.root;
      const sidecar = root ? new MetadataStore(root) : undefined;
      const result = await createNote(services.fs, parentDir, name, content, sidecar);
      await recordWrite(services, `创建笔记 ${result.path}`);
      return ok(result);
    },
  );
  registrar.register(
    'fs:listTree',
    async ({ showAllFiles }, services): Promise<Result<DirEntry[]>> =>
      ok(await services.fs.listTree(showAllFiles ?? false)),
  );
  registrar.register(
    'fs:renameLinked',
    async ({ from, to }, services): Promise<Result<RenameLinkedResult>> => {
      const result = await renameWithLinks(services.fs, from, to);
      await recordWrite(services, `重命名并更新链接 ${from} → ${to}`);
      return ok(result);
    },
  );
  registrar.register('fs:revealInFinder', async ({ path }, services): Promise<Result<void>> => {
    const { abs } = await services.fs.resolve(path);
    await services.revealItem(abs);
    return ok(undefined);
  });
  registrar.register('fs:scanTags', async (_payload, services): Promise<Result<TagStat[]>> =>
    ok(await scanTags(services.fs)),
  );
}
