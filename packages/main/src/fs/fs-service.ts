import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { DirEntry, FileInfo } from '@nexnote/shared';
import { isDocumentPath } from '../document/document-domain';

export class FsError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'FsError';
  }
}

/** vault 内始终不出现在树/扫描/链接更新中的目录名。 */
export const EXCLUDED_DIRS = new Set(['.nexnote', '.git', '.trash', 'node_modules']);

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

  private assertNotVaultRoot(relPath: string): void {
    if (relPath.trim().length === 0 || relPath.trim() === '.') {
      throw new FsError('不允许对 vault 根目录执行此操作', 'VAULT_ROOT_OPERATION');
    }
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

  /**
   * 原子创建文本文件（create-if-absent）：目标已存在时不覆盖并报告 created:false。
   * 使用 open 的排他创建（wx）保证无 exists+write 的 TOCTOU 窗口；父目录需先存在。
   */
  async createTextFile(
    relPath: string,
    content: string,
    createParentDirs = true,
  ): Promise<{ file: FileInfo | null; created: boolean }> {
    const { abs } = await this.resolve(relPath);
    const dir = path.dirname(abs);
    if (createParentDirs) await fsp.mkdir(dir, { recursive: true });
    let handle;
    try {
      handle = await fsp.open(abs, 'wx', 0o666);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'EEXIST') return { file: await this.stat(relPath), created: false };
      throw new FsError(`创建文件失败: ${relPath}（${(e as Error).message}）`, 'CREATE_FAILED');
    }
    try {
      await handle.writeFile(content, 'utf8');
    } finally {
      await handle.close();
    }
    return { file: await this.stat(relPath), created: true };
  }

  /**
   * 导入二进制文件（图片/附件）。
   * - 安全校验与碰撞处理：parentDir 内不存在的 basename 优先；存在则追加序号避免覆盖。
   * - overwrite=true 时允许原子覆盖（tmp 写入后 rename）。
   * - 返回实际写入的 vault 相对路径。
   */
  async importBinaryFile(
    relPath: string,
    data: Buffer,
    opts: { createParentDirs?: boolean; overwrite?: boolean } = {},
  ): Promise<string> {
    await this.resolve(relPath); // 校验路径属于 vault（越权抛错）
    const dir = path.dirname(relPath);
    const ext = path.extname(relPath);
    const stemBase = path.basename(relPath, ext);

    const tryWrite = async (target: string): Promise<string> => {
      const { abs } = await this.resolve(target);
      await fsp.mkdir(path.dirname(abs), { recursive: opts.createParentDirs !== false });
      try {
        const handle = await fsp.open(abs, 'wx', 0o666);
        try {
          await handle.writeFile(data);
        } finally {
          await handle.close();
        }
        return target;
      } catch (e) {
        if ((e as { code?: string }).code === 'EEXIST') return '';
        throw new FsError(`导入文件失败: ${target}（${(e as Error).message}）`, 'IMPORT_FAILED');
      }
    };

    if (opts.overwrite) {
      const { abs } = await this.resolve(relPath);
      await fsp.mkdir(path.dirname(abs), { recursive: opts.createParentDirs !== false });
      const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
      await fsp.writeFile(tmp, data);
      try {
        await fsp.rename(tmp, abs);
      } catch (e) {
        try {
          await fsp.rm(tmp, { force: true });
        } catch {
          /* 清理临时文件失败可忽略 */
        }
        throw new FsError(`导入文件失败: ${relPath}（${(e as Error).message}）`, 'IMPORT_FAILED');
      }
      return relPath;
    }

    // creates = first : overwrite denied
    let target = relPath;
    if (await this.exists(target)) {
      if (!opts.createParentDirs) throw new FsError(`目标已存在: ${relPath}`, 'TARGET_EXISTS');
      // 碰撞去抖：`name.ext`、`name 2.ext`、`name 3.ext`…
      let seq = 2;
      for (;;) {
        target = dir ? `${dir}/${stemBase} ${seq}${ext}` : `${stemBase} ${seq}${ext}`;
        if (!(await this.exists(target))) break;
        seq += 1;
      }
    }
    const done = await tryWrite(target);
    if (done) return done;
    // 极端并发窗口：目标被并发占用，继续去重
    for (let seq = 2; seq < 10_000; seq++) {
      const candidate = dir ? `${dir}/${stemBase} ${seq}${ext}` : `${stemBase} ${seq}${ext}`;
      const ok = await tryWrite(candidate);
      if (ok) return ok;
    }
    throw new FsError(`无法为 ${path.basename(relPath)} 分配可用文件名`, 'IMPORT_FAILED');
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
    if (from.abs === to.abs) {
      throw new FsError('源路径与目标路径相同', 'SAME_PATH');
    }
    if (!(await fsp.stat(from.abs).catch(() => null))) {
      throw new FsError(`源路径不存在: ${fromRel}`, 'NOT_FOUND');
    }
    if (await fsp.stat(to.abs).catch(() => null)) {
      // POSIX rename 会静默覆盖同名文件，这里必须拒绝以免丢数据
      throw new FsError(`目标已存在: ${toRel}`, 'TARGET_EXISTS');
    }
    try {
      await fsp.mkdir(path.dirname(to.abs), { recursive: true });
      await fsp.rename(from.abs, to.abs);
    } catch (e) {
      throw new FsError(
        `重命名失败: ${fromRel} → ${toRel}（${(e as Error).message}）`,
        'RENAME_FAILED',
      );
    }
    const st = await fsp.stat(to.abs);
    return toFileInfo(toRel, st);
  }

  /**
   * 全量列出 vault 树（DEV-003 页面树初始加载）。
   * 始终排除 .nexnote/、.git/、.trash/；showAllFiles=false 时非 .md 文件也不返回。
   * 返回扁平列表（含目录自身），顺序稳定（目录先、同层按名称）。
   */
  async listTree(showAllFiles = false): Promise<DirEntry[]> {
    const root = await this.requireRoot();
    const out: DirEntry[] = [];
    const walk = async (relDir: string): Promise<void> => {
      const absDir = relDir === '' ? root : path.join(root, relDir);
      let dirents;
      try {
        dirents = await fsp.readdir(absDir, { withFileTypes: true });
      } catch {
        return;
      }
      dirents.sort((a, b) => a.name.localeCompare(b.name));
      for (const d of dirents) {
        if (EXCLUDED_DIRS.has(d.name)) continue;
        const rel = relDir === '' ? d.name : `${relDir}/${d.name}`;
        if (d.isDirectory()) {
          out.push({ name: d.name, path: rel, kind: 'directory' });
          await walk(rel);
        } else if (d.isFile()) {
          // 默认视图只返回文档（.md/.markdown/.docx）；showAllFiles 时返回全部文件。
          if (!showAllFiles && !isDocumentPath(d.name)) continue;
          out.push({ name: d.name, path: rel, kind: 'file' });
        }
      }
    };
    await walk('');
    return out;
  }

  /** 直接删除（回收站逻辑由 IPC handler 层经 shell.trashItem 处理）。 */
  async delete(relPath: string): Promise<void> {
    this.assertNotVaultRoot(relPath);
    const { abs } = await this.resolve(relPath);
    try {
      await fsp.rm(abs, { recursive: true, force: true });
    } catch (e) {
      throw new FsError(`删除失败: ${relPath}（${(e as Error).message}）`, 'DELETE_FAILED');
    }
  }
}

function toFileInfo(
  relPath: string,
  st: { isDirectory(): boolean; size: number; mtimeMs: number },
): FileInfo {
  return {
    path: relPath,
    name: path.basename(relPath),
    kind: st.isDirectory() ? 'directory' : 'file',
    size: st.size,
    modifiedAt: new Date(st.mtimeMs).toISOString(),
  };
}
