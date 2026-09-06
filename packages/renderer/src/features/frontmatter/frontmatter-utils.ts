import {
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

export function readFrontmatter(markdown: string): FrontmatterDocument {
  const { yaml, body } = splitFrontmatter(markdown);
  return { data: yaml === null ? {} : parseFrontmatterYaml(yaml), body, source: yaml ?? '' };
}

export function writeFrontmatter(data: FrontmatterData, body: string): string {
  const yaml = serializeFrontmatterYaml(data);
  return yaml.length > 0 ? `---\n${yaml}\n---\n\n${body.replace(/^\n+/, '')}` : body;
}

export function setFrontmatterValue(data: FrontmatterData, key: string, value: FrontmatterValue): FrontmatterData {
  const normalized = key.trim();
  if (!normalized) throw new Error('字段名不能为空');
  return { ...data, [normalized]: value };
}

export function removeFrontmatterValue(data: FrontmatterData, key: string): FrontmatterData {
  const next = { ...data };
  delete next[key];
  return next;
}

export function renameFrontmatterKey(data: FrontmatterData, from: string, to: string): FrontmatterData {
  const key = to.trim();
  if (!key) throw new Error('字段名不能为空');
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

/** 统计正文可见词数/块数；frontmatter 不计入。 */
export function pageStatistics(markdown: string): PageStatistics {
  const { body } = splitFrontmatter(markdown);
  const plain = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*_~#[\]()>|!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = plain ? plain.split(' ').filter(Boolean).length : 0;
  const blocks = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean).length;
  const data = readFrontmatter(markdown).data;
  const created = data.created instanceof Date ? data.created.toISOString() : typeof data.created === 'string' ? data.created : '—';
  const updated = data.updated instanceof Date ? data.updated.toISOString() : typeof data.updated === 'string' ? data.updated : '—';
  return { words, blocks, created, updated };
}
