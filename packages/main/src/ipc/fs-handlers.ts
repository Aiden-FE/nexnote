import { err, ok, type Result } from '@nexnote/shared';
import type { DirEntry, FileInfo, RenameLinkedResult, TagStat } from '@nexnote/shared';
import * as pathLib from 'node:path';
import type { IpcRegistrar } from './registrar';
import { createNote, renameWithLinks, scanTags } from '../fs/page-ops';

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
    if (path.trim().length === 0 || path.trim() === '.') {
      return err('不允许删除 vault 根目录', 'VAULT_ROOT_OPERATION');
    }
    if (toTrash) {
      const { abs } = await services.fs.resolve(path);
      try {
        await services.trash(abs);
      } catch {
        // 系统回收站不可用（如部分 Linux 环境）：回退移入 vault 内 .trash/ 目录
        const name = pathLib.basename(abs);
        const ts = Date.now();
        const ext = pathLib.extname(name);
        const stem = ext.length > 0 ? name.slice(0, -ext.length) : name;
        let target = `.trash/${name}`;
        if (await services.fs.exists(target)) target = `.trash/${stem}-${ts}${ext}`;
        await services.fs.mkdir('.trash', true);
        await services.fs.rename(path, target);
      }
      return ok(undefined);
    }
    await services.fs.delete(path);
    return ok(undefined);
  });

  registrar.register(
    'fs:createNote',
    async ({ parentDir, name, content }, services): Promise<Result<FileInfo>> => {
      return ok(await createNote(services.fs, parentDir, name, content));
    },
  );

  registrar.register(
    'fs:listTree',
    async ({ showAllFiles }, services): Promise<Result<DirEntry[]>> => {
      return ok(await services.fs.listTree(showAllFiles ?? false));
    },
  );

  registrar.register(
    'fs:renameLinked',
    async ({ from, to }, services): Promise<Result<RenameLinkedResult>> => {
      return ok(await renameWithLinks(services.fs, from, to));
    },
  );

  registrar.register(
    'fs:revealInFinder',
    async ({ path }, services): Promise<Result<void>> => {
      const { abs } = await services.fs.resolve(path);
      await services.revealItem(abs);
      return ok(undefined);
    },
  );

  registrar.register('fs:scanTags', async (_payload, services): Promise<Result<TagStat[]>> => {
    return ok(await scanTags(services.fs));
  });
}
