import { randomUUID } from 'node:crypto';
import {
  rewriteNormalLinkTargets,
  rewriteWikiTargets,
  sanitizeEntryName,
  type DirEntry,
  type FileInfo,
  type TagStat,
} from '@nexnote/shared';
import { FsError, type VaultFsService } from './fs-service';

/**
 * 页面操作内核（DEV-003）：
 * - 新建笔记（默认 frontmatter：created + id）
 * - 带全库 wikilink 更新的重命名/移动（简单字符串替换版，DEV-004 索引后升级精确替换）
 * - 标签扫描（frontmatter tags + 内联 #tag）
 *
 * 全部基于 VaultFsService 沙箱，路径均为 vault 相对路径。
 */

/** 生成新建笔记的默认 frontmatter（创建时间 + 稳定 id）。 */
export function defaultNoteFrontmatter(now = new Date()): string {
  return `---\ncreated: ${now.toISOString()}\nid: ${randomUUID()}\n---\n`;
}

/** 生成不冲突的笔记文件名（无后缀），如 未命名、未命名 2、未命名 3… */
export async function nextUntitledName(
  fs: VaultFsService,
  parentDir: string,
  base = '未命名',
): Promise<string> {
  const exists = async (name: string): Promise<boolean> => {
    const rel = parentDir === '' ? `${name}.md` : `${parentDir}/${name}.md`;
    return fs.exists(rel);
  };
  if (!(await exists(base))) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base} ${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new FsError('无法生成不冲突的笔记名', 'NAME_CONFLICT');
}

/**
 * 新建笔记：parentDir（'' = vault 根）下创建 name.md。
 * - name 缺省时自动生成「未命名 N」
 * - 自动补 .md 后缀；名称经 sanitizeEntryName 校验
 * - content 为正文（不含 frontmatter），默认追加在 frontmatter 之后
 */
export async function createNote(
  fs: VaultFsService,
  parentDir: string,
  name?: string,
  content = '',
): Promise<FileInfo> {
  let finalName = name;
  if (finalName === undefined || finalName.trim() === '') {
    finalName = await nextUntitledName(fs, parentDir);
  }
  // 允许用户输入带 .md 后缀；统一剥掉后按「名称」校验再补回
  const bare = finalName.trim().replace(/\.md$/i, '');
  const sanitized = sanitizeEntryName(bare);
  if (!sanitized.ok) {
    throw new FsError(sanitized.reason, 'INVALID_NAME');
  }
  const relPath = parentDir === '' ? `${sanitized.value}.md` : `${parentDir}/${sanitized.value}.md`;
  if (await fs.exists(relPath)) {
    throw new FsError(`已存在同名笔记: ${relPath}`, 'TARGET_EXISTS');
  }
  const body = defaultNoteFrontmatter() + (content.length > 0 ? `\n${content}\n` : '');
  return fs.writeTextFile(relPath, body, true);
}

// ── wikilink / Markdown 链接重写（委托 @nexnote/shared 的 code-aware 解析器） ──

/**
 * code-aware 普通 Markdown 链接重写（与索引器共用共享解析器）。
 * 按链接所在文件（sourcePath，vault 相对）目录解析真实目标，仅当目标命中被重命名/
 * 移动的路径时才改写，避免 basename 误伤其他目录、代码示例或资源链接。
 */
export function rewriteMarkdownLinks(
  content: string,
  fromStem: string,
  toStem: string,
  sourcePath = '',
): { content: string; changed: boolean } {
  return rewriteNormalLinkTargets(content, fromStem, toStem, sourcePath);
}

/** code-aware wikilink 重写（与索引器共用共享解析器，跳过代码段，保留 alias/anchor/embed）。 */
export function rewriteWikilinks(
  content: string,
  fromStem: string,
  toStem: string,
): { content: string; changed: boolean } {
  return rewriteWikiTargets(content, fromStem, toStem);
}

/** 收集 vault 内全部 .md 文件相对路径（排除 .nexnote/.git/.trash 等内部目录）。 */
export async function listMarkdownFiles(fs: VaultFsService): Promise<string[]> {
  const entries: DirEntry[] = await fs.listTree(true);
  return entries.filter((e) => e.kind === 'file' && e.name.toLowerCase().endsWith('.md')).map((e) => e.path);
}

/**
 * 重命名/移动 + 全库 wikilink 更新（页面树右键重命名与拖拽移动的统一入口）。
 * - from 是目录时拒绝移入自身子树（防止树成环/数据丢失）
 * - .md 文件重命名/移动、目录重命名/移动 均会更新全库引用
 * - 返回被更新内容的文件列表（供 UI 提示与测试断言）
 */
export async function renameWithLinks(
  fs: VaultFsService,
  fromRel: string,
  toRel: string,
): Promise<{ info: FileInfo; updatedFiles: string[] }> {
  const fromStat = await fs.stat(fromRel);
  if (!fromStat) throw new FsError(`源路径不存在: ${fromRel}`, 'NOT_FOUND');
  const isDir = fromStat.kind === 'directory';
  const normalizedFrom = fromRel.replace(/\/+$/, '');
  const normalizedTo = toRel.replace(/\/+$/, '');
  if (isDir && (normalizedTo === normalizedFrom || normalizedTo.startsWith(`${normalizedFrom}/`))) {
    throw new FsError('不能把文件夹移动到它自身或其子目录内', 'INVALID_MOVE');
  }

  const info = await fs.rename(normalizedFrom, normalizedTo);

  const fromMd = normalizedFrom.toLowerCase().endsWith('.md');
  const toMd = normalizedTo.toLowerCase().endsWith('.md');
  const updatedFiles: string[] = [];
  if ((fromMd && toMd) || isDir) {
    const fromStem = isDir ? normalizedFrom : normalizedFrom.replace(/\.md$/i, '');
    const toStem = isDir ? normalizedTo : normalizedTo.replace(/\.md$/i, '');
    for (const file of await listMarkdownFiles(fs)) {
      let text: string;
      try {
        text = await fs.readTextFile(file);
      } catch {
        continue; // 单文件读取失败不阻断整体重命名
      }
      const wiki = rewriteWikilinks(text, fromStem, toStem);
      const normal = rewriteMarkdownLinks(wiki.content, fromStem, toStem, file);
      if (wiki.changed || normal.changed) {
        const content = normal.content;
        await fs.writeTextFile(file, content, true);
        updatedFiles.push(file);
      }
    }
  }
  return { info, updatedFiles };
}

// ── 标签扫描 ─────────────────────────────────────────────────

/** 解析 frontmatter（--- 围栏）文本段中的 tags。支持列表与行内数组两种写法。 */
export function parseFrontmatterTags(frontmatter: string): string[] {
  const tags: string[] = [];
  const lines = frontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const m = /^(?:tags|tag):\s*(.*)$/.exec(line);
    if (!m) continue;
    const rest = m[1]!.trim();
    if (rest.length > 0) {
      // 行内数组：tags: [a, b] 或 tags: a（单个）
      const value = rest.startsWith('[') && rest.endsWith(']') ? rest.slice(1, -1) : rest;
      for (const raw of value.split(',')) {
        const tag = stripTagQuotes(raw.trim());
        if (tag.length > 0) tags.push(tag);
      }
    } else {
      // 块列表：随后缩进的 - 项
      for (let j = i + 1; j < lines.length; j += 1) {
        const item = /^\s+-\s+(.*)$/.exec(lines[j]!);
        if (!item) break;
        const tag = stripTagQuotes(item[1]!.trim());
        if (tag.length > 0) tags.push(tag);
        i = j;
      }
    }
  }
  return tags;
}

function stripTagQuotes(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

/** 从正文提取内联 #tag（跳过围栏代码块与行内代码；#^blockid 与 #heading 引用不算标签）。 */
export function extractInlineTags(body: string): string[] {
  const out = new Set<string>();
  let inFence = false;
  // 标签须以字母/下划线/中文开头（数字开头是色值/日期等误报），可含 数字/字母/_/-//
  const tagRe = /(^|[^\p{L}\p{N}_#/-])#([\p{L}_][\p{L}\p{N}_/-]*)/gu;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine;
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // 去掉行内代码段后再扫描，避免 `#fake` 被算作标签
    const cleaned = line.replace(/`[^`]*`/g, ' ');
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(cleaned)) !== null) {
      out.add(m[2]!);
    }
  }
  return [...out];
}

/** 分离 frontmatter 与正文；无 frontmatter 时返回 null 段。 */
export function splitFrontmatter(text: string): { frontmatter: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return { frontmatter: null, body: text };
  return { frontmatter: m[1]!, body: text.slice(m[0].length) };
}

/** Set a numeric scalar in YAML frontmatter, creating the fence when needed. Returns null when already current. */
export function setFrontmatterNumber(text: string, key: string, value: number): string | null {
  const line = `${key}: ${value}`;
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return `---\n${line}\n---\n\n${text}`;
  const fence = match[0];
  const existing = new RegExp(`^${key}:\\s*.*$`, 'm').exec(fence);
  if (existing?.[0] === line) return null;
  if (existing) {
    const updated = fence.slice(0, existing.index) + line + fence.slice((existing.index ?? 0) + existing[0].length);
    return text.slice(0, match.index) + updated + text.slice((match.index ?? 0) + fence.length);
  }
  const closing = fence.lastIndexOf('---');
  const updated = fence.slice(0, closing) + line + '\n' + fence.slice(closing);
  return text.slice(0, match.index) + updated + text.slice((match.index ?? 0) + fence.length);
}

/**
 * 扫描全库标签（DEV-003 基础版）：frontmatter tags + 内联 #tag 聚合。
 * DEV-004 关系索引完成后升级为索引驱动。
 */
export async function scanTags(fs: VaultFsService): Promise<TagStat[]> {
  const tagMap = new Map<string, Set<string>>();
  const add = (tag: string, file: string): void => {
    const key = tag.trim();
    if (key.length === 0) return;
    const set = tagMap.get(key) ?? new Set<string>();
    set.add(file);
    tagMap.set(key, set);
  };

  for (const file of await listMarkdownFiles(fs)) {
    let text: string;
    try {
      text = await fs.readTextFile(file);
    } catch {
      continue;
    }
    const { frontmatter, body } = splitFrontmatter(text);
    if (frontmatter !== null) {
      for (const tag of parseFrontmatterTags(frontmatter)) add(tag, file);
    }
    for (const tag of extractInlineTags(body)) add(tag, file);
  }

  return [...tagMap.entries()]
    .map(([tag, files]) => ({ tag, files: [...files].sort() }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}
