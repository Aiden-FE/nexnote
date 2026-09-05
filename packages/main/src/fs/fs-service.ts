import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { DirEntry, FileInfo } from '@nexnote/shared';

export class FsError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'FsError';
  }
}

async function realpathOrNull(target: string): Promise<string | null> {
  try {
    return await fsp.realpath(target);
  } catch {
    return null;
  }
}

/**
 * vault 沙箱文件服务：所有渲染层文件操作都必须经此校验。
 * - path 一律是相对 vault 根的相对路径
 * - 拒绝绝对路径、.. 逃逸、符号链接逃逸（realpath 校验）
 * - 未打开 vault 时全部拒绝
 */
export class VaultFsService {
  constructor(private readonly getVaultRoot: () => string | null) {}

  private async requireRoot(): Promise<string> {
    const root = this.getVaultRoot();
    if (!root) throw new FsError('尚未打开任何 vault', 'NO_VAULT');
    return root;
  }

  /** 解析相对路径为绝对路径并做沙箱校验。 */
  async resolve(relPath: string): Promise<{ root: string; abs: string }> {
    const root = await this.requireRoot();
    if (typeof relPath !== 'string') {
      throw new FsError('路径必须是字符串', 'INVALID_PATH');
    }
    const normalized = relPath.trim();
    if (normalized.length === 0) return { root, abs: root };
    if (path.isAbsolute(normalized)) {
      throw new FsError(`不允许绝对路径: ${normalized}`, 'ABSOLUTE_PATH');
    }
    if (/^[a-zA-Z]:[\\/]/.test(normalized)) {
      throw new FsError(`不允许绝对路径: ${normalized}`, 'ABSOLUTE_PATH');
    }
    const abs = path.resolve(root, normalized);
    const relFromRoot = path.relative(root, abs);
    if (relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) {
      throw new FsError(`路径越出 vault 范围: ${normalized}`, 'OUTSIDE_VAULT');
    }
    // 符号链接逃逸：目标存在则校验 realpath，不存在则校验其父目录 realpath。
    // 注意 root 自身也需 realpath 规范化（如 macOS /var → /private/var）。
    const rootReal = (await realpathOrNull(root)) ?? root;
    const targetReal = await realpathOrNull(abs);
    const probe = targetReal ?? (await realpathOrNull(path.dirname(abs)));
    if (probe && !probe.startsWith(`${rootReal}${path.sep}`) && probe !== rootReal) {
      throw new FsError(`路径解析后越出 vault 范围: ${normalized}`, 'OUTSIDE_VAULT');
    }
    return { root, abs };
  }

  async stat(relPath: string): Promise<FileInfo | null> {
    const { abs } = await this.resolve(relPath);
    try {
      const st = await fsp.stat(abs);
      return toFileInfo(relPath, st);
    } catch {
      return null;
    }
  }

  async exists(relPath: string): Promise<boolean> {
    return (await this.stat(relPath)) !== null;
  }

  async readTextFile(relPath: string): Promise<string> {
    const { abs } = await this.resolve(relPath);
    try {
      return await fsp.readFile(abs, 'utf8');
    } catch (e) {
      throw new FsError(`读取失败: ${relPath}（${(e as Error).message}）`, 'READ_FAILED');
    }
  }

  async writeTextFile(
    relPath: string,
    content: string,
    createParentDirs = true,
  ): Promise<FileInfo> {
    const { abs } = await this.resolve(relPath);
    const dir = path.dirname(abs);
    if (createParentDirs) await fsp.mkdir(dir, { recursive: true });
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    await fsp.writeFile(tmp, content, 'utf8');
    await fsp.rename(tmp, abs);
    const st = await fsp.stat(abs);
    return toFileInfo(relPath, st);
  }

  async listDir(relPath: string): Promise<DirEntry[]> {
    const { abs } = await this.resolve(relPath);
    let dirents;
    try {
      dirents = await fsp.readdir(abs, { withFileTypes: true });
    } catch (e) {
      throw new FsError(`读取目录失败: ${relPath}（${(e as Error).message}）`, 'READ_DIR_FAILED');
    }
    return dirents
      .map((d) => ({
        name: d.name,
        path: relPath.trim().length === 0 ? d.name : `${relPath}/${d.name}`,
        kind: d.isDirectory() ? ('directory' as const) : ('file' as const),
      }))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  async mkdir(relPath: string, recursive = false): Promise<FileInfo> {
    const { abs } = await this.resolve(relPath);
    try {
      await fsp.mkdir(abs, { recursive });
    } catch (e) {
      throw new FsError(`创建目录失败: ${relPath}（${(e as Error).message}）`, 'MKDIR_FAILED');
    }
    const st = await fsp.stat(abs);
    return toFileInfo(relPath, st);
  }

  async rename(fromRel: string, toRel: string): Promise<FileInfo> {
    const from = await this.resolve(fromRel);
    const to = await this.resolve(toRel);
    try {
      await fsp.mkdir(path.dirname(to.abs), { recursive: true });
      await fsp.rename(from.abs, to.abs);
    } catch (e) {
      throw new FsError(`重命名失败: ${fromRel} → ${toRel}（${(e as Error).message}）`, 'RENAME_FAILED');
    }
    const st = await fsp.stat(to.abs);
    return toFileInfo(toRel, st);
  }

  /** 直接删除（回收站逻辑由 IPC handler 层经 shell.trashItem 处理）。 */
  async delete(relPath: string): Promise<void> {
    const { abs } = await this.resolve(relPath);
    try {
      await fsp.rm(abs, { recursive: true, force: true });
    } catch (e) {
      throw new FsError(`删除失败: ${relPath}（${(e as Error).message}）`, 'DELETE_FAILED');
    }
  }
}

function toFileInfo(relPath: string, st: { isDirectory(): boolean; size: number; mtimeMs: number }): FileInfo {
  return {
    path: relPath,
    name: path.basename(relPath),
    kind: st.isDirectory() ? 'directory' : 'file',
    size: st.size,
    modifiedAt: new Date(st.mtimeMs).toISOString(),
  };
}
