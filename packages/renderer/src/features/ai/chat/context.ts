/**
 * 对话上下文注入组装（DEV-012 交付内容 2）。
 *
 * context chips：当前文档（默认自动）/ 当前选区 / 反向链接文档 / 特定页面。
 * 注入优先级：选区 > 当前文档 > 特定页面 > 反向链接；超预算按优先级从低到高裁剪，
 * 与 DEV-010 写作辅助共用同一套 head-tail 截断思路。
 */

export type ChatContextKind = 'selection' | 'document' | 'page' | 'backlink';

export interface ChatContextChip {
  id: string;
  kind: ChatContextKind;
  label: string;
  /** vault 相对路径（文档/页面/反链来源）；选区可缺省。 */
  path?: string;
  text: string;
  /** 当前文档为默认自动注入（仍可移除）。 */
  auto?: boolean;
}

export interface ChatContextAssembly {
  /** 拼进用户消息的上下文块。 */
  contextBlock: string;
  /** 是否发生过裁剪。 */
  truncated: boolean;
  /** 全部 chip 的字符数（裁剪前）。 */
  totalChars: number;
  /** 全部 chip 的 token 估算（裁剪前）。 */
  totalTokens: number;
}

const DEFAULT_BUDGET_CHARS = 6000;
const SECTION_OVERHEAD = 24;
export const CHAT_CONTEXT_TRUNC_NOTE = '上下文过长，已截断';

const KIND_RANK: Record<ChatContextKind, number> = {
  selection: 0,
  document: 1,
  page: 2,
  backlink: 3,
};

const KIND_HEADING: Record<ChatContextKind, string> = {
  selection: '当前选区',
  document: '当前文档',
  page: '参考页面',
  backlink: '相关笔记（反向链接）',
};

/** 粗略 token 估算：CJK 字符约 1 token，其余约 4 字符/token。 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch)) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 4);
}

function clipHeadTail(text: string, max: number): { text: string; clipped: boolean } {
  if (text.length <= max) return { text, clipped: false };
  const head = Math.ceil(max * 0.7);
  const tail = max - head;
  return {
    text: `${text.slice(0, head)}\n…（${CHAT_CONTEXT_TRUNC_NOTE}）…\n${text.slice(text.length - tail)}`,
    clipped: true,
  };
}

/**
 * 组装上下文块。chips 按优先级排序后依次装入预算；超预算的 chip 头尾截断，
 * 装不下的低优先级 chip 直接丢弃并标记 truncated。
 */
export function assembleChatContext(
  chips: ChatContextChip[],
  budgetChars: number = DEFAULT_BUDGET_CHARS,
): ChatContextAssembly {
  const budget = Math.max(200, budgetChars);
  const totalChars = chips.reduce((sum, chip) => sum + chip.text.length, 0);
  const totalTokens = estimateTokens(chips.map((chip) => chip.text).join('\n'));

  const ordered = chips
    .filter((chip) => chip.text.trim().length > 0)
    .slice()
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);

  const parts: string[] = [];
  let truncated = false;
  let remaining = budget;

  for (const chip of ordered) {
    const heading = `【${KIND_HEADING[chip.kind]}${chip.label ? `：${chip.label}` : ''}】`;
    const available = Math.max(0, remaining - SECTION_OVERHEAD - heading.length);
    if (available < 40) {
      truncated = true;
      continue;
    }
    const { text, clipped } = clipHeadTail(chip.text.trim(), available);
    if (clipped) truncated = true;
    parts.push(`${heading}\n${text}`);
    remaining -= text.length + SECTION_OVERHEAD + heading.length;
  }

  return {
    contextBlock: parts.join('\n\n'),
    truncated,
    totalChars,
    totalTokens,
  };
}
