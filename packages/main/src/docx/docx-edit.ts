import { readZipEntry } from './zip';

const DOCUMENT_ENTRY = 'word/document.xml';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export interface EditRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export interface EditParagraph {
  text: string;
  runs: EditRun[];
  heading: number | null;
  list: boolean;
  editable: boolean;
  /** 原始 XML，仅用于未支持段落或未修改段落的保真重建。 */
  originalXml: string;
  modified?: boolean;
}

export interface EditDocument {
  paragraphs: EditParagraph[];
  unsupportedCount: number;
  /** 内部保存原始 XML，open→不编辑→save 保证字节不变。 */
  originalXml: string;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
function decode(value: string): string {
  return value.replace(/&(#\d+|#x[\da-fA-F]+|amp|lt|gt|quot|apos);/g, (all, entity: string) => {
    if (entity === 'amp') return '&';
    if (entity === 'lt') return '<';
    if (entity === 'gt') return '>';
    if (entity === 'quot') return '"';
    if (entity === 'apos') return "'";
    return String.fromCodePoint(
      Number.parseInt(
        entity.slice(entity[1] === 'x' || entity[1] === 'X' ? 2 : 1),
        entity[1] === 'x' || entity[1] === 'X' ? 16 : 10,
      ),
    );
  });
}
function replaceParagraphText(originalXml: string, text: string): string {
  const nodes = [...originalXml.matchAll(/(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g)];
  if (nodes.length === 0) throw new Error('该段落没有可安全编辑的文本节点');
  const decodedLengths = nodes.map((node) => decode(node[2] ?? '').length);
  let cursor = 0;
  let output = '';
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!;
    const length = i === nodes.length - 1 ? text.length - cursor : Math.min(decodedLengths[i]!, text.length - cursor);
    const chunk = text.slice(cursor, cursor + Math.max(0, length));
    cursor += chunk.length;
    output += originalXml.slice(i === 0 ? 0 : nodes[i - 1]!.index! + nodes[i - 1]![0].length, node.index!);
    output += `${node[1]}${escapeXml(chunk)}${node[3]}`;
  }
  const last = nodes[nodes.length - 1]!;
  return output + originalXml.slice(last.index! + last[0].length);
}

function topLevelParagraphs(xml: string): string[] {
  const bodyStart = xml.indexOf('<w:body');
  const bodyOpen = xml.indexOf('>', bodyStart);
  const bodyEnd = xml.lastIndexOf('</w:body>');
  if (bodyStart < 0 || bodyOpen < 0 || bodyEnd < 0) throw new Error('document.xml 缺少 w:body');
  const body = xml.slice(bodyOpen + 1, bodyEnd);
  const result: string[] = [];
  let tableDepth = 0;
  let paragraphStart = -1;
  let paragraphDepth = 0;
  const token = /<\/?w:(?:p|tbl)\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(body))) {
    const tag = m[0];
    const closing = tag.startsWith('</');
    const name = /^<\/?w:(p|tbl)\b/i.exec(tag)?.[1];
    if (!name) continue;
    if (name.toLowerCase() === 'tbl') {
      if (closing) tableDepth = Math.max(0, tableDepth - 1);
      else if (!tag.endsWith('/>')) tableDepth += 1;
      continue;
    }
    if (!closing) {
      if (tableDepth === 0 && paragraphDepth === 0) paragraphStart = m.index;
      paragraphDepth += 1;
      if (tag.endsWith('/>')) paragraphDepth -= 1;
    } else {
      paragraphDepth -= 1;
      if (paragraphDepth === 0 && paragraphStart >= 0) {
        result.push(body.slice(paragraphStart, token.lastIndex));
        paragraphStart = -1;
      }
    }
  }
  return result;
}

function parseParagraph(xml: string): EditParagraph {
  const headingMatch = /<w:pStyle\b[^>]*w:val=["']Heading([1-6])["'][^>]*\/?\s*>/i.exec(xml);
  const list = /<w:numPr\b|<w:pStyle\b[^>]*w:val=["']ListParagraph["']/i.test(xml);
  const runs: EditRun[] = [];
  const runRe = /<w:r\b[\s\S]*?<\/w:r>/g;
  let m: RegExpExecArray | null;
  while ((m = runRe.exec(xml))) {
    const runXml = m[0];
    const text = [...runXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((x) => decode(x[1] ?? ''))
      .join('');
    if (text || /<w:tab\s*\/>/.test(runXml) || /<w:br\s*\/>/.test(runXml))
      runs.push({
        text: [...text].filter((character) => character !== String.fromCharCode(0)).join(''),
        bold: /<w:b(?:\s[^>]*)?\s*\/>/.test(runXml),
        italic: /<w:i(?:\s[^>]*)?\s*\/>/.test(runXml),
      });
  }
  // 最小安全策略：仅当段落无复杂子结构、且文本全部位于 w:r/w:t 内时才可编辑。
  // pPr/rPr/bookmarks/未编辑 runs 等其余子元素在保存时原样保留。
  const textNodes = [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)];
  const editable =
    !/<w:(?:drawing|pict|object|fldSimple|hyperlink)\b/.test(xml) &&
    textNodes.length > 0 &&
    textNodes.every((node) => {
      const before = xml.slice(0, node.index);
      return before.lastIndexOf('<w:r') > before.lastIndexOf('</w:r>');
    });
  return {
    text: runs.map((r) => r.text).join(''),
    runs,
    heading: headingMatch ? Number(headingMatch[1]) : null,
    list,
    editable,
    originalXml: xml,
  };
}

export function openEditDocument(bytes: Buffer): EditDocument {
  const xml = readZipEntry(bytes, DOCUMENT_ENTRY).toString('utf8');
  const paragraphs = topLevelParagraphs(xml).map(parseParagraph);
  return {
    paragraphs,
    unsupportedCount: paragraphs.filter((p) => !p.editable).length,
    originalXml: xml,
  };
}

export function serializeEditDocument(document: EditDocument): string {
  if (!document.paragraphs.some((p) => p.modified)) return document.originalXml;

  // Replace paragraph occurrences in document order. Using String.replace per paragraph
  // would replace the first identical XML repeatedly when a document has duplicate paragraphs.
  let output = document.originalXml;
  let cursor = 0;
  for (const paragraph of document.paragraphs) {
    const position = output.indexOf(paragraph.originalXml, cursor);
    if (position < 0) throw new Error('编辑模型与原始 document.xml 不匹配');
    if (paragraph.modified && paragraph.editable) {
      const replacement = replaceParagraphText(paragraph.originalXml, paragraph.text);
      output =
        output.slice(0, position) +
        replacement +
        output.slice(position + paragraph.originalXml.length);
      cursor = position + replacement.length;
    } else {
      cursor = position + paragraph.originalXml.length;
    }
  }
  return output;
}

export function editParagraph(
  document: EditDocument,
  index: number,
  patch: Partial<Pick<EditParagraph, 'text' | 'runs' | 'heading' | 'list'>>,
): void {
  const p = document.paragraphs[index];
  if (!p || !p.editable) throw new Error('该段落不支持编辑');
  Object.assign(p, patch);
  if (patch.text !== undefined && patch.runs === undefined) p.runs = [{ text: patch.text }];
  p.modified = true;
}

export { DOCUMENT_ENTRY, W_NS };
