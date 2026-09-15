import type { JSONContent } from '@tiptap/core';

/**
 * 块 ID 与 Obsidian `^id` 锚点的 Markdown 双向变换。
 *
 * 策略：parse 前把行尾 ` ^id` / 整行 `^id` 替换为 PUA 占位符（marked 对其按普通文本处理），
 * parse 后遍历 JSON 把占位符提升为节点 blockId 属性；serialize 前反向注入占位符，
 * 输出后再还原为 `^id`。全程确定性、无顺序猜测。
 *
 * 归属规则（与 Obsidian 一致）：
 * - 行尾锚点 → 所在段落/标题；listItem/taskItem 首段的锚点 → 提升到列表项
 * - 整行锚点 → 前一个兄弟块（表格/代码块的锚点形态）；无前块则降级为字面文本
 */

export const ANCHOR_OPEN = '\uFFF0';
export const ANCHOR_CLOSE = '\uFFF1';

/** Obsidian 块 ID 字符集：字母/数字/连字符（无点号/下划线）。 */
export const BLOCK_ID_RE_SOURCE = '[A-Za-z0-9-]+';

/** 占位符正则片段：`OPEN` 与 `CLOSE` 是否可选由拆开形态决定（见各使用点注释）。 */
const placeholderBody = (openOptional: boolean, closeOptional: boolean): string =>
  `${openOptional ? `(?:${ANCHOR_OPEN})?` : ANCHOR_OPEN}(${BLOCK_ID_RE_SOURCE})${
    closeOptional ? `(?:${ANCHOR_CLOSE})?` : ANCHOR_CLOSE
  }`;

const ANCHOR_SUFFIX_RE = new RegExp(`[ \\t](\\^${BLOCK_ID_RE_SOURCE})[ \\t]*$`);
const ANCHOR_WHOLE_LINE_RE = new RegExp(`^(\\^${BLOCK_ID_RE_SOURCE})[ \\t]*$`);
const PLACEHOLDER_GLOBAL_RE = new RegExp(placeholderBody(false, false), 'g');
// 起始标记可选：marked 的 inline lexer 会把段落前导空白连同 `\uFFF0` 一起剥掉，
// 历史产物可能只剩 `id\uFFF1` 形态的 text 节点（DEV-044 lazy continuation 回收路径）。
const PLACEHOLDER_TAIL_RE = new RegExp(`${placeholderBody(true, false)}$`);
const PLACEHOLDER_WHOLE_LINE_RE = new RegExp(
  `^[ \\t]*${placeholderBody(false, false)}[ \\t]*$`,
);
// standalone 锚点段落：完整占位符，或起始标记被 marked 剥掉的拆开形态。
const PLACEHOLDER_ONLY_PARAGRAPH_RE = new RegExp(`^[ \t]*${placeholderBody(true, false)}[ \t]*$`);

/** 允许 UniqueID 自动分配 blockId 的块类型；taskItem 保持普通待办的落盘基线。 */
export const BLOCK_ID_TYPES = [
  'paragraph',
  'heading',
  'listItem',
  'codeBlock',
  'table',
] as const;

/** standalone 锚点可挂载到 taskItem，但不影响 UniqueID 的自动分配范围。 */
const ATTACHABLE_TYPES: readonly string[] = [...BLOCK_ID_TYPES, 'taskItem'];
const isInlineIdHost = (type: string | undefined): boolean =>
  type === 'paragraph' || type === 'heading';
const isListItemLike = (type: string | undefined): boolean =>
  type === 'listItem' || type === 'taskItem';

/**
 * 从 Markdown 输出剥除块 ID 锚点（原生复制到剪贴板用）。
 * 跳过围栏代码块：其中的 `^xxx` 是字面代码内容，不能删。
 */
export function stripBlockAnchors(markdown: string): string {
  const lines = markdown.split('\n');
  let inFence = false;
  const out: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      // 进入/离开围栏：先把围栏外累积的空行压缩到一个再输出围栏标记
      if (!inFence && blankRun > 0 && out.length > 0 && out[out.length - 1] !== '') {
        out.push('');
      }
      blankRun = 0;
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      // 围栏内原样输出，包括连续空行（代码内容必须保真）
      out.push(line);
      continue;
    }
    const stripped = line.replace(ANCHOR_SUFFIX_RE, '');
    if (ANCHOR_WHOLE_LINE_RE.test(line) || stripped === '') {
      blankRun += 1;
      continue;
    }
    // 非空行：围栏外只保留至多一个空行作为段落分隔
    if (blankRun > 0 && out.length > 0 && out[out.length - 1] !== '') {
      out.push('');
    }
    blankRun = 0;
    out.push(stripped);
  }
  return out.join('\n');
}

// ── Markdown 文本侧 ────────────────────────────────────────────────

/**
 * parse 预处理：把 `^id` 锚点替换为占位符。跳过围栏代码块内部（其中是字面代码）。
 */
export function replaceAnchorsWithPlaceholders(markdown: string): string {
  const lines = markdown.split('\n');
  let inFence = false;
  const out = lines.map((line) => {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;

    const whole = ANCHOR_WHOLE_LINE_RE.exec(line);
    if (whole) {
      const id = (whole[1] ?? '').slice(1);
      return `${ANCHOR_OPEN}${id}${ANCHOR_CLOSE}`;
    }
    return line.replace(
      ANCHOR_SUFFIX_RE,
      (_all, id: string) => ` ${ANCHOR_OPEN}${id.slice(1)}${ANCHOR_CLOSE}`,
    );
  });
  return out.join('\n');
}

/** serialize 收尾：占位符 → `^id`（注入时已带分隔空格）；残留未消费的占位符按行剥除。 */
export function finalizeAnchors(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => {
      const whole = PLACEHOLDER_WHOLE_LINE_RE.exec(line);
      if (whole) return `^${whole[1]}`;
      return line.replace(PLACEHOLDER_GLOBAL_RE, (_all, id: string) => `^${id}`);
    })
    .join('\n');
}

// ── 文档 JSON 侧 ───────────────────────────────────────────────────

function isText(
  node: JSONContent | undefined,
): node is JSONContent & { type: 'text'; text: string } {
  return !!node && node.type === 'text' && typeof node.text === 'string';
}

/** 从内联内容末尾摘出占位符 id（连带紧邻空白）；无则返回 null。 */
function extractTrailingPlaceholder(
  content: JSONContent[] | undefined,
): { id: string; content: JSONContent[] } | null {
  if (!content || content.length === 0) return null;
  let rest = content.slice();
  let firstId: string | null = null;
  while (rest.length > 0) {
    const last = rest[rest.length - 1];
    if (!isText(last)) break;
    const m = PLACEHOLDER_TAIL_RE.exec(last.text);
    if (!m) break;
    // 同一块尾部的多个历史占位符全部消费；最先出现（最靠前）的 id 保留为块 ID。
    firstId = m[1] as string;
    const text = last.text.slice(0, m.index).replace(/[ \t\n]+$/, '');
    rest = rest.slice(0, -1);
    if (text.length > 0) rest.push({ ...last, text });
  }
  if (firstId === null) return null;
  return { id: firstId, content: rest };
}

/**
 * 占位符整段（standalone 锚点段落）。
 *
 * `allowBareAnchor` 仅用于块级上下文（文档顶层、列表项/引用的直接子级）：那里的
 * 裸 `^id` 段落是历史产物中被 lazy continuation 拆开的内联锚点，属于内部形态，必须
 * 回收。表格单元格等嵌套内容保持字面文本，用户写的 `^alpha` 不得被吞掉。
 */
function extractOnlyPlaceholderParagraph(node: JSONContent): { id: string } | null {
  if (node.type !== 'paragraph' || !node.content || node.content.length === 0) return null;
  if (node.content.length !== 1) return null;
  const only = node.content[0];
  if (!isText(only)) return null;
  const match = PLACEHOLDER_ONLY_PARAGRAPH_RE.exec(only.text);
  return match ? { id: match[1] as string } : null;
}

function literalAnchorParagraph(id: string): JSONContent {
  return { type: 'paragraph', content: [{ type: 'text', text: `^${id}` }] };
}

/**
 * parse 后处理：占位符 → blockId 属性。
 */
export function liftPlaceholdersToBlockIds(node: JSONContent): JSONContent {
  const { content } = walkNodes(node.content ?? []);
  return { ...node, content };
}

function walkNodes(nodes: JSONContent[]): { content: JSONContent[] } {
  const content: JSONContent[] = [];
  /** 没有可挂载前块的 standalone 锚点暂存为字面文本。 */
  let danglingId: string | null = null;

  for (const node of nodes) {
    // standalone 占位符段落：归属前一个兄弟块
    const standalone = extractOnlyPlaceholderParagraph(node);
    if (standalone) {
      const target = findAttachable(content);
      if (target) {
        if (typeof target.attrs?.blockId !== 'string') {
          target.attrs = { ...(target.attrs ?? {}), blockId: standalone.id };
        }
        // 同一前置块的第二个历史锚点被消费，避免再次成为可见正文。
      } else if (danglingId) {
        // 连续两个无法挂载的 standalone：把上一个按字面恢复
        content.push(literalAnchorParagraph(danglingId));
        danglingId = standalone.id;
      } else {
        danglingId = standalone.id;
      }
      continue;
    }

    if (danglingId) {
      content.push(literalAnchorParagraph(danglingId));
      danglingId = null;
    }

    let current: JSONContent = { ...node };

    if (isInlineIdHost(current.type)) {
      const trailing = extractTrailingPlaceholder(current.content);
      if (trailing) {
        const inner = trailing.content.length > 0 ? trailing.content : [{ type: 'text', text: '' }];
        current = {
          ...current,
          content: inner,
          attrs: { ...(current.attrs ?? {}), blockId: trailing.id },
        };
      }
    }

    if (current.content && current.content.length > 0) {
      const inner = walkNodes(current.content);
      current = { ...current, content: inner.content };

      // listItem/taskItem：把首段的锚点 id 上移到列表项（Obsidian：`- 项 ^id` 指向列表项）
      if (
        isListItemLike(current.type) &&
        !current.attrs?.blockId
      ) {
        const listContent = current.content ?? [];
        const paraIdx = listContent.findIndex(
          (c) => c.type === 'paragraph' && typeof c.attrs?.blockId === 'string',
        );
        const para = listContent[paraIdx];
        if (paraIdx !== -1 && para) {
          current = {
            ...current,
            attrs: { ...(current.attrs ?? {}), blockId: para.attrs?.blockId },
            content: listContent.map((c, i) =>
              i === paraIdx ? { ...c, attrs: withoutBlockId(c.attrs) } : c,
            ),
          };
        }
      }
    }

    content.push(current);
  }

  if (danglingId) content.push(literalAnchorParagraph(danglingId));

  return { content };
}

function findAttachable(nodes: JSONContent[]): JSONContent | null {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const n = nodes[i];
    if (n && ATTACHABLE_TYPES.includes(n.type ?? '')) return n;
  }
  return null;
}

// ── serialize 预处理 ───────────────────────────────────────────────

/**
 * serialize 预处理：blockId 属性 → 内联占位符。
 * - paragraph/heading → 内联末尾追加 ` \uFFF0id\uFFF1`
 * - listItem/taskItem → 注入第一个段落末尾
 * - codeBlock/table → 不注入（由 renderMarkdown 扩展追加独立 `^id` 行）
 */
export function injectPlaceholderForBlockIds(node: JSONContent): JSONContent {
  if (!node.content) return stripIds(node);
  const content = node.content.map((child) => {
    let current: JSONContent = { ...child };
    const blockId = current.attrs?.blockId;
    if (typeof blockId === 'string' && blockId.length > 0) {
      if (
        current.type === 'paragraph' &&
        (current.content ?? []).every((item) => isText(item) && item.text.trim().length === 0)
      ) {
        // 空段落没有可见内容承载锚点；注入会产出可被列表 lazy continuation
        // 吸收的独立 ` ^id` 行（DEV-044），因此直接丢弃空段锚点。
        current = { ...current, attrs: withoutBlockId(current.attrs) };
      } else if (isInlineIdHost(current.type)) {
        current = appendInlinePlaceholder(current, blockId);
      } else if (isListItemLike(current.type)) {
        current = injectIntoListItem(current, blockId) ?? current;
      }
      // codeBlock/table 由 renderMarkdown 扩展处理，这里保留属性
    }
    return injectPlaceholderForBlockIds(current);
  });
  return { ...node, content };
}

function withoutBlockId(
  attrs: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!attrs) return undefined;
  const next = { ...attrs };
  delete next.blockId;
  return Object.keys(next).length > 0 ? next : undefined;
}

/** 段落/标题/listItem 以外的节点：剥掉 blockId（避免 schema 不识别的属性） */
function stripIds(node: JSONContent): JSONContent {
  const blockId = node.attrs?.blockId;
  const isInjectable =
    isInlineIdHost(node.type) || isListItemLike(node.type);
  if (!blockId && !node.content) return node;
  if (blockId && !isInjectable && node.type !== 'codeBlock' && node.type !== 'table') {
    return { ...node, attrs: withoutBlockId(node.attrs), content: node.content?.map(stripIds) };
  }
  return { ...node, content: node.content?.map(stripIds) };
}

function appendInlinePlaceholder(node: JSONContent, blockId: string): JSONContent {
  const text = `${ANCHOR_OPEN}${blockId}${ANCHOR_CLOSE}`;
  const content = [...(node.content ?? [])];
  const last = content[content.length - 1];
  if (isText(last)) {
    content[content.length - 1] = { ...last, text: `${last.text} ${text}` };
  } else {
    content.push({ type: 'text', text: ` ${text}` });
  }
  return { ...node, attrs: withoutBlockId(node.attrs), content };
}

function injectIntoListItem(item: JSONContent, blockId: string): JSONContent | null {
  const idx = (item.content ?? []).findIndex((c) => c.type === 'paragraph');
  if (idx === -1) return null;
  const content = [...(item.content ?? [])];
  const para = content[idx];
  if (!para) return null;
  content[idx] = appendInlinePlaceholder(stripIds(para), blockId);
  return { ...item, attrs: withoutBlockId(item.attrs), content };
}
