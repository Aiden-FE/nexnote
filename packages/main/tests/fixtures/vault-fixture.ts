/**
 * 测试用 vault 生成器（非 benchmark 断言，只提供真实代码路径的 fixture）。
 * 用于 DEV-019 端到端集成与性能时间盒测试。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

export interface VaultFixtureSpec {
  /** 页面总数。 */
  pages: number;
  /** 每页平均块数（段落数）。 */
  blocksPerPage?: number;
  /** 每页平均出链数（随机指向前面已存在的页面，保证可解析）。 */
  linksPerPage?: number;
  /** 中文占比（0..1）：用于构造混合 CJK/Latin 文本。 */
  cjkRatio?: number;
  /** 顶层目录数（按 pages 均匀分布）。 */
  folders?: number;
  /** frontmatter 标签覆盖概率。 */
  tagProbability?: number;
}

const CJK_WORDS = [
  '知识',
  '图谱',
  '检索',
  '索引',
  '链接',
  '页面',
  '笔记',
  '召回',
  '向量',
  '置信',
  '同步',
  '归档',
];
const LATIN_WORDS = [
  'index',
  'graph',
  'link',
  'vector',
  'page',
  'note',
  'search',
  'embed',
  'merge',
  'commit',
];

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pickWords(rnd: () => number, count: number, cjkRatio: number): string {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const pool = rnd() < cjkRatio ? CJK_WORDS : LATIN_WORDS;
    out.push(pool[Math.floor(rnd() * pool.length)]!);
  }
  return out.join(' ');
}

/** 生成单页 markdown：frontmatter + 标题 + N 段落 + M 个 wikilink。 */
function pageContent(
  index: number,
  rnd: () => number,
  spec: Required<VaultFixtureSpec>,
  existingPaths: string[],
): string {
  const frontmatter =
    rnd() < spec.tagProbability
      ? `---\ncreated: 2025-01-${String((index % 28) + 1).padStart(2, '0')}\ntags: [t${index % 7}, group/${index % 3}]\n---\n\n`
      : '';
  const title = `# 页面 ${index} ${pickWords(rnd, 3, spec.cjkRatio)}\n\n`;
  const blocks: string[] = [];
  for (let b = 0; b < spec.blocksPerPage; b += 1) {
    const links: string[] = [];
    for (let l = 0; l < spec.linksPerPage; l += 1) {
      const targetIndex = Math.floor(rnd() * (existingPaths.length || 1));
      const target = existingPaths[targetIndex];
      if (target) links.push(`[[${target.replace(/\.md$/, '')}]]`);
    }
    blocks.push(
      `${pickWords(rnd, 12, spec.cjkRatio)}${links.length > 0 ? ` 引用 ${links.join(' ')}` : ''} ^b${index}-${b}`,
    );
  }
  return `${frontmatter}${title}${blocks.join('\n\n')}\n`;
}

/** 生成一个具有可控页面数/块数/链接数的真实 vault 目录。 */
export async function generateVault(root: string, spec: VaultFixtureSpec): Promise<string[]> {
  const filled: Required<VaultFixtureSpec> = {
    blocksPerPage: spec.blocksPerPage ?? 8,
    linksPerPage: spec.linksPerPage ?? 3,
    cjkRatio: spec.cjkRatio ?? 0.6,
    folders: spec.folders ?? 10,
    tagProbability: spec.tagProbability ?? 0.5,
    pages: spec.pages,
  };
  const rnd = lcg(0x5eed + filled.pages);
  const paths: string[] = [];
  await mkdir(root, { recursive: true });
  for (let i = 0; i < filled.pages; i += 1) {
    const folder = `folder-${i % filled.folders}`;
    const rel = `${folder}/page-${String(i).padStart(5, '0')}.md`;
    const content = pageContent(i, rnd, filled, paths);
    await mkdir(path.join(root, folder), { recursive: true });
    await writeFile(path.join(root, rel), content, 'utf8');
    paths.push(rel);
  }
  return paths;
}
