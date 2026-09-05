import { marked } from 'marked';
import { MarkdownManager } from '@tiptap/markdown';
import type { AnyExtension, JSONContent } from '@tiptap/core';

import { Frontmatter, splitFrontmatter, renderFrontmatterMarkdown } from '../extensions/frontmatter';
import {
  replaceAnchorsWithPlaceholders,
  finalizeAnchors,
  liftPlaceholdersToBlockIds,
  injectPlaceholderForBlockIds,
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
  const lifted = liftPlaceholdersToBlockIds(doc);
  if (yaml !== null) {
    const fm: JSONContent = {
      type: Frontmatter.name,
      content: yaml.length > 0 ? [{ type: 'text', text: yaml }] : [],
    };
    return { type: 'doc', content: [fm, ...(lifted.content ?? [])] };
  }
  return lifted;
}

/** 收集文档中带 code 标记且包含反引号的文本。 */
function collectCodeSpans(node: JSONContent, out: string[]): void {
  if (node.type === 'text' && node.marks?.some((m) => m.type === 'code') && node.text?.includes('`')) {
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

export function serializeMarkdown(manager: MarkdownManager, doc: JSONContent): string {
  const children = doc.content ?? [];
  const first = children[0];
  let rest = children;
  let head = '';
  if (first?.type === Frontmatter.name) {
    const yaml = (first.content ?? [])
      .map((n) => (n.type === 'text' ? n.text ?? '' : ''))
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
          .map((cell) => cell.trim())
          .join('|');
      }
      return l;
    });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');
}
