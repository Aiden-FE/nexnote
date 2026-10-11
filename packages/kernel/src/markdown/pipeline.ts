import { marked } from 'marked';
import { MarkdownManager } from '@tiptap/markdown';
import type { Slice } from '@tiptap/pm/model';
import type { AnyExtension, JSONContent } from '@tiptap/core';

import {
  Frontmatter,
  splitFrontmatter,
  renderFrontmatterMarkdown,
} from '../extensions/frontmatter';
import {
  replaceAnchorsWithPlaceholders,
  finalizeAnchors,
  liftPlaceholdersToBlockIds,
  injectPlaceholderForBlockIds,
  stripBlockAnchors,
} from './block-id';

/**
 * NexNote Markdown 双向管道（Obsidian 方言）。
 *
 * 在 @tiptap/markdown（MarkedJS 词法 + 扩展 parse/render 钩子）之上叠加：
 * - frontmatter 拆装（仅文档首部，管道层处理）
 * - `^id` 块锚点 ↔ blockId 属性（占位符法）
 * - callout / wikilink / hashtag 由各自扩展的 tokenizer 处理
 *
 * parse：Markdown → TipTap JSON；serialize：TipTap JSON → Markdown。
 */

/**
 * @tiptap/markdown 当前类型要求 `typeof marked`；构造隔离实例的 Marked 类实例在运行时
 * 具备相同 Lexer/use/defaults API，但类型缺少静态 getDefaults。这里保留官方 `marked`
 * 单例并避免外部调用 use；每个 MarkdownManager 的 lexer 状态由自身管理。
 */
export function createObsidianMarked(): typeof marked {
  return marked;
}

export function createMarkdownManager(
  extensions: AnyExtension[],
  markedInstance: typeof marked = marked,
): MarkdownManager {
  return new MarkdownManager({
    extensions,
    marked: markedInstance,
    indentation: { style: 'space', size: 2 },
  });
}

export function parseMarkdown(manager: MarkdownManager, markdown: string): JSONContent {
  const { yaml, body } = splitFrontmatter(markdown);
  const prepped = replaceAnchorsWithPlaceholders(body);
  const doc = manager.parse(prepped);
  const normalized = normalizeListItemContent(doc);
  const lifted = liftPlaceholdersToBlockIds(normalized);
  if (yaml !== null) {
    const fm: JSONContent = {
      type: Frontmatter.name,
      content: yaml.length > 0 ? [{ type: 'text', text: yaml }] : [],
    };
    return { type: 'doc', content: [fm, ...(lifted.content ?? [])] };
  }
  return lifted;
}

/**
 * DEV-109：列表项内容规范化。
 *
 * 有序列表自定义分词器在「项正文为空 + 后跟缩进块」（如 `1. \n   - a`）时，
 * 产出的 listItem/taskItem 内容以 list/table 等 block token 开头、没有前置
 * paragraph——违反 schema 的 `paragraph block*` 约束。JSON 不经 schema 校验
 * 直接入库（enableContentCheck 关闭），随后 UniqueID 补块 ID 的
 * setNodeMarkup 做 validContent 校验时抛
 * `RangeError: Invalid content for node type listItem`，整页渲染失败。
 *
 * 这里在管线内兜底：首子块不是 paragraph 的列表项补一个空 paragraph，
 * 使 JSON 对 schema 合法（空段落对用户呈现为列表项占位行，与编辑器里
 * 手动产生同类结构的结果一致）。
 */
export function normalizeListItemContent(node: JSONContent): JSONContent {
  if (!Array.isArray(node.content) || node.content.length === 0) return node;
  const content = node.content.map(normalizeListItemContent);
  if (node.type === 'listItem' || node.type === 'taskItem') {
    const first = content[0];
    if (first && first.type !== 'paragraph') {
      content.unshift({ type: 'paragraph', content: [] });
    }
  }
  return { ...node, content };
}

/** 收集文档中带 code 标记且包含反引号的文本。 */
function collectCodeSpans(node: JSONContent, out: string[]): void {
  if (
    node.type === 'text' &&
    node.marks?.some((m) => m.type === 'code') &&
    node.text?.includes('`')
  ) {
    out.push(node.text);
  }
  node.content?.forEach((c) => collectCodeSpans(c, out));
}

function longestBacktickRun(text: string): number {
  const runs = text.match(/`+/g) ?? [];
  return runs.reduce((max, r) => Math.max(max, r.length), 0);
}

/**
 * 修复行内代码围栏：上游 mark 序列化器固定单反引号，内容含反引号时会产出非法围栏。
 * 利用文档里的 code 文本定位并按 CommonMark 自适应重围。
 */
export function fixInlineCodeFences(markdown: string, codeTexts: string[]): string {
  if (codeTexts.length === 0) return markdown;
  return markdown
    .split('\n')
    .map((line) => {
      let out = line;
      for (const text of codeTexts) {
        const broken = `\`${text}\``;
        if (!out.includes(broken)) continue;
        const fence = '`'.repeat(longestBacktickRun(text) + 1);
        const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
        out = out.split(broken).join(`${fence}${pad}${text}${pad}${fence}`);
      }
      return out;
    })
    .join('\n');
}

/**
 * 原生复制的 text/plain：沿用 Markdown 的结构分隔（列表项紧凑、段落留一空行），
 * 不携带 vault frontmatter 和内部 ^block-id 锚点。
 */
export function serializeClipboardText(manager: MarkdownManager, slice: Slice): string {
  const content = (slice.content.toJSON() ?? []).filter(
    (node: JSONContent) => node.type !== Frontmatter.name,
  );
  if (content.length === 0) return '';
  return stripBlockAnchors(serializeMarkdown(manager, { type: 'doc', content })).replace(
    /\n+$/,
    '',
  );
}

export function serializeMarkdown(manager: MarkdownManager, doc: JSONContent): string {
  const children = doc.content ?? [];
  const first = children[0];
  let rest = children;
  let head = '';
  if (first?.type === Frontmatter.name) {
    const yaml = (first.content ?? [])
      .map((n) => (n.type === 'text' ? (n.text ?? '') : ''))
      .join('');
    head = renderFrontmatterMarkdown(yaml);
    rest = children.slice(1);
  }

  const injected = injectPlaceholderForBlockIds({ type: 'doc', content: rest });
  const raw = manager.serialize(injected);
  const codeTexts: string[] = [];
  collectCodeSpans(doc, codeTexts);
  const body = fixInlineCodeFences(finalizeAnchors(raw), codeTexts)
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n');
  return head + body;
}

/**
 * Round-trip 规范化比较（仅用于测试，不进入写盘路径）：
 * - 剥行尾空白；剔除引用空分隔行（`>`-only，上游 blockquote 序列化器会插入）
 * - 归一表格列填充（`| a   |` ≡ `| a |`）
 * - 压缩 3+ 连续空行为 1（上游把混排任务/普通列表拆为多列表）
 * - 统一首尾空行
 */
export function normalizeForCompare(markdown: string): string {
  const lines = markdown
    .split('\n')
    .filter((line) => !/^>[ \t]*$/.test(line))
    .map((line) => {
      let l = line.replace(/[ \t]+$/, '');
      if (/^\s*\|/.test(l)) {
        l = l
          .split('|')
          .map((cell) => {
            const trimmed = cell.trim();
            // 分隔行的连字符数量不承载语义（GFM 只要求 >=3），归一为 3
            const delimiter = /^(:?)-{3,}(:?)$/.exec(trimmed);
            return delimiter ? `${delimiter[1] ?? ''}---${delimiter[2] ?? ''}` : trimmed;
          })
          .join('|');
      }
      return l;
    });
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}
