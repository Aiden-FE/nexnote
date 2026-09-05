import type { Result } from '../result';

/**
 * 文件系统能力（主进程侧实现，渲染层仅可经 IPC 调用）。
 * 所有 path 都是相对当前 vault 根目录的相对路径，主进程做沙箱校验，
 * 任何越界访问（绝对路径、.. 逃逸、符号链接逃逸）都会被拒绝。
 * git:* 之外的底层文件操作统一走本命名空间，后续票（编辑器保存、页面树）复用。
 */
export interface FileInfo {
  /** 相对 vault 根的路径 */
  path: string;
  name: string;
  kind: 'file' | 'directory';
  size: number;
  /** ISO-8601 时间戳 */
  modifiedAt: string;
}

export interface DirEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
}

export const FS_CHANNELS = [
  'fs:readTextFile',
  'fs:writeTextFile',
  'fs:exists',
  'fs:stat',
  'fs:listDir',
  'fs:mkdir',
  'fs:rename',
  'fs:delete',
] as const;

export type FsChannel = (typeof FS_CHANNELS)[number];

export interface FsChannelMap {
  'fs:readTextFile': { request: { path: string }; response: Result<string> };
  'fs:writeTextFile': {
    request: { path: string; content: string; createParentDirs?: boolean };
    response: Result<FileInfo>;
  };
  'fs:exists': { request: { path: string }; response: Result<boolean> };
  'fs:stat': { request: { path: string }; response: Result<FileInfo | null> };
  'fs:listDir': { request: { path: string }; response: Result<DirEntry[]> };
  'fs:mkdir': { request: { path: string; recursive?: boolean }; response: Result<FileInfo> };
  'fs:rename': { request: { from: string; to: string }; response: Result<FileInfo> };
  /**
   * 删除文件/目录。toTrash=true 走系统回收站（shell.trashItem，DEV-003 页面树使用），
   * 默认 false 直接删除。
   */
  'fs:delete': { request: { path: string; toTrash?: boolean }; response: Result<void> };
}
