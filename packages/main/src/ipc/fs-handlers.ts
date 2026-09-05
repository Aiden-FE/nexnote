import { ok, type Result } from '@nexnote/shared';
import type { DirEntry, FileInfo } from '@nexnote/shared';
import type { IpcRegistrar } from './registrar';

/**
 * fs:* — vault 沙箱文件能力。
 * 越界路径一律被 VaultFsService 拒绝（ErrResult 返回渲染层）。
 */
export function registerFsHandlers(registrar: IpcRegistrar): void {
  registrar.register('fs:readTextFile', async ({ path }, services): Promise<Result<string>> => {
    return ok(await services.fs.readTextFile(path));
  });

  registrar.register(
    'fs:writeTextFile',
    async ({ path, content, createParentDirs }, services): Promise<Result<FileInfo>> => {
      return ok(await services.fs.writeTextFile(path, content, createParentDirs ?? true));
    },
  );

  registrar.register('fs:exists', async ({ path }, services): Promise<Result<boolean>> => {
    return ok(await services.fs.exists(path));
  });

  registrar.register('fs:stat', async ({ path }, services): Promise<Result<FileInfo | null>> => {
    return ok(await services.fs.stat(path));
  });

  registrar.register('fs:listDir', async ({ path }, services): Promise<Result<DirEntry[]>> => {
    return ok(await services.fs.listDir(path));
  });

  registrar.register(
    'fs:mkdir',
    async ({ path, recursive }, services): Promise<Result<FileInfo>> => {
      return ok(await services.fs.mkdir(path, recursive ?? false));
    },
  );

  registrar.register(
    'fs:rename',
    async ({ from, to }, services): Promise<Result<FileInfo>> => {
      return ok(await services.fs.rename(from, to));
    },
  );

  registrar.register('fs:delete', async ({ path, toTrash }, services): Promise<Result<void>> => {
    if (toTrash) {
      const { abs } = await services.fs.resolve(path);
      await services.trash(abs);
      return ok(undefined);
    }
    await services.fs.delete(path);
    return ok(undefined);
  });
}
