import type { FileInfo } from '@nexnote/shared';
import { firstH1, pagePathForTitle, sanitizePageTitle } from '../title-sync';

/**
 * 源码模式的文件读写协议（DEV-020）。
 *
 * renderer 永不直接触碰 Node fs：所有实现都由调用方注入既有 IPC 封装，
 * 这里只保留可单测的纯编排（版本检查 → H1 改名 → 逐字节写回）。
 */

/** 写入前版本检查用的文件版本（mtime + size 组合，避免同毫秒写入误判）。 */
export interface FileVersion {
  modifiedAt: string;
  size: number;
}

export interface PageFileIo {
  stat(path: string): Promise<FileInfo | null>;
  read(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  write(path: string, content: string): Promise<FileInfo>;
  renameLinked(from: string, to: string): Promise<void>;
}

export type SaveSourceResult =
  | {
      kind: 'saved';
      path: string;
      version: FileVersion | null;
      title: string | null;
      renamedFrom: string | null;
    }
  | { kind: 'conflict'; path: string; diskVersion: FileVersion | null };

export function fileVersionOf(info: FileInfo | null): FileVersion | null {
  return info ? { modifiedAt: info.modifiedAt, size: info.size } : null;
}

export function sameVersion(a: FileVersion | null, b: FileVersion | null): boolean {
  if (!a || !b) return false;
  return a.modifiedAt === b.modifiedAt && a.size === b.size;
}

/**
 * 逐字节写回源码文本。
 *
 * - 写入前做版本检查：磁盘版本与基线不一致时返回 conflict，不覆盖任何一方。
 * - 首个 H1 与文件名绑定：与块编辑模式同一套规则（renameLinked 连带更新双链）。
 * - 文本原样写盘，不经 TipTap 序列化规范化。
 */
export async function saveSourceText(params: {
  io: PageFileIo;
  path: string;
  text: string;
  baseVersion: FileVersion | null;
  /** 关闭后仅写盘不改名（例如 vault 设置 bindFileNameToTitle=false）。默认开启。 */
  bindTitle?: boolean;
}): Promise<SaveSourceResult> {
  const { io, path, text, baseVersion } = params;

  const current = fileVersionOf(await io.stat(path));
  if (baseVersion && current && !sameVersion(baseVersion, current)) {
    return { kind: 'conflict', path, diskVersion: current };
  }

  let targetPath = path;
  let title: string | null = null;
  let renamedFrom: string | null = null;

  const heading = params.bindTitle === false ? null : firstH1(text);
  if (heading) {
    const desiredTitle = sanitizePageTitle(heading);
    const desiredPath = pagePathForTitle(path, desiredTitle);
    // 仅大小写不同视为同一文件：大小写不敏感的文件系统上改名会与自身「碰撞」。
    if (desiredPath.toLowerCase() !== path.toLowerCase()) {
      if (await io.exists(desiredPath)) throw new Error(`无法重命名：${desiredPath} 已存在`);
      await io.renameLinked(path, desiredPath);
      targetPath = desiredPath;
      title = desiredTitle;
      renamedFrom = path;
    }
  }

  const written = await io.write(targetPath, text);
  return { kind: 'saved', path: targetPath, version: fileVersionOf(written), title, renamedFrom };
}

export type ExternalChange =
  | { kind: 'unchanged' }
  | { kind: 'reload'; version: FileVersion }
  | { kind: 'conflict'; version: FileVersion };

/**
 * 外部文件变化分类：以写入前的版本检查为准，不只依赖延迟到达的 watcher 事件。
 * 有本地未保存源码时报告 conflict（暂停自动保存，由用户选择），否则可直接重载。
 */
export async function classifyExternalChange(params: {
  io: PageFileIo;
  path: string;
  baseVersion: FileVersion | null;
  /** 本地基线文本，用于区分自身写入与真实外部修改。 */
  baseText: string;
  dirty: boolean;
}): Promise<ExternalChange> {
  const current = fileVersionOf(await params.io.stat(params.path));
  if (!current) return { kind: 'unchanged' };
  if (sameVersion(params.baseVersion, current)) return { kind: 'unchanged' };
  try {
    if ((await params.io.read(params.path)) === params.baseText) return { kind: 'unchanged' };
  } catch {
    // 文件竞态时按版本差异继续保护 dirty 内容。
  }
  return params.dirty
    ? { kind: 'conflict', version: current }
    : { kind: 'reload', version: current };
}
