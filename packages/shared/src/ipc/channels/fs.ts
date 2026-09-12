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

export type DocumentFormat = 'native-block' | 'markdown';

export interface DirEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  /** Markdown sidecar format; absent means legacy native-block. */
  format?: DocumentFormat;
}

/** 标签聚合条目（fs:scanTags 返回，DEV-003 简单扫描版）。 */
export interface TagStat {
  tag: string;
  /** 含该标签的页面（vault 相对路径，不含扩展名也含——保持原样含 .md） */
  files: string[];
}

/** 带链接更新的重命名结果。 */
export interface RenameLinkedResult {
  info: FileInfo;
  /** 内容被更新过 wikilink 的 .md 文件（vault 相对路径） */
  updatedFiles: string[];
}

/**
 * 校验 vault 内文件/文件夹条目名称（新建笔记/文件夹、重命名输入共用）。
 * 返回 ok:false 时 reason 可直接展示给用户。
 */
export function sanitizeEntryName(
  raw: string,
): { ok: true; value: string } | { ok: false; reason: string } {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, reason: '名称不能为空' };
  if (value.length > 128) return { ok: false, reason: '名称过长（≤128 字符）' };
  if (value === '.' || value === '..') return { ok: false, reason: '非法名称' };
  if (value.startsWith('.')) return { ok: false, reason: '名称不能以 . 开头' };
  // 文件名中的控制字符一律拒绝（eslint no-control-regex 对此合法用途放行）
  // eslint-disable-next-line no-control-regex
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(value)) {
    return { ok: false, reason: '名称包含非法字符 / \\ : * ? " < > |' };
  }
  return { ok: true, value };
}

export const FS_CHANNELS = [
  'fs:readTextFile',
  'fs:writeTextFile',
  'fs:createTextFile',
  'fs:importBinaryFile',
  'fs:exists',
  'fs:stat',
  'fs:listDir',
  'fs:mkdir',
  'fs:rename',
  'fs:delete',
  'fs:createNote',
  'document:getMetadata',
  'fs:listTree',
  'fs:renameLinked',
  'fs:revealInFinder',
  'fs:scanTags',
] as const;

export type FsChannel = (typeof FS_CHANNELS)[number];

export interface FsChannelMap {
  'fs:readTextFile': { request: { path: string }; response: Result<string> };
  'fs:writeTextFile': {
    request: { path: string; content: string; createParentDirs?: boolean };
    response: Result<FileInfo>;
  };
  /**
   * 原子创建文本文件（DEV-017 红链页面等 create-if-absent 语义）：
   * 仅在目标不存在时创建；目标已存在视为成功但不覆盖。安全校验同 writeTextFile。
   */
  'fs:createTextFile': {
    request: { path: string; content: string; createParentDirs?: boolean };
    response: Result<{ file: FileInfo | null; created: boolean }>;
  };
  /**
   * 导入二进制文件（DEV-017 图片/附件持久化）：
   * - data: base64（非空）编码的文件内容；renderer 永不直接触碰 node fs
   * - path: vault 内相对目标路径（附件目录下，主进程还执行碰撞/去抖处理）
   * - createParentDirs / overwrite 语义与原子性由 main fs 服务保证
   */
  'fs:importBinaryFile': {
    request: {
      path: string;
      /** base64 编码的字节内容（经 shared 契约校验字符串） */
      data: string;
      /** 建议文件名（可改动，供去重碰撞时改名保留扩展名） */
      suggestionName?: string;
      mime?: string;
      createParentDirs?: boolean;
      overwrite?: boolean;
    };
    response: Result<{ path: string }>;
  };
  'fs:exists': { request: { path: string }; response: Result<boolean> };
  'fs:stat': { request: { path: string }; response: Result<FileInfo | null> };
  'fs:listDir': { request: { path: string }; response: Result<DirEntry[]> };
  'fs:mkdir': { request: { path: string; recursive?: boolean }; response: Result<FileInfo> };
  'fs:rename': { request: { from: string; to: string }; response: Result<FileInfo> };
  /**
   * 删除文件/目录。toTrash=true 走系统回收站（shell.trashItem，DEV-003 页面树使用），
   * 默认 false 直接删除。回收站不可用时主进程回退移动到 vault 内 .trash/ 目录。
   */
  'fs:delete': { request: { path: string; toTrash?: boolean }; response: Result<void> };
  /**
   * 新建笔记（DEV-003）：parentDir 为 vault 相对目录（'' = 根），name 不带 .md 时自动补全。
   * format 持久化到 sidecar（native-block/markdown），正文不注入产品 metadata。
   */
  'fs:createNote': {
    request: {
      parentDir: string;
      name?: string;
      content?: string;
      format?: 'native-block' | 'markdown';
    };
    response: Result<FileInfo>;
  };
  /** 读取文档 sidecar metadata（.nexnote/metadata）；无 sidecar 时返回 null。 */
  'document:getMetadata': {
    request: { path: string };
    response: Result<Record<string, unknown> | null>;
  };
  /**
   * 全量列出 vault 树（DEV-003 页面树初始加载）。排除 .nexnote/、.git/、.trash/。
   * showAllFiles=false 时只返回目录与 .md 文件（非 .md 默认隐藏）。
   * .md 条目附带 sidecar 持久格式（format；legacy 无 sidecar 时缺省 → native-block 兼容）。
   */
  'fs:listTree': {
    request: { showAllFiles?: boolean };
    response: Result<DirEntry[]>;
  };
  /**
   * 重命名/移动（DEV-003）：拖拽移动与重命名统一走这里。
   * 除移动文件外，还对 vault 内全部 .md 做 wikilink 简单字符串替换
   * （[[旧名]] → [[新名]]，路径前缀形式同样处理；DEV-004 索引后再做精确替换）。
   */
  'fs:renameLinked': {
    request: { from: string; to: string };
    response: Result<RenameLinkedResult>;
  };
  /** 在系统文件管理器（Finder/资源管理器）中显示该文件。 */
  'fs:revealInFinder': { request: { path: string }; response: Result<void> };
  /**
   * 扫描全库标签（DEV-003 基础版）：frontmatter tags + 内联 #tag，聚合返回。
   * DEV-004 关系索引完成后升级为索引驱动。
   */
  'fs:scanTags': { request: void; response: Result<TagStat[]> };
}
