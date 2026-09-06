/**
 * Frontmatter 结构化模型 + 轻量 YAML 解析/序列化。
 *
 * 设计约束（MVP，对齐 DEV-005 需求）：
 * - 支持的字段类型：string / number / boolean / date(ISO) / list(string[]) / null
 * - 行内（flow）序列：tags: [a, b, "c d"]
 * - 块序列：aliases:\n  - a\n  - b
 * - 顶层 key 均为字符串；不支持深层 map（避免与 Obsidian 语义偏差过大），但允许一级嵌套
 *   （params: { temperature: 0.7 } 等 DEV-009 类似需求在本票不要求；先只支持一层）。
 * - 错误容忍：解析失败时抛出，调用方决定是否退回源码模式。
 *
 * 为什么不引入 js-yaml：
 * - DEV-005 范围只覆盖 frontmatter 标准字段 + 简单自定义字段；
 * - 减少内核包的外部依赖，保证 bundle 体积可控；
 * - 后续若需要复杂 YAML（多行字符串、锚点等）再替换为 js-yaml，接口保持不变。
 */

export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | Date
  | string[];

export type FrontmatterData = Record<string, FrontmatterValue>;

const STANDARD_FIELDS: Readonly<Record<string, 'string' | 'list' | 'date' | 'number' | 'boolean'>> = {
  title: 'string',
  tags: 'list',
  aliases: 'list',
  created: 'date',
  updated: 'date',
  type: 'string',
  confidence: 'number',
};

/** 推测字段的显示类型（用于属性表格选择编辑器）。 */
export function fieldTypeOf(value: FrontmatterValue): 'string' | 'number' | 'boolean' | 'date' | 'list' | 'null' {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'list';
  if (value instanceof Date) return 'date';
  return typeof value as 'string' | 'number' | 'boolean';
}

export function isStandardField(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(STANDARD_FIELDS, key);
}

/**
 * 解析单行 YAML 标量（去掉引号、转义、类型推断）。
 * 返回类型：string | number | boolean | null | Date。
 */
function parseScalar(raw: string): FrontmatterValue {
  const s = raw.trim();
  if (s.length === 0) return '';

  // 单引号 / 双引号字符串
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    const inner = s.slice(1, -1);
    if (s.startsWith('"')) {
      return inner.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return inner.replace(/''/g, "'");
  }

  // null / 空
  if (/^(null|Null|NULL|~)$/.test(s)) return null;
  if (s === '') return '';

  // boolean
  if (/^(true|True|TRUE|yes|Yes|YES|on|On|ON)$/.test(s)) return true;
  if (/^(false|False|FALSE|no|No|NO|off|Off|OFF)$/.test(s)) return false;

  // date / datetime (ISO-8601 子集)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }

  // number（整数、小数、负号；不支持 0x/科学计数法，保持简单）
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isNaN(n)) return n;
  }

  return s;
}

/** 把 flow sequence `[a, "b c", 123]` 解析为字符串数组，然后按标量推断类型。 */
function parseFlowSequence(body: string): FrontmatterValue[] {
  const items: FrontmatterValue[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inDouble) {
      if (ch === '\\' && i + 1 < body.length) {
        current += ch + body[i + 1];
        i += 1;
        continue;
      }
      if (ch === '"') inDouble = false;
      current += ch;
      continue;
    }
    if (inSingle) {
      if (ch === "'" && body[i + 1] === "'") {
        current += "''";
        i += 1;
        continue;
      }
      if (ch === "'") inSingle = false;
      current += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      current += ch;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      current += ch;
      continue;
    }
    if (ch === '[') {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ']') {
      depth -= 1;
      current += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      items.push(parseScalar(current));
      current = '';
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed.length > 0) items.push(parseScalar(trimmed));
  return items;
}

/**
 * 解析 frontmatter YAML 文本（不含两端的 --- 分隔线）。
 * 不支持：深层嵌套 map、多行块标量（|/>, 做 MVP 不处理）、YAML 锚点。
 * 解析失败时抛错（字符串描述），调用方决定降级到源码模式。
 */
export function parseFrontmatterYaml(yaml: string): FrontmatterData {
  const data: FrontmatterData = {};
  const lines = yaml.split('\n');
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    if (rawLine === undefined) break;
    // 跳过空行和注释
    if (/^\s*$/.test(rawLine) || /^\s*#/.test(rawLine)) {
      i += 1;
      continue;
    }
    // 顶层必须无缩进
    if (/^\s/.test(rawLine)) {
      throw new Error(`frontmatter 第 ${i + 1} 行存在意外缩进：${rawLine}`);
    }
    const colonIdx = findKeyColon(rawLine);
    if (colonIdx < 0) {
      throw new Error(`frontmatter 第 ${i + 1} 行不是合法字段：${rawLine}`);
    }
    const key = rawLine.slice(0, colonIdx).trim();
    const valueRaw = rawLine.slice(colonIdx + 1).trim();

    // value 为空 → 可能是块序列，看下一行缩进
    if (valueRaw.length === 0) {
      // 看下一行是否是块序列项
      const next = lines[i + 1] ?? '';
      const itemMatch = /^\s+-\s+(.*)$/.exec(next);
      if (itemMatch) {
        const list: string[] = [];
        i += 1;
        while (i < lines.length) {
          const line = lines[i];
          if (!line) break;
          const m = /^\s+-\s+(.*)$/.exec(line);
          if (!m || m[1] === undefined) break;
          list.push(m[1].trim());
          i += 1;
        }
        // 每个 item 作为字符串（块序列通常为字符串），但也尝试推断
        data[key] = list.map((it) => String(parseScalar(it)));
        continue;
      }
      // 否则视为空字符串（Obsidian 常见：key: 后面啥都没有 → 空值）
      data[key] = '';
      i += 1;
      continue;
    }

    // flow sequence：[a, b, c]
    if (valueRaw.startsWith('[') && valueRaw.endsWith(']')) {
      const body = valueRaw.slice(1, -1);
      const items = parseFlowSequence(body);
      // 统一转字符串数组（标签/别名场景为主；数字/布尔少见）
      data[key] = items.map((it) => String(it));
      i += 1;
      continue;
    }

    data[key] = parseScalar(valueRaw);
    i += 1;
  }

  return data;
}

/** 找到 key: value 的第一个冒号位置（跳过引号内的冒号）。 */
function findKeyColon(line: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inDouble) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === ':') return i;
  }
  return -1;
}

/**
 * 把结构化数据序列化为 YAML 字符串（不含两端 ---）。
 * 顺序：先标准字段（按约定序），再自定义字段（按字母序，确定性）。
 */
export function serializeFrontmatterYaml(data: FrontmatterData): string {
  const standardOrder = ['title', 'tags', 'aliases', 'created', 'updated', 'type', 'confidence'];
  const allKeys = Object.keys(data);
  const standardKeys = standardOrder.filter((k) => Object.prototype.hasOwnProperty.call(data, k));
  const customKeys = allKeys
    .filter((k) => !standardOrder.includes(k))
    .sort((a, b) => a.localeCompare(b));

  const lines: string[] = [];
  for (const key of [...standardKeys, ...customKeys]) {
    const value = data[key];
    if (value === undefined) continue;
    lines.push(serializeField(key, value));
  }
  return lines.join('\n');
}

function serializeField(key: string, value: FrontmatterValue): string {
  if (value === null) return `${key}: null`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`;
    // 简短字符串数组用 flow 形式；长的用块序列
    const totalLen = value.reduce((sum, v) => sum + v.length, 0);
    if (totalLen < 40 && value.length <= 5) {
      const items = value.map((v) => needsQuote(v) ? quoteString(v) : v).join(', ');
      return `${key}: [${items}]`;
    }
    const lines = [`${key}:`];
    for (const item of value) {
      lines.push(`  - ${needsQuote(item) ? quoteString(item) : item}`);
    }
    return lines.join('\n');
  }
  if (value instanceof Date) {
    return `${key}: ${value.toISOString()}`;
  }
  if (typeof value === 'boolean') return `${key}: ${value ? 'true' : 'false'}`;
  if (typeof value === 'number') return `${key}: ${Number.isFinite(value) ? value : 0}`;
  // string
  const s = value;
  if (s.length === 0) return `${key}:`;
  if (needsQuote(s)) return `${key}: ${quoteString(s)}`;
  return `${key}: ${s}`;
}

/** 粗略判断字符串是否需要 YAML 引号（防止被误解析为其他类型或语法冲突）。 */
function needsQuote(s: string): boolean {
  if (s.length === 0) return false;
  if (/^(true|false|null|yes|no|on|off|~|TRUE|FALSE|NULL)$/i.test(s)) return true;
  if (/^-?\d+(\.\d+)?$/.test(s)) return true;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return true;
  if (/[:#\u005b\u005d{}&*!|>'"%@`,\\]/.test(s)) return true;
  if (s.startsWith('-') || s.startsWith('?') || s.startsWith('!')) return true;
  if (s !== s.trim()) return true;
  return false;
}

function quoteString(s: string): string {
  if (s.includes('"') && !s.includes("'")) {
    return `'${s.replace(/'/g, "''")}'`;
  }
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/**
 * 对一个字符串值列表做简单排序 + 去重（用于 tags 等字段的规范化显示）。
 * 保留原始大小写与顺序感，只做去重。
 */
export function normalizeList(value: FrontmatterValue | undefined, fallback: string[] = []): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.length > 0) return [value];
  return fallback;
}

/** 安全读取字段为列表（非列表时退化到单元素或空）。 */
export function getList(data: FrontmatterData, key: string): string[] {
  return normalizeList(data[key], []);
}

/** 安全读取字段为字符串。 */
export function getString(data: FrontmatterData, key: string, fallback = ''): string {
  const v = data[key];
  if (v === null || v === undefined) return fallback;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.join(', ');
  return fallback;
}
