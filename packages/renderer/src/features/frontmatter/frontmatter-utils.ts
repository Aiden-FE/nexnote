import type { DirEntry } from '@nexnote/shared';
import {
  assertSafeFrontmatterKey,
  parseFrontmatterYaml,
  serializeFrontmatterYaml,
  splitFrontmatter,
  type FrontmatterData,
  type FrontmatterValue,
} from '@nexnote/kernel';

export interface FrontmatterDocument {
  data: FrontmatterData;
  body: string;
  source: string;
}

/**
 * Markdown 文档的字节精确拆装（DEV-025 源码模式属性面板）：
 * header + separator + body 逐字节还原原文，供「未编辑不重排 YAML」的保真语义使用。
 * 与 kernel splitFrontmatter 的区别：保留原始 header/separator 字节并兼容 CRLF 行尾。
 */
export interface FrontmatterParts {
  /** 完整原始头部（含 --- 分隔线，不含其后的换行），无 YAML 头时为 null */
  header: string | null;
  /** header 内的 YAML 源文本（不含分隔线）；无 YAML 头时为 null */
  yaml: string | null;
  /** 头部与正文之间的原文字节（`---` 后的换行与空行） */
  separator: string;
  body: string;
}

const FRONTMATTER_HEADER_RE = /^(---[ \t]*(?:\r?\n))([\s\S]*?)(\r?\n---)(?=\r?\n|$)/;

export function splitFrontmatterParts(markdown: string): FrontmatterParts {
  const match = FRONTMATTER_HEADER_RE.exec(markdown);
  if (!match) {
    return { header: null, yaml: null, separator: '', body: markdown };
  }
  const header = match[0];
  const rest = markdown.slice(header.length);
  // 分隔线之后的连续换行（含空行）全部计入 separator，正文从首个非换行字节开始
  const separatorMatch = /^(?:\r?\n)+/.exec(rest);
  const separator = separatorMatch ? separatorMatch[0] : '';
  return {
    header,
    yaml: match[2] ?? '',
    separator,
    body: rest.slice(separator.length),
  };
}

/** 检测文本主行尾：任一 CRLF 即按 CRLF 处理，否则 LF。 */
function detectEol(text: string): '\r\n' | '\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * 仅替换文档 YAML 头区域，其余字节（分隔线风格、头部与正文间空行、正文）原样保留。
 * - yaml 为空/空白：移除整个头部（正文原字节保留）
 * - 原文档无头部：在文件头生成 `---\nYAML\n---\n\n`，正文字节不变
 * - 行尾跟随原文档（CRLF 文档写回 CRLF）
 */
export function replaceFrontmatterYaml(markdown: string, yaml: string | null): string {
  const parts = splitFrontmatterParts(markdown);
  const normalized = (yaml ?? '').trim().length === 0 ? null : (yaml ?? '');
  if (normalized === null) {
    return parts.header === null ? markdown : parts.body;
  }
  const eol = detectEol(parts.header ?? parts.body);
  const yamlText = normalized.split(/\r?\n/).join(eol);
  if (parts.header === null) {
    const bodyEol = detectEol(parts.body);
    return `---${bodyEol}${yamlText}${bodyEol}---${bodyEol}${bodyEol}${parts.body}`;
  }
  const headerMatch = FRONTMATTER_HEADER_RE.exec(parts.header);
  if (!headerMatch) return markdown;
  const rebuilt = `${headerMatch[1] ?? ''}${yamlText}${headerMatch[3] ?? ''}`;
  return rebuilt + parts.separator + parts.body;
}

export interface FrontmatterInspection extends FrontmatterDocument {
  /** YAML 不可解析时为错误文本；此时 UI 必须锁定在源码模式，禁止结构化覆盖原文。 */
  parseError: string | null;
  locked: boolean;
}

export function inspectFrontmatter(markdown: string): FrontmatterInspection {
  const { yaml, body } = splitFrontmatter(markdown);
  if (yaml === null) return { data: {}, body, source: '', parseError: null, locked: false };
  try {
    return {
      data: parseFrontmatterYaml(yaml),
      body,
      source: yaml,
      parseError: null,
      locked: false,
    };
  } catch (error) {
    return {
      data: {},
      body,
      source: yaml,
      parseError: error instanceof Error ? error.message : String(error),
      locked: true,
    };
  }
}

export function readFrontmatter(markdown: string): FrontmatterDocument {
  const inspected = inspectFrontmatter(markdown);
  if (inspected.parseError) throw new Error(inspected.parseError);
  return { data: inspected.data, body: inspected.body, source: inspected.source };
}

export function writeFrontmatter(data: FrontmatterData, body: string): string {
  const yaml = serializeFrontmatterYaml(data);
  return yaml.length > 0 ? `---\n${yaml}\n---\n\n${body.replace(/^\n+/, '')}` : body;
}

export function setFrontmatterValue(
  data: FrontmatterData,
  key: string,
  value: FrontmatterValue,
): FrontmatterData {
  const normalized = assertSafeFrontmatterKey(key);
  return { ...data, [normalized]: value };
}

export function removeFrontmatterValue(data: FrontmatterData, key: string): FrontmatterData {
  const next = { ...data };
  delete next[key];
  return next;
}

export function renameFrontmatterKey(
  data: FrontmatterData,
  from: string,
  to: string,
): FrontmatterData {
  const key = assertSafeFrontmatterKey(to);
  if (from !== key && Object.prototype.hasOwnProperty.call(data, key)) {
    throw new Error(`字段 ${key} 已存在`);
  }
  const value = data[from];
  const next = { ...data };
  delete next[from];
  if (value !== undefined) next[key] = value;
  return next;
}

export interface PageStatistics {
  words: number;
  blocks: number;
  created: string;
  updated: string;
}

/**
 * 中西文混合字数：CJK 字符逐个计数；其余 Unicode 字母/数字连续段按一个西文词计数。
 * 标点、空白不计数。
 */
export function countMixedWords(text: string): number {
  const cjkPattern = /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/gu;
  const cjkCount = text.match(cjkPattern)?.length ?? 0;
  const nonCjk = text.replace(cjkPattern, ' ');
  const westernCount = nonCjk.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return cjkCount + westernCount;
}

/** 统计正文可见词数/块数；frontmatter 与 fenced code 不计入字数。 */
export function pageStatistics(markdown: string): PageStatistics {
  const { body } = splitFrontmatter(markdown);
  const plain = body.replace(/```[\s\S]*?```/g, ' ').replace(/[`*_~#[\]()>|!]/g, ' ');
  const words = countMixedWords(plain);
  const blocks = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean).length;
  const inspected = inspectFrontmatter(markdown);
  const data = inspected.parseError ? {} : inspected.data;
  const created =
    data.created instanceof Date
      ? data.created.toISOString()
      : typeof data.created === 'string'
        ? data.created
        : '—';
  const updated =
    data.updated instanceof Date
      ? data.updated.toISOString()
      : typeof data.updated === 'string'
        ? data.updated
        : '—';
  return { words, blocks, created, updated };
}

export type YamlTokenKind = 'plain' | 'key' | 'punctuation' | 'comment' | 'string' | 'atom';
export interface YamlToken {
  text: string;
  kind: YamlTokenKind;
}

function valueTokenKind(value: string): YamlTokenKind {
  const trimmed = value.trim();
  if (/^(true|false|null|~|-?\d+(\.\d+)?)$/i.test(trimmed)) return 'atom';
  if (/^("[\s\S]*"|'[\s\S]*')$/.test(trimmed)) return 'string';
  return 'plain';
}

/** 轻量 YAML 高亮 tokenizer：识别 key/value/comment/list punctuation。 */
export function tokenizeYaml(source: string): YamlToken[][] {
  return source.split('\n').map((line) => {
    const commentOnly = /^(\s*)(#.*)$/.exec(line);
    if (commentOnly) {
      return [
        { text: commentOnly[1] ?? '', kind: 'plain' },
        { text: commentOnly[2] ?? '', kind: 'comment' },
      ];
    }
    const field = /^(\s*)(-\s+)?([^:#][^:]*?)(:)(\s*)(.*)$/.exec(line);
    if (!field) {
      const list = /^(\s*)(-)(\s+)(.*)$/.exec(line);
      if (!list) return [{ text: line, kind: 'plain' }];
      const value = list[4] ?? '';
      return [
        { text: list[1] ?? '', kind: 'plain' },
        { text: list[2] ?? '-', kind: 'punctuation' },
        { text: list[3] ?? ' ', kind: 'plain' },
        { text: value, kind: valueTokenKind(value) },
      ];
    }
    const value = field[6] ?? '';
    return [
      { text: field[1] ?? '', kind: 'plain' },
      ...(field[2] ? [{ text: field[2], kind: 'punctuation' as const }] : []),
      { text: field[3] ?? '', kind: 'key' },
      { text: field[4] ?? ':', kind: 'punctuation' },
      { text: field[5] ?? '', kind: 'plain' },
      { text: value, kind: valueTokenKind(value) },
    ];
  });
}

export interface CollectVaultTagsDeps {
  listDir(path: string): Promise<DirEntry[]>;
  readTextFile(path: string): Promise<string>;
}

/** 递归聚合 vault 内全部 Markdown 文件的 frontmatter tags。 */
export async function collectVaultTags(deps: CollectVaultTagsDeps): Promise<string[]> {
  const tags = new Set<string>();
  const queue = [''];
  const hidden = new Set(['.git', '.nexnote', '.trash', 'node_modules']);

  while (queue.length > 0) {
    const dir = queue.shift() ?? '';
    const entries = await deps.listDir(dir);
    for (const entry of entries) {
      if (entry.kind === 'directory') {
        if (!hidden.has(entry.name)) queue.push(entry.path);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith('.md')) continue;
      try {
        const inspected = inspectFrontmatter(await deps.readTextFile(entry.path));
        if (inspected.parseError) continue;
        const values = inspected.data.tags;
        if (Array.isArray(values)) values.forEach((tag) => tags.add(String(tag)));
        else if (typeof values === 'string' && values.trim()) tags.add(values.trim());
      } catch {
        // 单文件读失败不阻塞其余目录。
      }
    }
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}
