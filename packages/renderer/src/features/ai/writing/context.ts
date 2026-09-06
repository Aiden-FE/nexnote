/**
 * 写作辅助请求组装（DEV-010 交付内容 4）。
 *
 * token/字符预算优先级：选区/块（由调用方作为 target 全量保留，不在这里裁剪）
 *   > 当前文档 > 反向链接文档摘要。
 * 召回文档（DEV-011）本票不接入。超预算时按优先级从低到高裁剪，并置 truncated 提示。
 */

export interface BacklinkSnippet {
  title: string;
  snippet: string;
}

export interface WritingContextInput {
  /** 选区/块文本（最高优先级，不裁剪）——仅用于判定是否为空，正文由 prompt 单独携带。 */
  target: string;
  /** 当前文档全文（Markdown）。 */
  document: string;
  /** 反向链接摘要（标题 + 片段），最低优先级。 */
  backlinks: BacklinkSnippet[];
  /** 上下文（文档 + 反链）字符预算，默认 6000。 */
  budgetChars?: number;
}

export interface WritingContextSection {
  kind: 'document' | 'backlink';
  title: string;
  included: boolean;
  truncated: boolean;
}

export interface WritingContextAssembly {
  /** 拼进 user prompt 的上下文块（不含 target 本身）。 */
  contextBlock: string;
  truncated: boolean;
  /** 截断提示文案（无截断为 null）。 */
  note: string | null;
  sections: WritingContextSection[];
}

export const TRUNCATION_NOTE = '上下文过长，已截断';
const DEFAULT_BUDGET = 6000;
const SECTION_OVERHEAD = 16;

/** 头尾保留的窗口裁剪：超长文本保留开头与结尾，中间标注截断。 */
function clipHeadTail(text: string, max: number): { text: string; clipped: boolean } {
  if (text.length <= max) return { text, clipped: false };
  const head = Math.ceil(max * 0.7);
  const tail = max - head;
  return {
    text: `${text.slice(0, head)}\n…（${TRUNCATION_NOTE}）…\n${text.slice(text.length - tail)}`,
    clipped: true,
  };
}

export function assembleWritingContext(input: WritingContextInput): WritingContextAssembly {
  const budget = Math.max(200, input.budgetChars ?? DEFAULT_BUDGET);
  const sections: WritingContextSection[] = [];
  const parts: string[] = [];
  let truncated = false;
  let remaining = budget;

  const doc = input.document.trim();
  if (doc) {
    const budgetForDoc = Math.max(0, remaining - SECTION_OVERHEAD);
    const { text, clipped } = clipHeadTail(doc, budgetForDoc);
    const included = text.trim().length > 0;
    if (included) {
      parts.push(`【当前文档】\n${text}`);
      remaining -= text.length + SECTION_OVERHEAD;
    }
    truncated = truncated || clipped;
    sections.push({ kind: 'document', title: '当前文档', included, truncated: clipped });
  }

  const links = input.backlinks.filter((b) => b.title.trim() || b.snippet.trim());
  if (links.length > 0) {
    const linkLines: string[] = [];
    let linkTruncated = false;
    let includedCount = 0;
    for (const link of links) {
      const line = `- 《${link.title}》：${link.snippet.trim()}`;
      if (line.length + 2 > remaining) {
        linkTruncated = true;
        continue;
      }
      linkLines.push(line);
      remaining -= line.length + 1;
      includedCount += 1;
    }
    if (linkLines.length > 0) {
      parts.push(`【相关笔记（反向链接）】\n${linkLines.join('\n')}`);
    }
    truncated = truncated || linkTruncated;
    sections.push({
      kind: 'backlink',
      title: '反向链接',
      included: includedCount > 0,
      truncated: linkTruncated,
    });
  }

  return {
    contextBlock: parts.join('\n\n'),
    truncated,
    note: truncated ? TRUNCATION_NOTE : null,
    sections,
  };
}
