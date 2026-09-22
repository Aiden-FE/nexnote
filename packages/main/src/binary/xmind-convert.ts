import JSZip from 'jszip';
import xmlConvert from 'xml-js';

/**
 * xmind ↔ simple-mind-map 数据转换（DEV-074，ADR-0015 R3）。
 *
 * simple-mind-map 的完整库依赖浏览器 DOM（window/document），无法在 Node 主进程直接 import；
 * 这里按它的 parse/xmind.js 与 plugins/ExportXMind.js 复刻「数据 ↔ content.json」的纯数据层
 * （文本、树结构、备注、超链接、标签、概要）。外框 / 关联线 / 高级主题样式归入只读保留区：
 * 解析时计入 unsupportedCount，保存时原字节不参与重建（调用方决定是否整包保留）。
 *
 * 与 simple-mind-map 语义对齐：
 * - 读：content.json（v2）优先，content.xml（xmind8）回退；任一缺失/损坏 fail-closed。
 * - 写：重建 content.json + metadata.json + manifest.json + content.xml（占位警告，与 smm 相同策略）。
 */

export class XmindError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'XmindError';
  }
}

/** simple-mind-map 节点数据模型（JSON 可序列化）。 */
export interface SmmNode {
  data: {
    text: string;
    note?: string;
    hyperlink?: string;
    tag?: string[];
    generalization?: { expand: boolean; isActive: boolean; text: string; range: number[] | null }[];
    [key: string]: unknown;
  };
  children?: SmmNode[];
}

interface RawXmindTopic {
  id?: string;
  title?: string;
  notes?: { realHTML?: { content?: string }; plain?: { content?: string } };
  href?: string;
  labels?: string[];
  summaries?: { topicId?: string; range?: string }[];
  children?: { attached?: RawXmindTopic[] };
  image?: { src?: string; width?: number; height?: number };
  [key: string]: unknown;
}

function isUndef(v: unknown): boolean {
  return v === undefined || v === null;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}

/** 读 xmind 字节 → simple-mind-map 树（含只读保留区计数）。任何损坏抛 XmindError。 */
export async function parseXmindToModel(bytes: Buffer): Promise<{
  model: SmmNode;
  readonly: string[];
  unsupportedCount: number;
}> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (e) {
    throw new XmindError(`非法 xmind 包：${(e as Error).message}`, 'XMIND_INVALID_ZIP');
  }
  const jsonFile = zip.files['content.json'];
  const xmlFile = zip.files['content.xml'] ?? zip.files['/content.xml'];
  try {
    if (jsonFile) {
      const json = JSON.parse(await jsonFile.async('string')) as { rootTopic?: RawXmindTopic }[];
      const data = Array.isArray(json) && json.length > 0 ? json[0] : null;
      if (!data?.rootTopic) throw new XmindError('xmind 缺少 rootTopic', 'XMIND_NO_ROOT');
      const model = transformXmindTopic(data.rootTopic);
      return { model, readonly: ['外框 / 关联线（只读）'], unsupportedCount: countUnsupported(data.rootTopic) };
    }
    if (xmlFile) {
      const xml = await xmlFile.async('string');
      const json = JSON.parse(xmlConvert.xml2json(xml, { compact: false })) as {
        elements?: Xmind8Element[];
      };
      const root = xmind8Root(json.elements ?? []);
      if (!root) throw new XmindError('xmind8 缺少根主题', 'XMIND_NO_ROOT');
      return { model: transformXmind8(root), readonly: ['外框 / 关联线（只读）'], unsupportedCount: 0 };
    }
    throw new XmindError('xmind 缺少 content.json / content.xml', 'XMIND_NO_CONTENT');
  } catch (e) {
    if (e instanceof XmindError) throw e;
    throw new XmindError(`xmind 解析失败：${(e as Error).message}`, 'XMIND_PARSE_FAILED');
  }
}

function countUnsupported(node: RawXmindTopic): number {
  let n = 0;
  // 边界（boundary）与关联线（relationship）在解析端不实现，归入只读保留区。
  if (node.boundaries || node.relationships) n += 1;
  for (const child of node.children?.attached ?? []) n += countUnsupported(child);
  return n;
}

function transformXmindTopic(node: RawXmindTopic): SmmNode {
  const data: SmmNode['data'] = { text: isUndef(node.title) ? '' : String(node.title) };
  if (node.notes) {
    const note = node.notes.realHTML?.content ?? node.notes.plain?.content ?? '';
    if (note) data.note = note;
  }
  if (node.href && /^https?:\/\//.test(node.href)) data.hyperlink = node.href;
  if (Array.isArray(node.labels) && node.labels.length > 0) data.tag = node.labels.map(String);
  // 概要（summaries）：range (start,end) 区分「作用于子节点区间」与「作用于自身」
  const selfSummary: SmmNode['data']['generalization'] = [];
  const childrenSummary: ({ text: string } | undefined)[] = [];
  if (Array.isArray(node.summaries) && node.summaries.length > 0) {
    for (const item of node.summaries) {
      const summaryData = { expand: true, isActive: false, text: '', range: null as number[] | null };
      const target = item.topicId ? findTitleById(node, item.topicId) : '';
      summaryData.text = target ?? '';
      const match = /^\((\d+),(\d+)\)$/.exec(item.range ?? '');
      if (match) {
        const start = Number(match[1]);
        const end = Number(match[2]);
        if (start === end) {
          childrenSummary[start] = { text: summaryData.text };
        } else {
          summaryData.range = [start, end];
          selfSummary.push(summaryData);
        }
      } else {
        selfSummary.push(summaryData);
      }
    }
  }
  if (selfSummary.length > 0) data.generalization = selfSummary;
  const children: SmmNode[] = [];
  for (const [index, child] of (node.children?.attached ?? []).entries()) {
    const newChild = transformXmindTopic(child);
    const summary = childrenSummary[index];
    if (summary) {
      newChild.data.generalization = [
        ...(newChild.data.generalization ?? []),
        { expand: true, isActive: false, text: summary.text, range: null },
      ];
    }
    children.push(newChild);
  }
  const out: SmmNode = { data };
  if (children.length > 0) out.children = children;
  return out;
}

function findTitleById(node: RawXmindTopic, id: string): string | null {
  if (node.id === id) return isUndef(node.title) ? '' : String(node.title);
  for (const child of node.children?.attached ?? []) {
    const found = findTitleById(child, id);
    if (found !== null) return found;
  }
  return null;
}

// ── xmind8（content.xml）旧格式 ──────────────────────────────────────
interface Xmind8Element {
  name?: string;
  elements?: Xmind8Element[];
  attributes?: Record<string, string>;
  text?: string;
}

function xmind8Root(elements: Xmind8Element[]): Xmind8Element | null {
  for (const el of elements) {
    if (el.name === 'xmap-content' || el.name === 'sheet') {
      const topic = findByName(el.elements ?? [], 'topic');
      if (topic) return topic;
    }
    const nested = xmind8Root(el.elements ?? []);
    if (nested) return nested;
  }
  return null;
}

function findByName(elements: Xmind8Element[], name: string): Xmind8Element | null {
  for (const el of elements) {
    if (el.name === name) return el;
    const nested = findByName(el.elements ?? [], name);
    if (nested) return nested;
  }
  return null;
}

function textOf(el: Xmind8Element | null): string {
  if (!el?.elements) return '';
  const first = el.elements.find((c) => c.text !== undefined);
  return first?.text ?? '';
}

function transformXmind8(node: Xmind8Element): SmmNode {
  const elements = node.elements ?? [];
  const title = textOf(findByName(elements, 'title'));
  const data: SmmNode['data'] = { text: title };
  const notes = findByName(elements, 'notes');
  if (notes) {
    const plain = findByName(notes.elements ?? [], 'plain');
    const noteText = textOf(plain);
    if (noteText) data.note = noteText;
  }
  const href = node.attributes?.['xlink:href'];
  if (href && /^https?:\/\//.test(href)) data.hyperlink = href;
  const labels = findByName(elements, 'labels');
  if (labels?.elements?.length) {
    data.tag = labels.elements.map((l) => textOf(l)).filter(Boolean);
  }
  const childrenItem = findByName(elements, 'children');
  const children: SmmNode[] = [];
  for (const topics of childrenItem?.elements ?? []) {
    if (topics.name !== 'topics' || topics.attributes?.type !== 'attached') continue;
    for (const topic of topics.elements ?? []) {
      if (topic.name === 'topic') children.push(transformXmind8(topic));
    }
  }
  const out: SmmNode = { data };
  if (children.length > 0) out.children = children;
  return out;
}

// ── 写：simple-mind-map 树 → xmind 字节 ─────────────────────────────
export async function writeModelToXmind(model: SmmNode, name: string): Promise<Buffer> {
  const id = `simpleMindMap_${Date.now()}`;
  interface XmindOut {
    id: string;
    class?: string;
    title?: string;
    extensions?: unknown[];
    topicPositioning?: string;
    topicOverlapping?: string;
    coreVersion?: string;
    rootTopic?: unknown;
    children?: { attached: unknown[]; summary?: unknown };
    summaries?: unknown[];
  }
  const build = (node: SmmNode, isRoot: boolean): XmindOut => {
    const topic: Record<string, unknown> = {
      id: node.data.uid as string | undefined,
      structureClass: 'org.xmind.ui.logic.right',
      title: stripHtml(node.data.text ?? ''),
      children: { attached: [] as unknown[] },
    };
    if (node.data.note !== undefined) {
      topic.notes = { realHTML: { content: node.data.note }, plain: { content: node.data.note } };
    }
    if (node.data.hyperlink !== undefined) topic.href = node.data.hyperlink;
    if (node.data.tag !== undefined) {
      topic.labels = (node.data.tag || []).map((item) =>
        typeof item === 'object' && item !== null ? (item as { text?: string }).text : item,
      );
    }
    // 概要回写
    const generalization = node.data.generalization ?? [];
    if (generalization.length > 0) {
      const summaries: unknown[] = [];
      let summary: { startIndex?: number; endIndex?: number } = {};
      (node.children ?? []).forEach((child, index) => {
        const g = (child.data.generalization ?? [])[0];
        if (g && !g.range) {
          summaries.push({ topicId: child.data.uid, range: `(${index},${index})` });
        }
      });
      const ranged = generalization.filter((g) => g.range && g.range.length >= 2);
      for (const g of ranged) {
        summaries.push({ topicId: (node.data as { uid?: string }).uid, range: `(${g.range![0]},${g.range![1]})` });
        summary = { startIndex: g.range![0], endIndex: g.range![1] };
      }
      if (summaries.length > 0) {
        (topic.children as { summary?: unknown }).summary = summary;
        topic.summaries = summaries;
      }
    }
    for (const child of node.children ?? []) {
      ((topic.children as { attached: unknown[] }).attached).push(build(child, false));
    }
    if (isRoot) {
      const out: XmindOut = {
        id,
        class: 'sheet',
        title: name,
        extensions: [],
        topicPositioning: 'fixed',
        topicOverlapping: 'overlap',
        coreVersion: '2.100.0',
        rootTopic: topic,
      };
      return out;
    }
    return topic as unknown as XmindOut;
  };
  const sheet = build(model, true);
  const zip = new JSZip();
  zip.file('content.json', JSON.stringify([sheet]));
  zip.file(
    'metadata.json',
    `{"modifier":"","dataStructureVersion":"2","creator":{"name":"mind-map"},"layoutEngineVersion":"3","activeSheetId":"${id}"}`,
  );
  zip.file('manifest.json', JSON.stringify({ 'file-entries': { 'content.json': {} } }));
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return buffer;
}
